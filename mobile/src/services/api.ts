import type { UserProfile } from "../types/userProfile";

export type AskPayload = {
  question: string;
  lat: number;
  lng: number;
  userProfile?: UserProfile;
};

export type PlaceResult = {
  id?: string;
  name: string;
  address?: string;
  rating?: number;
  userRatingsTotal?: number;
  photoUrl?: string;
  mapsUrl?: string;
  wazeUrl?: string;
  source: "google_places" | "osm";
};

export type AskResponse = {
  answer: string;
  simulated: boolean;
  location: { lat: number; lng: number };
  sources: string[];
  places?: PlaceResult[];
};

export function resolveAssetUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const base = getBaseUrl();
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

const DEFAULT_API_BASE = "http://localhost:3011";

function getBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim().replace(/\/$/, "");
  }
  return DEFAULT_API_BASE;
}

export async function askAssistant(payload: AskPayload): Promise<AskResponse> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/assistant/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = (await res.json()) as { error?: string };
      detail = errJson.error ?? "";
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `Error del servidor (${res.status})`);
  }

  return (await res.json()) as AskResponse;
}
