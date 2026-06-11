import { env } from "../config/env.js";
import { searchNearbyPlaces } from "../providers/googlePlacesProvider.js";
import { searchOsmNearby } from "../providers/osmProvider.js";
import {
  composeAssistantAnswer,
  interpretQuestionIntent,
  type IntentAnalysis,
  type PlaceCategory,
} from "../providers/openaiProvider.js";
import { fetchCityFacts } from "../providers/wikidataProvider.js";
import type { AssistantRequest, AssistantResponse, CityFactResult, PlaceResult } from "../types/assistant.js";
import type { UserProfile } from "../types/userProfile.js";
import { resolvePlaceLabel } from "../utils/geocode.js";
import {
  collectMemoryPlaces,
  findPlaceInMemory,
  formatMemoryRecallAnswer,
  isMemoryRecallQuestion,
  noMemoryMatchMessage,
} from "../utils/memoryRecall.js";
import { enrichPlacesForClient } from "../utils/placeLinks.js";

function joinNatural(parts: string[], lang: "es" | "en"): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (lang === "en") {
    const allButLast = parts.slice(0, -1).join(", ");
    return `${allButLast} and ${parts[parts.length - 1]}`;
  }
  const allButLast = parts.slice(0, -1).join(", ");
  return `${allButLast} y ${parts[parts.length - 1]}`;
}

function normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

const PLACE_KEYWORDS = [
  "restaurante",
  "comer",
  "comida",
  "pasta",
  "cafe",
  "bar",
  "plaza",
  "parque",
  "museo",
  "hotel",
  "turistico",
  "turismo",
  "turist",
  "atraccion",
  "monumento",
  "restaurant",
  "eat",
  "food",
  "coffee",
  "park",
  "museum",
];

function isPlaceLikeQuestion(question: string): boolean {
  const n = normalizeText(question);
  for (const kw of PLACE_KEYWORDS) {
    if (kw === "bar") {
      if (/\bbar\b/.test(n)) return true;
      continue;
    }
    if (n.includes(kw)) return true;
  }
  return false;
}

function buildPlacesSearchQuery(question: string, profile?: UserProfile): string {
  const q = question.trim();
  const n = normalizeText(q);
  const prefs = profile?.foodPreferences ?? [];
  if (prefs.length === 0) return q;

  const generic =
    n.includes("comer") ||
    n.includes("donde") ||
    n.includes("lugares") ||
    n.includes("sitios") ||
    n.includes("recomend") ||
    n.includes("opciones") ||
    n.includes("near") ||
    n.includes("where") ||
    n.includes("place") ||
    q.length < 48;
  const hasFoodHint = prefs.some((p) => n.includes(normalizeText(p)));

  if (generic && !hasFoodHint) {
    const extra = prefs.map((p) => `restaurante ${p}`).join(" ");
    return `${q} ${extra}`.trim();
  }
  return q;
}

function apisAreLive(): boolean {
  return (
    env.enableRealProviders &&
    (env.openaiApiKey.length > 0 || env.googlePlacesApiKey.length > 0)
  );
}

function isGreetingQuestion(question: string): boolean {
  const n = normalizeText(question.trim());
  if (n.length > 80) return false;
  const hints = [
    "hola",
    "buen dia",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "buenas",
    "que tal",
    "como estas",
    "como andas",
    "hello",
    "good morning",
    "good afternoon",
    "good evening",
    "hey",
  ];
  if (/^(hi|hey)\b/.test(n)) return true;
  return hints.some((h) => n === h || n.startsWith(`${h} `) || n.includes(h));
}

function isProfileNameQuestion(question: string): boolean {
  const n = normalizeText(question.trim());
  if (n.length > 90) return false;
  return (
    /como me llamo|como me llamas|como me llaman|cual es mi nombre|cual es mi name|como es mi nombre|sabes como me llamo|como te registro|me llamo\b/.test(
      n
    ) ||
    /what is my name|what's my name|what do you call me|do you know my name/.test(n)
  );
}

function buildProfileNameAnswer(request: AssistantRequest, lang: "es" | "en"): string {
  const name = request.userProfile?.name?.trim();
  if (lang === "en") {
    if (name) {
      return `You're ${name} — that's what's saved in your profile. How can I help you today?`;
    }
    return "I don't have your name yet. Add it in Settings so I can address you.";
  }
  if (name) {
    return `Te llamás ${name}, según tu perfil. ¿En qué te ayudo?`;
  }
  return "Todavía no tengo tu nombre guardado. Podés cargarlo en Ajustes.";
}

function buildGreetingAnswer(request: AssistantRequest, lang: "es" | "en"): string {
  const n = normalizeText(request.question);
  const name = request.userProfile?.name?.trim();

  if (lang === "en") {
    let greet = "Hello";
    if (n.includes("morning")) greet = "Good morning";
    else if (n.includes("afternoon")) greet = "Good afternoon";
    else if (n.includes("evening")) greet = "Good evening";
    const hi = name ? `${greet}, ${name}.` : `${greet}!`;
    return `${hi} I'm your local guide — ask me about nearby places or where you are.`;
  }

  let greet = "Hola";
  if (n.includes("buen dia") || n.includes("buenos dias")) greet = "Buen día";
  else if (n.includes("buenas tardes")) greet = "Buenas tardes";
  else if (n.includes("buenas noches")) greet = "Buenas noches";
  else if (n.startsWith("buenas")) greet = "Buenas";
  const hi = name ? `${greet}, ${name}.` : `${greet}!`;
  return `${hi} Soy tu guía local — preguntame por lugares cerca o decime «¿dónde estoy?».`;
}

function buildHelpfulFallback(request: AssistantRequest, lang: "es" | "en"): string {
  if (isGreetingQuestion(request.question)) {
    return buildGreetingAnswer(request, lang);
  }
  if (lang === "en") {
    return "I can help you find nearby restaurants, parks, museums and more, or tell you where you are. What would you like to know?";
  }
  return "Puedo ayudarte a buscar restaurantes, lugares y datos de la zona, o decirte dónde estás. ¿Qué querés saber?";
}

function memoryPayload(request: AssistantRequest) {
  return {
    conversationHistory: request.conversationHistory,
    savedPlaces: request.savedPlaces,
  };
}

async function tryComposeGeneralAnswer(request: AssistantRequest): Promise<string | null> {
  if (!env.openaiApiKey) return null;
  const composed = await composeAssistantAnswer({
    question: request.question,
    userProfile: request.userProfile,
    coordinates: request.coordinates,
    places: [],
    cityFacts: [],
    sources: [],
    ...memoryPayload(request),
  });
  return composed?.text?.trim() || null;
}

async function buildMemoryRecallResponse(
  request: AssistantRequest,
  lang: "es" | "en"
): Promise<AssistantResponse> {
  const history = request.conversationHistory ?? [];
  const saved = request.savedPlaces ?? [];
  const all = collectMemoryPlaces(history, saved);
  const match = findPlaceInMemory(request.question, all);

  if (match) {
    const fromSaved = saved.some(
      (s) => s.name.toLowerCase() === match.name.toLowerCase()
    );
    const base: PlaceResult = {
      id: match.id,
      name: match.name,
      address: match.address,
      location: match.location,
      mapsUrl: match.mapsUrl,
      wazeUrl: match.wazeUrl,
      source: "google_places",
    };
    const places = match.location
      ? enrichPlacesForClient([base], request.coordinates)
      : [base];
    return {
      answer: formatMemoryRecallAnswer(match, lang, fromSaved),
      simulated: false,
      location: { ...request.coordinates },
      sources: [],
      places,
    };
  }

  const composed = await tryComposeGeneralAnswer(request);
  if (composed) {
    return {
      answer: composed,
      simulated: false,
      location: { ...request.coordinates },
      sources: [],
    };
  }

  return {
    answer: noMemoryMatchMessage(lang),
    simulated: true,
    location: { ...request.coordinates },
    sources: [],
  };
}

function isWhereAmIQuestion(question: string): boolean {
  const n = normalizeText(question);
  const hints = [
    "donde estoy",
    "a donde estoy",
    "donde me encuentro",
    "en que lugar",
    "que lugar es",
    "como se llama este lugar",
    "contame donde estoy",
    "cuentame donde estoy",
    "en que ciudad estoy",
    "donde estamos",
    "where am i",
    "what place is this",
    "where am i located",
  ];
  return hints.some((h) => n.includes(h));
}

function keywordFallbackIntent(request: AssistantRequest): IntentAnalysis {
  const lang = request.userProfile?.language ?? "es";
  const n = normalizeText(request.question);

  if (isWhereAmIQuestion(request.question)) {
    return {
      intent: "where_am_i",
      category: "other",
      searchQuery: request.question.trim() || "ubicacion actual",
      language: lang,
    };
  }

  const cityFactHints = [
    "habitantes",
    "poblacion",
    "industria",
    "censo",
    "wikidata",
    "demografia",
  ];
  if (cityFactHints.some((h) => n.includes(h))) {
    return {
      intent: "city_facts",
      category: "other",
      searchQuery: request.question.trim() || "datos ciudad",
      language: lang,
    };
  }
  if (isPlaceLikeQuestion(request.question)) {
    return {
      intent: "places",
      category: "other",
      searchQuery: buildPlacesSearchQuery(request.question, request.userProfile),
      language: lang,
    };
  }
  return {
    intent: "unknown",
    category: "other",
    searchQuery: request.question.trim() || "local",
    language: lang,
  };
}

function formatGooglePlacesAnswer(
  request: AssistantRequest,
  places: PlaceResult[],
  overrideLang?: "es" | "en"
): string {
  const profile = request.userProfile;
  const lang = overrideLang ?? profile?.language ?? "es";
  const lines = places.map((p, i) => {
    const bits: string[] = [`${i + 1}. ${p.name}`];
    if (p.rating != null) {
      const reviews =
        p.userRatingsTotal != null
          ? lang === "en"
            ? ` (${p.userRatingsTotal} reviews)`
            : ` (${p.userRatingsTotal} reseñas)`
          : "";
      bits.push(lang === "en" ? `— rating ${p.rating}${reviews}` : `— rating ${p.rating}${reviews}`);
    }
    if (p.address) bits.push(`— ${p.address}`);
    return bits.join(" ");
  });

  const intro =
    lang === "en"
      ? "I found some nearby options that might match your search:"
      : "Encontré algunas opciones cercanas que podrían coincidir con tu búsqueda:";

  return `${intro}\n${lines.join("\n")}`;
}

function noReliablePlacesNearbyMessage(lang: "es" | "en"): string {
  if (lang === "en") {
    return "No reliable results were found nearby for your search. Try a wider area or different wording.";
  }
  return "No encontré resultados confiables cerca con tu búsqueda. Probá ampliar el área o reformular la pregunta.";
}

function noReliableCityFactsMessage(lang: "es" | "en"): string {
  if (lang === "en") {
    return "I could not find verifiable city information for this area right now.";
  }
  return "No encontré datos verificables de la ciudad para esta zona en este momento.";
}

function formatCityFactsAnswer(
  request: AssistantRequest,
  facts: CityFactResult[],
  overrideLang?: "es" | "en"
): string {
  const lang = overrideLang ?? request.userProfile?.language ?? "es";
  const body = facts.map((f) => f.summary).join("\n\n");
  return body;
}

function formatOsmPlacesAnswer(
  request: AssistantRequest,
  places: PlaceResult[],
  overrideLang?: "es" | "en"
): string {
  const lang = overrideLang ?? request.userProfile?.language ?? "es";
  const lines = places.map((p, i) => {
    const bits: string[] = [`${i + 1}. ${p.name}`];
    if (p.address) bits.push(`— ${p.address}`);
    if (p.types?.length) bits.push(`— ${p.types.join(", ")}`);
    return bits.join(" ");
  });

  const intro =
    lang === "en" ? "Nearby options:" : "Opciones cercanas:";

  return `${intro}\n${lines.join("\n")}`;
}

async function resolvePlaces(
  request: AssistantRequest,
  analysis: IntentAnalysis
): Promise<{ places: PlaceResult[]; sources: string[]; requestFailed: boolean }> {
  const sources: string[] = [];
  let requestFailed = false;

  if (canUseGooglePlaces()) {
    const outcome = await searchNearbyPlaces({
      coordinates: request.coordinates,
      query: analysis.searchQuery,
      radiusMeters: 2500,
      language: analysis.language,
    });
    if (outcome.requestFailed) {
      requestFailed = true;
    } else if (outcome.places.length > 0) {
      sources.push("google_places");
      return { places: outcome.places, sources, requestFailed: false };
    }
  }

  const osmPlaces = await searchOsmNearby({
    coordinates: request.coordinates,
    category: analysis.category as PlaceCategory,
    radiusMeters: 2500,
  });

  if (osmPlaces.length > 0) {
    sources.push("osm");
    return { places: osmPlaces, sources, requestFailed: false };
  }

  return { places: [], sources, requestFailed };
}

async function buildPlacesResponse(
  request: AssistantRequest,
  analysis: IntentAnalysis,
  places: PlaceResult[],
  sources: string[]
): Promise<AssistantResponse> {
  const top = enrichPlacesForClient(places.slice(0, 5), request.coordinates);

  if (env.openaiApiKey.length > 0) {
    const composed = await composeAssistantAnswer({
      question: request.question,
      userProfile: request.userProfile,
      coordinates: request.coordinates,
      places: top,
      cityFacts: [],
      sources,
      ...memoryPayload(request),
    });
    if (composed?.text?.trim()) {
      return {
        answer: composed.text,
        simulated: false,
        location: { ...request.coordinates },
        sources,
        places: top,
      };
    }
  }

  const answer =
    sources.includes("osm") && !sources.includes("google_places")
      ? formatOsmPlacesAnswer(request, top, analysis.language)
      : formatGooglePlacesAnswer(request, top, analysis.language);

  return {
    answer,
    simulated: false,
    location: { ...request.coordinates },
    sources,
    places: top,
  };
}

async function buildWhereAmIResponse(
  request: AssistantRequest,
  lang: "es" | "en"
): Promise<AssistantResponse> {
  const label = await resolvePlaceLabel(request.coordinates, lang);

  if (!label) {
    return {
      answer:
        lang === "en"
          ? "I could not determine your place name from reliable sources right now. Try again in a moment."
          : "No pude determinar el nombre del lugar con fuentes fiables en este momento. Probá de nuevo en unos segundos.",
      simulated: true,
      location: { ...request.coordinates },
      sources: ["nominatim"],
    };
  }

  const answer =
    lang === "en"
      ? `You appear to be near ${label}.`
      : `Parece que estás cerca de ${label}.`;

  return {
    answer,
    simulated: false,
    location: { ...request.coordinates },
    sources: ["nominatim"],
  };
}

function buildSimulatedAnswerText(request: AssistantRequest): string {
  const lang = request.userProfile?.language ?? "es";

  if (apisAreLive()) {
    return buildHelpfulFallback(request, lang);
  }

  if (!request.userProfile) {
    return (
      "Te mostraría opciones cercanas según tu zona. " +
      "Activá las API keys en el servidor para datos reales."
    );
  }

  if (lang === "en") {
    return (
      "I would show nearby options based on your profile. " +
      "Connect Google Places and OpenAI on the server for real data."
    );
  }

  return (
    "Te mostraría opciones cercanas según tu perfil. " +
    "Conectá Google Places y OpenAI en el servidor para datos reales."
  );
}

function buildSimulatedResponse(request: AssistantRequest): AssistantResponse {
  return {
    answer: buildSimulatedAnswerText(request),
    simulated: true,
    location: { ...request.coordinates },
    sources: [],
  };
}

function canUseGooglePlaces(): boolean {
  return env.enableRealProviders && env.googlePlacesApiKey.length > 0;
}

/**
 * Orquestador: con `ENABLE_REAL_PROVIDERS`, OpenAI interpreta intención;
 * Places devuelve datos reales; OpenAI redacta solo con esos datos.
 */
export async function runAssistantPipeline(request: AssistantRequest): Promise<AssistantResponse> {
  if (isWhereAmIQuestion(request.question)) {
    const lang = request.userProfile?.language ?? "es";
    return buildWhereAmIResponse(request, lang);
  }

  if (isMemoryRecallQuestion(request.question)) {
    const lang = request.userProfile?.language ?? "es";
    return buildMemoryRecallResponse(request, lang);
  }

  if (isProfileNameQuestion(request.question)) {
    const lang = request.userProfile?.language ?? "es";
    return {
      answer: buildProfileNameAnswer(request, lang),
      simulated: false,
      location: { ...request.coordinates },
      sources: [],
    };
  }

  if (!env.enableRealProviders) {
    return buildSimulatedResponse(request);
  }

  const analysis: IntentAnalysis =
    env.openaiApiKey.length > 0
      ? (await interpretQuestionIntent({
          question: request.question,
          userProfile: request.userProfile,
          conversationHistory: request.conversationHistory,
        })) ?? keywordFallbackIntent(request)
      : keywordFallbackIntent(request);

  if (analysis.intent === "unknown") {
    const lang = analysis.language;
    if (isGreetingQuestion(request.question)) {
      return {
        answer: buildGreetingAnswer(request, lang),
        simulated: false,
        location: { ...request.coordinates },
        sources: [],
      };
    }
    const composed = await tryComposeGeneralAnswer(request);
    if (composed) {
      return {
        answer: composed,
        simulated: false,
        location: { ...request.coordinates },
        sources: [],
      };
    }
    return {
      answer: buildHelpfulFallback(request, lang),
      simulated: false,
      location: { ...request.coordinates },
      sources: [],
    };
  }

  if (analysis.intent === "where_am_i") {
    return buildWhereAmIResponse(request, analysis.language);
  }

  if (analysis.intent === "city_facts") {
    const facts = await fetchCityFacts({
      coordinates: request.coordinates,
      question: request.question,
      language: analysis.language,
    });

    if (facts.length === 0) {
      return {
        answer: noReliableCityFactsMessage(analysis.language),
        simulated: true,
        location: { ...request.coordinates },
        sources: ["wikidata"],
      };
    }

    const sources = ["wikidata"];

    if (env.openaiApiKey.length > 0) {
      const composed = await composeAssistantAnswer({
        question: request.question,
        userProfile: request.userProfile,
        coordinates: request.coordinates,
        places: [],
        cityFacts: facts,
        sources,
        ...memoryPayload(request),
      });
      if (composed?.text?.trim()) {
        return {
          answer: composed.text,
          simulated: false,
          location: { ...request.coordinates },
          sources,
        };
      }
    }

    return {
      answer: formatCityFactsAnswer(request, facts, analysis.language),
      simulated: false,
      location: { ...request.coordinates },
      sources,
    };
  }

  if (analysis.intent === "general_local") {
    const generalResolved = await resolvePlaces(request, analysis);
    if (generalResolved.places.length > 0) {
      return buildPlacesResponse(
        request,
        analysis,
        generalResolved.places,
        generalResolved.sources
      );
    }
    const composed = await tryComposeGeneralAnswer(request);
    if (composed) {
      return {
        answer: composed,
        simulated: false,
        location: { ...request.coordinates },
        sources: [],
      };
    }
    return {
      answer: buildHelpfulFallback(request, analysis.language),
      simulated: false,
      location: { ...request.coordinates },
      sources: [],
    };
  }

  // places — Google Places y/o OpenStreetMap (sin key de Google, OSM puede responder igual)
  const { places, sources, requestFailed } = await resolvePlaces(request, analysis);

  if (requestFailed && places.length === 0) {
    if (apisAreLive()) {
      return {
        answer: noReliablePlacesNearbyMessage(analysis.language),
        simulated: true,
        location: { ...request.coordinates },
        sources,
      };
    }
    return buildSimulatedResponse(request);
  }

  if (places.length === 0) {
    return {
      answer: noReliablePlacesNearbyMessage(analysis.language),
      simulated: true,
      location: { ...request.coordinates },
      sources,
    };
  }

  return buildPlacesResponse(request, analysis, places, sources);
}
