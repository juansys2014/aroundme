import type { Coordinates } from "./location.js";

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
  places?: MemoryPlaceRef[];
};

export type MemoryPlaceRef = {
  id?: string;
  name: string;
  address?: string;
  rating?: number;
  location?: Coordinates;
  mapsUrl?: string;
  wazeUrl?: string;
};

export type SavedPlace = MemoryPlaceRef & {
  savedAt?: string;
  note?: string;
};
