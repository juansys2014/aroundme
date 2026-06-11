import { env } from "../config/env.js";
import type { CityFactResult, PlaceResult } from "../types/assistant.js";
import type { Coordinates } from "../types/location.js";
import type { ConversationTurn, SavedPlace } from "../types/memory.js";
import type { UserProfile } from "../types/userProfile.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 12_000;

export type IntentKind = "places" | "city_facts" | "where_am_i" | "general_local" | "unknown";

export type PlaceCategory =
  | "restaurant"
  | "park"
  | "museum"
  | "hotel"
  | "cafe"
  | "bar"
  | "other";

export type IntentAnalysis = {
  intent: IntentKind;
  category: PlaceCategory;
  searchQuery: string;
  language: "es" | "en";
};

export type InterpretIntentParams = {
  question: string;
  userProfile?: UserProfile;
  conversationHistory?: ConversationTurn[];
};

export type ComposeAssistantParams = {
  question: string;
  userProfile?: UserProfile;
  coordinates: Coordinates;
  places?: PlaceResult[];
  cityFacts?: CityFactResult[];
  sources: string[];
  conversationHistory?: ConversationTurn[];
  savedPlaces?: SavedPlace[];
};

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

async function callOpenAIChat(params: {
  messages: ChatMessage[];
  jsonMode: boolean;
}): Promise<string | null> {
  const apiKey = env.openaiApiKey;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: env.openaiModel,
      messages: params.messages,
      temperature: 0.2,
    };
    if (params.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.error("OpenAI: HTTP", res.status);
      }
      return null;
    }

    let json: { choices?: { message?: { content?: string | null } }[] };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      return null;
    }

    const text = json.choices?.[0]?.message?.content;
    return typeof text === "string" ? text : null;
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      const name = e instanceof Error ? e.name : "error";
      console.error("OpenAI: solicitud fallida", name);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const INTENT_KINDS = new Set<IntentKind>([
  "places",
  "city_facts",
  "where_am_i",
  "general_local",
  "unknown",
]);
const CATEGORIES = new Set<PlaceCategory>([
  "restaurant",
  "park",
  "museum",
  "hotel",
  "cafe",
  "bar",
  "other",
]);

function parseIntentJson(raw: string): IntentAnalysis | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  const intentRaw = typeof o.intent === "string" ? o.intent.trim() : "";
  const normalizedIntent = intentRaw === "general" ? "general_local" : intentRaw;
  if (!INTENT_KINDS.has(normalizedIntent as IntentKind)) return null;
  const category = o.category;
  const searchQuery = o.searchQuery;
  const language = o.language;
  if (typeof category !== "string" || !CATEGORIES.has(category as PlaceCategory)) return null;
  if (typeof searchQuery !== "string" || !searchQuery.trim()) return null;
  if (language !== "es" && language !== "en") return null;

  return {
    intent: normalizedIntent as IntentKind,
    category: category as PlaceCategory,
    searchQuery: searchQuery.trim(),
    language,
  };
}

/**
 * Interpreta intención y query de búsqueda vía OpenAI (JSON).
 * Sin key o si falla: devuelve `null` (el orquestador usa fallback por palabras clave).
 */
export async function interpretQuestionIntent(
  params: InterpretIntentParams
): Promise<IntentAnalysis | null> {
  if (!env.openaiApiKey) return null;

  const profileHint = params.userProfile
    ? `Perfil usuario (solo contexto, no inventar datos): nombre ${params.userProfile.name}, idioma ${params.userProfile.language}, intereses ${params.userProfile.interests.join(", ")}, comidas ${params.userProfile.foodPreferences.join(", ")}, presupuesto ${params.userProfile.budget}.`
    : "Sin perfil de usuario.";

  const system = `Eres un clasificador de intenciones para una app de guía local. Responde SOLO un JSON válido con esta forma exacta:
{"intent":"places"|"city_facts"|"where_am_i"|"general_local"|"unknown","category":"restaurant"|"park"|"museum"|"hotel"|"cafe"|"bar"|"other","searchQuery":"string","language":"es"|"en"}

Reglas:
- intent=places: buscar locales físicos (restaurantes, bares, parques, plazas, museos, hoteles, cafés).
- intent=city_facts: población, industria, historia estadística, datos enciclopédicos de la ciudad.
- intent=where_am_i: el usuario pregunta dónde está, en qué lugar/ciudad se encuentra, o cómo se llama el sitio actual.
- intent=general_local: turismo amplio sin encaje claro en places ni city_facts.
- intent=unknown: saludos, charla, o fuera de alcance.
- searchQuery: texto corto para Google Places Text Search cuando intent=places. Para city_facts u otros intents, usa una reformulación breve de la pregunta (nunca cadena vacía).
- language: idioma preferido de la respuesta (es o en), alineado al perfil o al idioma de la pregunta.
- No incluyas explicación fuera del JSON.`;

  const historyHint =
    params.conversationHistory?.length ?
      `\nHistorial reciente (contexto):\n${JSON.stringify(params.conversationHistory.slice(-12))}`
    : "";

  const user = `${profileHint}${historyHint}\nPregunta: ${params.question.trim()}`;

  const content = await callOpenAIChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonMode: true,
  });

  if (!content) return null;
  return parseIntentJson(content.trim());
}

/**
 * Redacta respuesta natural usando únicamente datos suministrados (lugares, hechos, fuentes).
 * Sin key o error: devuelve `null` para que el orquestador use el formato fijo.
 */
export async function composeAssistantAnswer(
  params: ComposeAssistantParams
): Promise<{ text: string } | null> {
  if (!env.openaiApiKey) return null;

  const payload = {
    question: params.question,
    userProfile: params.userProfile ?? null,
    coordinates: params.coordinates,
    places: params.places ?? [],
    cityFacts: params.cityFacts ?? [],
    sources: params.sources,
    conversationHistory: params.conversationHistory?.slice(-16) ?? [],
    savedPlaces: params.savedPlaces ?? [],
  };

  const system = `Eres un asistente de guía local. Debes redactar una respuesta clara y natural en el idioma del usuario (es o en según el contexto de la pregunta y perfil).

REGLAS ESTRICTAS:
- Usa ÚNICAMENTe nombres, direcciones, ratings, cantidad de reseñas y tipos que aparezcan en el bloque JSON "places" o hechos en "cityFacts". Esos datos provienen de APIs; no los modifiques ni inventes valores.
- NO inventes negocios, población, estadísticas, horarios ni precios que no estén en el JSON.
- Si "places" está vacío y "cityFacts" está vacío, indica claramente que no hay datos confiables suficientes todavía y no inventes listados.
- No menciones de dónde provienen los datos (Google, OpenStreetMap, Wikidata, APIs, fuentes, etc.). Responde directo, como un guía local.
- No reveles claves API ni datos internos del sistema.
- NUNCA menciones coordenadas GPS, latitud, longitud ni números de ubicación en la respuesta, salvo que la pregunta sea explícitamente sobre dónde está el usuario.
- NO uses el nombre del usuario en cada respuesta. Solo saludalo por nombre si la pregunta es un saludo (hola, buen día, buenas tardes, etc.).
- NUNCA digas que faltan conectar APIs o que la respuesta es simulada; el sistema ya tiene proveedores activos.
- Si hay "conversationHistory" o "savedPlaces", úsalos para preguntas sobre recomendaciones anteriores, lugares apuntados o «¿te acordás…?». Solo menciona lugares que aparezcan ahí; no inventes nombres ni direcciones.`;

  const user = `DATOS_JSON (solo hechos permitidos para redactar):\n${JSON.stringify(payload)}`;

  const content = await callOpenAIChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonMode: false,
  });

  if (!content || !content.trim()) return null;
  return { text: content.trim() };
}
