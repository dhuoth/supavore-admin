'use client';

import { ChangeEvent, useState } from 'react';
import { geocodeRestaurantLocationViaApi } from '@/lib/geocodingClient';
import { buildMenuItemUpsert, buildRestaurantUpsert } from '@/lib/menuUpsertShapes';
import { dedupeMenuRows } from '@/lib/menuDeduping';
import {
  canonicalizeDietaryCompliance,
  normalizeMenuItemPayload,
  normalizeOptionalText,
  normalizeRestaurantPayload,
} from '@/lib/menuNormalization';
import { mergeRestaurantLocation } from '@/lib/restaurantLocation';
import { supabase } from '@/lib/supabaseClient';

const csvHeaders = [
  'Restaurant Name',
  'Restaurant Address',
  'City',
  'Region',
  'Postal Code',
  'Online Ordering Link',
  'Menu Item',
  'Base Price',
  'Recommended Modification',
  'Price with Modification',
  'Ingredients',
  'Dietary Need Compliance',
] as const;

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

type NormalizedCsvRow = {
  restaurant_name: string;
  restaurant_address: string;
  menu_item: string;
  rawRecord: Record<string, string>;
  restaurant: {
    name: string;
    address: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    onlineOrderingLink: string | null;
  };
  menuItem: {
    name: string;
    basePrice: number;
    priceWithModification: number;
    recommendedModification: string;
    ingredients: string | null;
    dietaryCompliance: string[] | string;
  };
};

function inputClassName() {
  return 'w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-950 outline-none transition file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200';
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += character;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function buildRowRecord(headers: string[], values: string[]) {
  return headers.reduce<Record<string, string>>((record, header, index) => {
    record[header] = values[index] ?? '';
    return record;
  }, {});
}

async function upsertRestaurant(row: {
  restaurant: {
    name: string;
    address: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    onlineOrderingLink: string | null;
  };
}) {
  const geocodeResult = await geocodeRestaurantLocationViaApi({
    address: row.restaurant.address,
    city: row.restaurant.city,
    region: row.restaurant.region,
    postalCode: row.restaurant.postalCode,
  });
  const mergedLocation = mergeRestaurantLocation(
    row.restaurant,
    geocodeResult.ok ? geocodeResult.data : null
  );
  const restaurantPayload = buildRestaurantUpsert({
    restaurant: {
      ...row.restaurant,
      city: mergedLocation.city,
      region: mergedLocation.region,
      postalCode: mergedLocation.postal_code,
      latitude: mergedLocation.latitude,
      longitude: mergedLocation.longitude,
    },
  });

  const { data: restaurantCandidates, error: existingRestaurantError } = await supabase
    .from('restaurants')
    .select(
      'id, name, address, city, region, postal_code, latitude, longitude, online_ordering_link'
    );

  if (existingRestaurantError) {
    throw existingRestaurantError;
  }

  const existingRestaurant = (restaurantCandidates || []).find((restaurant) => {
    const normalizedCandidate = normalizeRestaurantPayload({
      restaurantName: restaurant.name,
      restaurantAddress: restaurant.address,
      restaurantCity: restaurant.city,
      restaurantRegion: restaurant.region,
      restaurantPostalCode: restaurant.postal_code,
      onlineOrderingLink: restaurant.online_ordering_link,
    });

    return (
      normalizedCandidate.name === restaurantPayload.name &&
      normalizedCandidate.address === restaurantPayload.address
    );
  });

  if (existingRestaurant) {
    const shouldUpdateRestaurant =
      existingRestaurant.address !== restaurantPayload.address ||
      existingRestaurant.city !== restaurantPayload.city ||
      existingRestaurant.region !== restaurantPayload.region ||
      existingRestaurant.postal_code !== restaurantPayload.postal_code ||
      existingRestaurant.latitude !== restaurantPayload.latitude ||
      existingRestaurant.longitude !== restaurantPayload.longitude ||
      normalizeOptionalText(existingRestaurant.online_ordering_link) !==
        restaurantPayload.online_ordering_link;

    if (shouldUpdateRestaurant) {
      const { error: restaurantUpdateError } = await supabase
        .from('restaurants')
        .update(restaurantPayload)
        .eq('id', existingRestaurant.id);

      if (restaurantUpdateError) {
        throw restaurantUpdateError;
      }
    }

    return {
      restaurantId: existingRestaurant.id,
      geocodeWarning: geocodeResult.ok ? null : geocodeResult.warning,
    };
  }

  const { data: insertedRestaurant, error: insertedRestaurantError } = await supabase
    .from('restaurants')
    .insert(restaurantPayload)
    .select('id')
    .single();

  if (insertedRestaurantError) {
    throw insertedRestaurantError;
  }

  return {
    restaurantId: insertedRestaurant.id,
    geocodeWarning: geocodeResult.ok ? null : geocodeResult.warning,
  };
}

export default function CsvUploadsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [statusMessage, setStatusMessage] = useState('No file selected.');

  const handleDownloadTemplate = () => {
    const blob = new Blob([`${csvHeaders.join(',')}\n`], { type: 'text/csv;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = objectUrl;
    link.download = 'supavore_menu_upload_template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;

    setSelectedFile(file);
    setUploadState('idle');
    setStatusMessage(file ? `Ready to upload ${file.name}.` : 'No file selected.');
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadState('error');
      setStatusMessage('Select a CSV file before uploading.');
      return;
    }

    setUploadState('uploading');
    setStatusMessage(`Uploading ${selectedFile.name}...`);

    let batchId: string | number | null = null;

    try {
      const fileContents = await selectedFile.text();
      const parsedRows = parseCsv(fileContents);

      if (parsedRows.length === 0) {
        throw new Error('CSV file is empty.');
      }

      const headers = parsedRows[0];
      const dataRows = parsedRows.slice(1).filter((row) =>
        row.some((value) => normalizeOptionalText(value) !== null)
      );

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: batchRecord, error: batchInsertError } = await supabase
        .from('upload_batches')
        .insert({
          uploaded_by: user?.id ?? null,
          filename: selectedFile.name,
          status: 'processing',
        })
        .select('id')
        .single();

      if (batchInsertError) {
        throw batchInsertError;
      }

      batchId = batchRecord.id;

      const geocodeWarnings: string[] = [];
      const normalizedRows: NormalizedCsvRow[] = dataRows.map((row) => {
        const rawRecord = buildRowRecord(headers, row);
        const recommendedModification = rawRecord['Recommended Modification'];
        const noModifications = normalizeOptionalText(recommendedModification) === null;
        const canonicalDietaryCompliance = canonicalizeDietaryCompliance(
          rawRecord['Dietary Need Compliance']
        );

        const restaurant = normalizeRestaurantPayload({
          restaurantName: rawRecord['Restaurant Name'],
          restaurantAddress: rawRecord['Restaurant Address'],
          restaurantCity: rawRecord['City'],
          restaurantRegion: rawRecord['Region'],
          restaurantPostalCode: rawRecord['Postal Code'],
          onlineOrderingLink: rawRecord['Online Ordering Link'],
        });

        const menuItem = normalizeMenuItemPayload({
          menuItem: rawRecord['Menu Item'],
          basePrice: rawRecord['Base Price'],
          priceWithModification: rawRecord['Price with Modification'],
          recommendedModification,
          ingredients: rawRecord['Ingredients'],
          dietaryCompliance: canonicalDietaryCompliance,
          noModifications,
        });
        const recommendedModificationValue = noModifications
          ? 'No Modifications'
          : menuItem.recommendedModification;
        const priceWithModificationValue = noModifications
          ? menuItem.basePrice
          : menuItem.priceWithModification;

        if (!restaurant.name) {
          throw new Error('Restaurant Name is required for every CSV row.');
        }

        if (!restaurant.address && !restaurant.postalCode) {
          throw new Error(
            'Restaurant Address or Postal Code is required for every CSV row.'
          );
        }

        if (!menuItem.name) {
          throw new Error('Menu Item is required for every CSV row.');
        }

        if (menuItem.basePrice === null || priceWithModificationValue === null) {
          throw new Error('Base Price and Price with Modification are required for every CSV row.');
        }

        if (!menuItem.dietaryCompliance) {
          throw new Error('Dietary Need Compliance is required for every CSV row.');
        }

        if (!recommendedModificationValue) {
          throw new Error(
            'Recommended Modification is required when No Modifications is not implied.'
          );
        }

        return {
          restaurant_name: restaurant.name,
          restaurant_address: restaurant.address || '',
          menu_item: menuItem.name,
          rawRecord,
          restaurant,
          menuItem: {
            name: menuItem.name,
            basePrice: menuItem.basePrice,
            recommendedModification: recommendedModificationValue,
            priceWithModification: priceWithModificationValue,
            ingredients: menuItem.ingredients,
            dietaryCompliance: menuItem.dietaryCompliance,
          },
        };
      });

      const dedupedRows = dedupeMenuRows(normalizedRows);

      for (const row of dedupedRows) {
        const { restaurantId, geocodeWarning } = await upsertRestaurant({
          restaurant: row.restaurant,
        });

        if (geocodeWarning) {
          geocodeWarnings.push(`${row.restaurant.name}: ${geocodeWarning}`);
        }

        const menuItemPayload = buildMenuItemUpsert({
          restaurantId,
          row,
        });

        const { error: menuItemError } = await supabase.from('menu_items').insert(menuItemPayload);

        if (menuItemError) {
          if (menuItemError.code === '23505') {
            continue;
          }

          throw menuItemError;
        }
      }

      const uploadRowsPayload = dedupedRows.map((row) => {
        return {
          batch_id: batchId,
          row_status: 'pending',
          raw_data: {
            raw: row.rawRecord,
            normalized: {
              restaurant: row.restaurant,
              menuItem: row.menuItem,
            },
          },
        };
      });

      if (uploadRowsPayload.length > 0) {
        const { error: rowsInsertError } = await supabase
          .from('upload_rows')
          .insert(uploadRowsPayload);

        if (rowsInsertError) {
          throw rowsInsertError;
        }
      }

      const { error: batchUpdateError } = await supabase
        .from('upload_batches')
        .update({ status: 'completed' })
        .eq('id', batchId);

      if (batchUpdateError) {
        throw batchUpdateError;
      }

      setUploadState('success');
      setStatusMessage(
        `Upload completed. Stored ${uploadRowsPayload.length} deduplicated row${uploadRowsPayload.length === 1 ? '' : 's'}.${geocodeWarnings.length > 0 ? ` Geocoding warnings for ${geocodeWarnings.length} row${geocodeWarnings.length === 1 ? '' : 's'}.` : ''}`
      );
    } catch (error) {
      if (batchId !== null) {
        await supabase.from('upload_batches').update({ status: 'error' }).eq('id', batchId);
      }

      console.error('CSV upload failed:', error);
      setUploadState('error');
      setStatusMessage(
        error instanceof Error
          ? `CSV upload failed: ${error.message}`
          : `CSV upload failed: ${JSON.stringify(error)}`
      );
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
            CSV Uploads
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
            Upload CSV files for bulk menu database ingestion. Rows are normalized and stored for
            later review and processing.
          </p>
        </header>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Download CSV Template
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="csv-file" className="block text-sm font-medium text-zinc-900">
                CSV File
              </label>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className={inputClassName()}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploadState === 'uploading'}
                className="inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
              >
                {uploadState === 'uploading' ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-sm font-medium text-zinc-900">Status</p>
              <p className="mt-2 text-sm text-zinc-600">
                {uploadState === 'idle' && `Idle: ${statusMessage}`}
                {uploadState === 'uploading' && `Uploading: ${statusMessage}`}
                {uploadState === 'success' && `Success: ${statusMessage}`}
                {uploadState === 'error' && `Error: ${statusMessage}`}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
