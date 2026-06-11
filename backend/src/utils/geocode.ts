import type { Coordinates } from "../types/location.js";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "LocalGuideAI/0.1 (MVP backend)";

type NominatimReverse = {
  display_name?: string;
  address?: {
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country?: string;
  };
};

async function fetchReverse(coords: Coordinates): Promise<NominatimReverse | null> {
  const params = new URLSearchParams({
    lat: String(coords.lat),
    lon: String(coords.lng),
    format: "json",
    addressdetails: "1",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${NOMINATIM_REVERSE_URL}?${params}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "Accept-Language": "es,en",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as NominatimReverse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function labelFromAddress(data: NominatimReverse): string | null {
  const a = data.address;
  if (!a) return null;

  const locality = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb;
  const area = a.neighbourhood ?? a.suburb;
  const parts = [area, locality, a.state, a.country].filter(Boolean);
  if (parts.length > 0) return parts.join(", ");

  if (data.display_name?.trim()) {
    const short = data.display_name.split(",").slice(0, 3).join(",").trim();
    return short || null;
  }
  return null;
}

/** Nombre del lugar a partir de coordenadas (Nominatim). Sin inventar datos. */
export async function resolvePlaceLabel(
  coords: Coordinates,
  _lang?: "es" | "en"
): Promise<string | null> {
  const data = await fetchReverse(coords);
  if (!data) return null;
  return labelFromAddress(data);
}
