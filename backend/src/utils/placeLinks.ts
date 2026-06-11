import type { PlaceResult } from "../types/assistant.js";
import type { Coordinates } from "../types/location.js";

export function buildGoogleMapsUrl(dest: Coordinates, origin?: Coordinates): string {
  const destStr = `${dest.lat},${dest.lng}`;
  if (origin) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destStr}&travelmode=walking`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destStr)}`;
}

export function buildWazeUrl(dest: Coordinates): string {
  return `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`;
}

export function buildPhotoProxyUrl(photoName: string): string {
  return `/api/places/photo?ref=${encodeURIComponent(photoName)}`;
}

export function enrichPlaceWithNavigation(
  place: PlaceResult,
  userCoords?: Coordinates
): PlaceResult {
  if (!place.location) return place;
  return {
    ...place,
    mapsUrl: buildGoogleMapsUrl(place.location, userCoords),
    wazeUrl: buildWazeUrl(place.location),
  };
}

export function enrichPlacesForClient(places: PlaceResult[], userCoords: Coordinates): PlaceResult[] {
  return places.map((p) => enrichPlaceWithNavigation(p, userCoords));
}
