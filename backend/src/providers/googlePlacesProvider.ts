import { env } from "../config/env.js";
import type { PlaceResult } from "../types/assistant.js";
import type { Coordinates } from "../types/location.js";
import { buildPhotoProxyUrl } from "../utils/placeLinks.js";

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const REQUEST_TIMEOUT_MS = 8000;

const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.types,places.location,places.currentOpeningHours,places.priceLevel,places.photos";

export type SearchNearbyPlacesParams = {
  coordinates: Coordinates;
  query: string;
  radiusMeters?: number;
  language?: "es" | "en";
};

/** Resultado de búsqueda: nunca incluye la API key. */
export type NearbySearchOutcome = {
  places: PlaceResult[];
  /** Timeout, HTTP no exitoso o cuerpo inválido: el orquestador debe volver a modo simulado. */
  requestFailed: boolean;
};

type GooglePlaceRaw = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  location?: { latitude?: number; longitude?: number };
  currentOpeningHours?: { openNow?: boolean };
  priceLevel?: string;
  photos?: { name?: string }[];
};

type SearchTextResponse = {
  places?: GooglePlaceRaw[];
  error?: { code?: number; message?: string; status?: string };
};

function mapPlace(p: GooglePlaceRaw): PlaceResult {
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  const photoName = p.photos?.[0]?.name?.trim();
  return {
    id: p.id,
    name: p.displayName?.text?.trim() || "Sin nombre",
    address: p.formattedAddress,
    rating: typeof p.rating === "number" ? p.rating : undefined,
    userRatingsTotal: typeof p.userRatingCount === "number" ? p.userRatingCount : undefined,
    types: Array.isArray(p.types) ? p.types : undefined,
    location:
      typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : undefined,
    openNow: typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : undefined,
    priceLevel: typeof p.priceLevel === "string" ? p.priceLevel : undefined,
    photoUrl: photoName ? buildPhotoProxyUrl(photoName) : undefined,
    source: "google_places",
  };
}

/**
 * Búsqueda de lugares con Google Places API (New) — Text Search.
 * Sin key, errores o timeout: devuelve listado vacío y `requestFailed` según corresponda.
 */
export async function searchNearbyPlaces(params: SearchNearbyPlacesParams): Promise<NearbySearchOutcome> {
  const apiKey = env.googlePlacesApiKey;
  if (!apiKey) {
    return { places: [], requestFailed: false };
  }

  const q = params.query.trim();
  if (!q) {
    return { places: [], requestFailed: false };
  }

  const radius = Math.min(Math.max(params.radiusMeters ?? 2500, 100), 50000);
  const languageCode = params.language === "en" ? "en" : "es";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(PLACES_SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: q,
        maxResultCount: 10,
        languageCode,
        locationBias: {
          circle: {
            center: {
              latitude: params.coordinates.lat,
              longitude: params.coordinates.lng,
            },
            radius,
          },
        },
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    let json: SearchTextResponse;
    try {
      json = JSON.parse(text) as SearchTextResponse;
    } catch {
      return { places: [], requestFailed: true };
    }

    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Google Places: respuesta HTTP", res.status);
      }
      return { places: [], requestFailed: true };
    }

    if (json.error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Google Places: error en cuerpo", json.error.status ?? json.error.code);
      }
      return { places: [], requestFailed: true };
    }

    const rawList = Array.isArray(json.places) ? json.places : [];
    const places = rawList.map(mapPlace).filter((p) => p.name.length > 0);

    return { places, requestFailed: false };
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      const msg = e instanceof Error ? e.name : "unknown";
      console.error("Google Places: fallo de solicitud", msg);
    }
    return { places: [], requestFailed: true };
  } finally {
    clearTimeout(timeout);
  }
}
