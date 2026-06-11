import type { MemoryPlaceRef, SavedPlace, ConversationTurn } from "../types/memory.js";

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

export function isMemoryRecallQuestion(question: string): boolean {
  const n = normalizeText(question);
  return /te acord|te acuerd|recordas|recuerdas|donde quedaba|donde era|donde quedo|que me recomend|me recomendaste|cual era|ubicacion de|direccion de|dirección de|apunte|apuntaste|lo que guard|lugares guard/.test(
    n
  );
}

export function isSavePlaceQuestion(question: string): boolean {
  const n = normalizeText(question);
  return /apunta|anota|guarda|guardá|recorda|recordá|fijate este|quiero volver|guardar este|este lugar me interesa|me interesa.*volver/.test(
    n
  );
}

function dedupePlaces(places: MemoryPlaceRef[]): MemoryPlaceRef[] {
  const seen = new Set<string>();
  const out: MemoryPlaceRef[] = [];
  for (const p of places) {
    const key = `${p.id ?? ""}|${normalizeText(p.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function collectMemoryPlaces(
  history: ConversationTurn[],
  savedPlaces: SavedPlace[]
): MemoryPlaceRef[] {
  const fromHistory: MemoryPlaceRef[] = [];
  for (const turn of history) {
    if (turn.role === "assistant" && turn.places?.length) {
      fromHistory.push(...turn.places);
    }
  }
  return dedupePlaces([...savedPlaces, ...fromHistory]);
}

export function findPlaceInMemory(
  question: string,
  places: MemoryPlaceRef[]
): MemoryPlaceRef | null {
  const n = normalizeText(question);
  if (!places.length) return null;

  for (const p of places) {
    const name = normalizeText(p.name);
    if (name.length > 2 && n.includes(name)) return p;
  }

  let best: MemoryPlaceRef | null = null;
  let bestScore = 0;
  for (const p of places) {
    const words = normalizeText(p.name)
      .split(/\s+/)
      .filter((w) => w.length > 3);
    let score = 0;
    for (const w of words) {
      if (n.includes(w)) score += w.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (best && bestScore >= 5) return best;

  if (/primer|1\b/.test(n) && places[0]) return places[0];
  if (/segund|2\b/.test(n) && places[1]) return places[1];
  if (/tercer|3\b/.test(n) && places[2]) return places[2];

  return null;
}

export function formatMemoryRecallAnswer(
  place: MemoryPlaceRef,
  lang: "es" | "en",
  fromSaved: boolean
): string {
  const bits: string[] = [];
  if (lang === "en") {
    bits.push(`Yes — ${place.name}`);
    if (place.address) bits.push(`it's at ${place.address}`);
    if (fromSaved) bits.push("you saved this place earlier");
    bits.push('say "open the map" if you want directions');
    return `${bits.join(". ")}.`;
  }
  bits.push(`Sí — ${place.name}`);
  if (place.address) bits.push(`queda en ${place.address}`);
  if (fromSaved) bits.push("lo tenés apuntado");
  bits.push('decí «abrí el mapa» si querés ir');
  return `${bits.join(". ")}.`;
}

export function noMemoryMatchMessage(lang: "es" | "en"): string {
  if (lang === "en") {
    return "I don't find that place in our conversation or saved spots. You can save one by saying «save this place» after a recommendation.";
  }
  return "No encuentro ese lugar en lo que hablamos ni en tus apuntes. Podés apuntar uno diciendo «apuntá este lugar» después de una recomendación.";
}
