import 'server-only';

export function getGoogleServerApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_GEOCODING_API_KEY || null;
}
