import type { CityFactResult } from "../types/assistant.js";
import type { Coordinates } from "../types/location.js";

const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki/Special:EntityData";
const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const WIKIDATA_SEARCH_URL = "https://www.wikidata.org/w/api.php";
const REQUEST_TIMEOUT_MS = 12_000;
const USER_AGENT = "LocalGuideAI/0.1 (MVP backend)";

export type CityFactsQueryInput = {
  coordinates: Coordinates;
  question: string;
  language?: "es" | "en";
};

type NominatimReverse = {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country?: string;
  };
  extratags?: {
    wikidata?: string;
  };
};

type WikidataEntity = {
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<
    string,
    {
      mainsnak?: {
        datavalue?: {
          value?: string | number | { amount?: string; unit?: string };
        };
      };
      rank?: string;
    }[]
  >;
};

type WikidataEntityResponse = {
  entities?: Record<string, WikidataEntity>;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocode(coords: Coordinates): Promise<NominatimReverse | null> {
  const params = new URLSearchParams({
    lat: String(coords.lat),
    lon: String(coords.lng),
    format: "json",
    addressdetails: "1",
    extratags: "1",
  });
  return fetchJson<NominatimReverse>(`${NOMINATIM_REVERSE_URL}?${params}`);
}

function placeNameFromNominatim(data: NominatimReverse): string | null {
  const addr = data.address;
  if (!addr) return null;
  const name = addr.city ?? addr.town ?? addr.village ?? addr.municipality;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function parsePopulationAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "object" && raw !== null && "amount" in raw) {
    const amount = (raw as { amount?: string }).amount;
    if (typeof amount === "string") {
      const n = Number(amount.replace(/^\+/, ""));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function parseAreaAmount(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && "amount" in raw) {
    const amount = (raw as { amount?: string }).amount;
    if (typeof amount === "string") {
      const n = Number(amount.replace(/^\+/, ""));
      if (Number.isFinite(n)) {
        return `${n.toLocaleString("es")} km²`;
      }
    }
  }
  return null;
}

async function searchCityQidByName(name: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "es",
    format: "json",
    limit: "5",
  });
  const json = await fetchJson<{
    search?: { id?: string; description?: string }[];
  }>(`${WIKIDATA_SEARCH_URL}?${params}`);
  const hit = json?.search?.find((s) => s.id?.startsWith("Q"));
  return hit?.id ?? null;
}

async function findNearestCityQid(coords: Coordinates): Promise<string | null> {
  const sparql = `
SELECT ?city WHERE {
  SERVICE wikibase:around {
    ?city wdt:P31/wdt:P279* wd:Q486972 .
    ?city wdt:P625 ?location .
    bd:serviceParam wikibase:center "Point(${coords.lng} ${coords.lat})^^geo:wktLiteral" .
    bd:serviceParam wikibase:radius "25" .
  }
}
LIMIT 1`;

  const url = `${WIKIDATA_SPARQL_URL}?${new URLSearchParams({ query: sparql, format: "json" })}`;
  const json = await fetchJson<{
    results?: { bindings?: { city?: { value?: string } }[] };
  }>(url, { headers: { Accept: "application/sparql-results+json" } });

  const uri = json?.results?.bindings?.[0]?.city?.value;
  if (!uri) return null;
  const match = uri.match(/(Q\d+)$/);
  return match?.[1] ?? null;
}

function factsFromEntity(
  qid: string,
  entity: WikidataEntity,
  lang: "es" | "en",
  placeHint?: string | null
): CityFactResult[] {
  const facts: CityFactResult[] = [];
  const label =
    entity.labels?.[lang]?.value ??
    entity.labels?.es?.value ??
    entity.labels?.en?.value ??
    placeHint ??
    qid;
  const description =
    entity.descriptions?.[lang]?.value ??
    entity.descriptions?.es?.value ??
    entity.descriptions?.en?.value;

  const populationClaims = entity.claims?.P1082 ?? [];
  const preferredPop =
    populationClaims.find((c) => c.rank === "preferred") ?? populationClaims[0];
  const population = parsePopulationAmount(preferredPop?.mainsnak?.datavalue?.value);

  const areaClaims = entity.claims?.P2046 ?? [];
  const preferredArea = areaClaims.find((c) => c.rank === "preferred") ?? areaClaims[0];
  const area = parseAreaAmount(preferredArea?.mainsnak?.datavalue?.value);

  const parts: string[] = [];
  if (lang === "en") {
    parts.push(`Place: ${label} (Wikidata ${qid}).`);
    if (description) parts.push(description);
    if (population != null) parts.push(`Population (Wikidata): ${population.toLocaleString("en")}.`);
    if (area) parts.push(`Area (Wikidata): ${area}.`);
  } else {
    parts.push(`Lugar: ${label} (Wikidata ${qid}).`);
    if (description) parts.push(description);
    if (population != null) parts.push(`Población (Wikidata): ${population.toLocaleString("es")}.`);
    if (area) parts.push(`Superficie (Wikidata): ${area}.`);
  }

  facts.push({ summary: parts.join(" "), source: "wikidata" });
  return facts;
}

async function fetchEntityFacts(
  qid: string,
  lang: "es" | "en",
  placeHint?: string | null
): Promise<CityFactResult[]> {
  const json = await fetchJson<WikidataEntityResponse>(`${WIKIDATA_ENTITY_URL}/${qid}.json`);
  const entity = json?.entities?.[qid];
  if (!entity) return [];
  return factsFromEntity(qid, entity, lang, placeHint);
}

/**
 * Hechos de ciudad desde Wikidata (vía Nominatim + entidad o SPARQL cercano).
 * Solo devuelve datos verificables; sin resultados → array vacío.
 */
export async function fetchCityFacts(input: CityFactsQueryInput): Promise<CityFactResult[]> {
  const lang = input.language ?? "es";
  const nominatim = await reverseGeocode(input.coordinates);
  const placeHint = nominatim ? placeNameFromNominatim(nominatim) : null;

  if (placeHint) {
    const byNameQid = await searchCityQidByName(placeHint);
    if (byNameQid) {
      const facts = await fetchEntityFacts(byNameQid, lang, placeHint);
      if (facts.length > 0) return facts;
    }
  }

  const nearestQid = await findNearestCityQid(input.coordinates);
  if (nearestQid) {
    const facts = await fetchEntityFacts(nearestQid, lang, placeHint);
    if (facts.length > 0) return facts;
  }

  return [];
}
