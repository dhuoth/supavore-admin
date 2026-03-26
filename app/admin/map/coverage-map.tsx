'use client';

import { useEffect, useRef, useState } from 'react';

type CoveragePoint = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  latitude: number;
  longitude: number;
};

type CoverageMapProps = {
  apiKey: string | null;
  points: CoveragePoint[];
};

declare global {
  interface Window {
    google?: GoogleMapsApi;
  }
}

const GOOGLE_MAPS_SCRIPT_ID = 'supavore-admin-google-maps';
type GoogleMapsApi = {
  maps: {
    Map: new (element: HTMLElement, options: Record<string, unknown>) => {
      fitBounds: (bounds: unknown) => void;
    };
    LatLng: new (lat: number, lng: number) => unknown;
    LatLngBounds: new () => {
      extend: (latLng: unknown) => void;
      isEmpty: () => boolean;
    };
    Circle: new (options: Record<string, unknown>) => {
      setMap: (map: unknown) => void;
    };
    visualization?: {
      HeatmapLayer: new (options: Record<string, unknown>) => {
        setMap: (map: unknown) => void;
      };
    };
  };
};

function loadGoogleMaps(apiKey: string) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'));
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;

  if (existingScript) {
    return new Promise<GoogleMapsApi>((resolve, reject) => {
      existingScript.addEventListener('load', () => {
        if (window.google?.maps) {
          resolve(window.google);
          return;
        }

        reject(new Error('Google Maps loaded without the maps namespace.'));
      });
      existingScript.addEventListener('error', () => {
        reject(new Error('Google Maps failed to load.'));
      });
    });
  }

  return new Promise<GoogleMapsApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=visualization`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google);
        return;
      }

      reject(new Error('Google Maps loaded without the maps namespace.'));
    };
    script.onerror = () => {
      reject(new Error('Google Maps failed to load.'));
    };
    document.head.appendChild(script);
  });
}

export function CoverageMap({ apiKey, points }: CoverageMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const overlaysRef = useRef<Array<{ setMap: (map: unknown) => void }>>([]);
  const heatmapRef = useRef<{ setMap: (map: unknown) => void } | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'fallback' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey || !mapRef.current || points.length === 0) {
      return;
    }

    let cancelled = false;

    const renderMap = async () => {
      try {
        setStatus('loading');
        setErrorMessage(null);
        const google = await loadGoogleMaps(apiKey);

        if (cancelled || !mapRef.current) {
          return;
        }

        overlaysRef.current.forEach((overlay) => overlay.setMap(null));
        overlaysRef.current = [];

        if (heatmapRef.current) {
          heatmapRef.current.setMap(null);
          heatmapRef.current = null;
        }

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: 39.8283, lng: -98.5795 },
          zoom: 4,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });

        const bounds = new google.maps.LatLngBounds();
        const weightedPoints = points.map((point) => {
          const latLng = new google.maps.LatLng(point.latitude, point.longitude);
          bounds.extend(latLng);

          return {
            location: latLng,
            weight: 1,
          };
        });

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds);
        }

        if (google.maps.visualization?.HeatmapLayer) {
          heatmapRef.current = new google.maps.visualization.HeatmapLayer({
            data: weightedPoints,
            map,
            radius: 28,
            opacity: 0.8,
          });
          setStatus('ready');
          return;
        }

        overlaysRef.current = points.map(
          (point) =>
            new google.maps.Circle({
              strokeColor: '#111827',
              strokeOpacity: 0.2,
              strokeWeight: 1,
              fillColor: '#111827',
              fillOpacity: 0.28,
              map,
              center: {
                lat: point.latitude,
                lng: point.longitude,
              },
              radius: 600,
            })
        );

        setStatus('fallback');
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(
            error instanceof Error ? error.message : 'Google Maps could not be loaded right now.'
          );
        }
      }
    };

    void renderMap();

    return () => {
      cancelled = true;
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
      if (heatmapRef.current) {
        heatmapRef.current.setMap(null);
        heatmapRef.current = null;
      }
    };
  }, [apiKey, points]);

  if (!apiKey) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-zinc-600">Map unavailable.</div>
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Google Maps is not configured for browser rendering. The current repo only defines a
          server-side geocoding key.
        </div>
        <div className="h-[520px] w-full rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          {status === 'loading' ? 'Loading Google Maps coverage view…' : null}
          {status === 'ready' ? 'Legend: heatmap intensity reflects restaurant density.' : null}
          {status === 'fallback'
            ? 'Legend: fallback point layer is active because heatmap visualization is unavailable.'
            : null}
          {status === 'error' ? 'Map unavailable.' : null}
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div
        ref={mapRef}
        className="h-[520px] w-full rounded-2xl border border-zinc-200 bg-zinc-100 shadow-sm"
      />
    </div>
  );
}
