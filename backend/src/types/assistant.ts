import type { Coordinates } from "./location.js";
import type { ConversationTurn, SavedPlace } from "./memory.js";
import type { UserProfile } from "./userProfile.js";

export type AssistantRequest = {
  question: string;
  coordinates: Coordinates;
  userProfile?: UserProfile;
  conversationHistory?: ConversationTurn[];
  savedPlaces?: SavedPlace[];
};

export type AssistantResponse = {
  answer: string;
  simulated: boolean;
  location: Coordinates;
  sources: string[];
  /** Lugares estructurados (fotos, mapas) cuando la intención es `places`. */
  places?: PlaceResult[];
};

/** Resultado de un lugar (Google Places / OSM). */
export type PlaceResult = {
  id?: string;
  name: string;
  address?: string;
  rating?: number;
  userRatingsTotal?: number;
  types?: string[];
  location?: Coordinates;
  openNow?: boolean;
  /** Valor bruto de la API (p. ej. PRICE_LEVEL_MODERATE). */
  priceLevel?: string;
  source: "google_places" | "osm";
  /** URL relativa al backend (`/api/places/photo?...`) o absoluta. */
  photoUrl?: string;
  mapsUrl?: string;
  wazeUrl?: string;
};

/** Hechos de ciudad / enciclopedia (Wikidata / Wikipedia). Sin datos inventados. */
export type CityFactResult = {
  summary: string;
  source?: "wikidata" | "wikipedia";
};
