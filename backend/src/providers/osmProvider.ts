import type { PlaceResult } from "../types/assistant.js";
import type { Coordinates } from "../types/location.js";
import type { PlaceCategory } from "./openaiProvider.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "LocalGuideAI/0.1 (MVP backend)";

export type OsmNearbyInput = {
  coordinates: Coordinates;
  category?: PlaceCategory;
  radiusMeters?: number;
};

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

const CATEGORY_FILTERS: Record<PlaceCategory, string[]> = {
  restaurant: ['["amenity"="restaurant"]', '["amenity"="fast_food"]'],
  cafe: ['["amenity"="cafe"]'],
  bar: ['["amenity"="bar"]', '["amenity"="pub"]'],
  museum: ['["tourism"="museum"]', '["amenity"="museum"]'],
  park: ['["leisure"="park"]', '["leisure"="garden"]'],
  hotel: ['["tourism"="hotel"]', '["tourism"="hostel"]'],
  other: [
    '["amenity"="restaurant"]',
    '["amenity"="cafe"]',
    '["tourism"="museum"]',
    '["leisure"="park"]',
  ],
};

function buildOverpassQuery(coords: Coordinates, category: PlaceCategory, radius: number): string {
  const filters = CATEGORY_FILTERS[category] ?? CATEGORY_FILTERS.other;
  const around = `around:${radius},${coords.lat},${coords.lng}`;
  const blocks = filters
    .map((f) => `node${f}(${around});\n  way${f}(${around});`)
    .join("\n  ");
  return `[out:json][timeout:8];\n(\n  ${blocks}\n);\nout center 12;`;
}

function elementCoords(el: OverpassElement): Coordinates | undefined {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }
  return undefined;
}

function formatAddress(tags: Record<string, string>): string | undefined {
  if (tags["addr:full"]) return tags["addr:full"];
  const parts = [tags["addr:street"], tags["addr:housenumber"], tags["addr:city"]].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function mapElement(el: OverpassElement): PlaceResult | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;

  const types: string[] = [];
  if (tags.amenity) types.push(tags.amenity);
  if (tags.tourism) types.push(tags.tourism);
  if (tags.leisure) types.push(tags.leisure);

  return {
    id: el.id != null ? `osm-${el.type}-${el.id}` : undefined,
    name,
    address: formatAddress(tags),
    types: types.length > 0 ? types : undefined,
    location: elementCoords(el),
    source: "osm",
  };
}

/**
 * POI cercanos vía Overpass API (OpenStreetMap). Sin key; respeta rate limits con User-Agent.
 */
export async function searchOsmNearby(input: OsmNearbyInput): Promise<PlaceResult[]> {
  const category = input.category ?? "other";
  const radius = Math.min(Math.max(input.radiusMeters ?? 2000, 200), 8000);
  const query = buildOverpassQuery(input.coordinates, category, radius);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!res.ok) return [];

    const json = (await res.json()) as OverpassResponse;
    const elements = Array.isArray(json.elements) ? json.elements : [];
    const seen = new Set<string>();
    const places: PlaceResult[] = [];

    for (const el of elements) {
      const mapped = mapElement(el);
      if (!mapped) continue;
      const key = mapped.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(mapped);
      if (places.length >= 10) break;
    }

    return places;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
