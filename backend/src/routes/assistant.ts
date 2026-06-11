import { Router } from "express";
import { isDatabaseEnabled } from "../db/pool.js";
import { requireAuthIfDb } from "../middleware/auth.js";
import { buildAssistantReply } from "../services/assistantService.js";
import { appendChatTurn, loadAssistantContext } from "../services/userDataService.js";
import type { ConversationTurn, SavedPlace } from "../types/memory.js";
import { ALLOWED_FOOD, ALLOWED_INTERESTS, type UserProfile } from "../types/userProfile.js";
import { sanitizeAnswerForDisplay } from "../utils/sanitizeAnswer.js";

export const assistantRouter = Router();

type AskBody = {
  question?: unknown;
  lat?: unknown;
  lng?: unknown;
  userProfile?: unknown;
  conversationHistory?: unknown;
  savedPlaces?: unknown;
};

const MAX_HISTORY_TURNS = 24;
const MAX_SAVED_PLACES = 40;

function parseConversationHistory(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (o.role !== "user" && o.role !== "assistant") continue;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    const turn: ConversationTurn = { role: o.role, text };
    if (Array.isArray(o.places)) {
      turn.places = o.places
        .filter((p) => typeof p === "object" && p !== null && !Array.isArray(p))
        .map((p) => {
          const pl = p as Record<string, unknown>;
          const name = typeof pl.name === "string" ? pl.name.trim() : "";
          if (!name) return null;
          const loc =
            typeof pl.location === "object" && pl.location !== null && !Array.isArray(pl.location)
              ? (pl.location as Record<string, unknown>)
              : null;
          const lat = loc && typeof loc.lat === "number" ? loc.lat : undefined;
          const lng = loc && typeof loc.lng === "number" ? loc.lng : undefined;
          return {
            id: typeof pl.id === "string" ? pl.id : undefined,
            name,
            address: typeof pl.address === "string" ? pl.address : undefined,
            rating: typeof pl.rating === "number" ? pl.rating : undefined,
            location:
              lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
                ? { lat, lng }
                : undefined,
            mapsUrl: typeof pl.mapsUrl === "string" ? pl.mapsUrl : undefined,
            wazeUrl: typeof pl.wazeUrl === "string" ? pl.wazeUrl : undefined,
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    }
    out.push(turn);
  }
  return out;
}

function parseSavedPlaces(raw: unknown): SavedPlace[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedPlace[] = [];
  for (const item of raw.slice(-MAX_SAVED_PLACES)) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    const loc =
      typeof o.location === "object" && o.location !== null && !Array.isArray(o.location)
        ? (o.location as Record<string, unknown>)
        : null;
    const lat = loc && typeof loc.lat === "number" ? loc.lat : undefined;
    const lng = loc && typeof loc.lng === "number" ? loc.lng : undefined;
    out.push({
      id: typeof o.id === "string" ? o.id : undefined,
      name,
      address: typeof o.address === "string" ? o.address : undefined,
      rating: typeof o.rating === "number" ? o.rating : undefined,
      location:
        lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng }
          : undefined,
      mapsUrl: typeof o.mapsUrl === "string" ? o.mapsUrl : undefined,
      wazeUrl: typeof o.wazeUrl === "string" ? o.wazeUrl : undefined,
      note: typeof o.note === "string" ? o.note : undefined,
      savedAt: typeof o.savedAt === "string" ? o.savedAt : undefined,
    });
  }
  return out;
}

function parseUserProfile(raw: unknown): { ok: true; profile?: UserProfile } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, profile: undefined };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "userProfile debe ser un objeto" };
  }

  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) {
    return { ok: false, error: "userProfile.name es obligatorio y no puede estar vacío" };
  }

  if (o.language !== "es" && o.language !== "en") {
    return { ok: false, error: "userProfile.language debe ser \"es\" o \"en\"" };
  }

  if (!Array.isArray(o.interests)) {
    return { ok: false, error: "userProfile.interests debe ser un array de strings" };
  }
  for (const item of o.interests) {
    if (typeof item !== "string" || !ALLOWED_INTERESTS.has(item)) {
      return { ok: false, error: "userProfile.interests contiene un valor no permitido" };
    }
  }

  if (!Array.isArray(o.foodPreferences)) {
    return { ok: false, error: "userProfile.foodPreferences debe ser un array de strings" };
  }
  for (const item of o.foodPreferences) {
    if (typeof item !== "string" || !ALLOWED_FOOD.has(item)) {
      return { ok: false, error: "userProfile.foodPreferences contiene un valor no permitido" };
    }
  }

  if (o.budget !== "bajo" && o.budget !== "medio" && o.budget !== "alto") {
    return { ok: false, error: "userProfile.budget debe ser \"bajo\", \"medio\" o \"alto\"" };
  }

  const profile: UserProfile = {
    name,
    language: o.language,
    interests: o.interests as string[],
    foodPreferences: o.foodPreferences as string[],
    budget: o.budget,
  };

  return { ok: true, profile };
}

assistantRouter.post("/ask", requireAuthIfDb, async (req, res) => {
  const body = req.body as AskBody;
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const lat = typeof body.lat === "number" ? body.lat : Number(body.lat);
  const lng = typeof body.lng === "number" ? body.lng : Number(body.lng);

  if (!question) {
    res.status(400).json({ error: "question es obligatorio y debe ser texto no vacío" });
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat y lng deben ser números válidos" });
    return;
  }

  let userProfile: UserProfile | undefined;
  let conversationHistory: ConversationTurn[] = [];
  let savedPlaces: SavedPlace[] = [];

  if (isDatabaseEnabled() && req.auth) {
    const ctx = await loadAssistantContext(req.auth.userId);
    userProfile = ctx.profile;
    conversationHistory = ctx.conversationHistory;
    savedPlaces = ctx.savedPlaces;
  } else {
    const parsed = parseUserProfile(body.userProfile);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    userProfile = parsed.profile;
    conversationHistory = parseConversationHistory(body.conversationHistory);
    savedPlaces = parseSavedPlaces(body.savedPlaces);
  }

  const reply = await buildAssistantReply({
    question,
    lat,
    lng,
    userProfile,
    conversationHistory,
    savedPlaces,
  });

  const answer = sanitizeAnswerForDisplay(reply.answer);

  if (isDatabaseEnabled() && req.auth) {
    try {
      await appendChatTurn(req.auth.userId, question, answer, reply.places);
    } catch (e) {
      console.error("No se pudo guardar el turno de chat:", e);
    }
  }

  res.json({
    answer,
    simulated: reply.simulated,
    sources: reply.sources,
    places: reply.places,
  });
});
