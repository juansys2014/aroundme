import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  clearUserData,
  deleteSavedPlace,
  getChatMessages,
  getSavedPlaces,
  replaceChatMessages,
  upsertSavedPlace,
} from "../services/userDataService.js";
import type { ConversationTurn, SavedPlace } from "../types/memory.js";

export const memoryRouter = Router();

function parseMessages(raw: unknown): ConversationTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationTurn[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (o.role !== "user" && o.role !== "assistant") continue;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    const turn: ConversationTurn = { role: o.role, text };
    if (Array.isArray(o.places)) turn.places = o.places as ConversationTurn["places"];
    out.push(turn);
  }
  return out;
}

function parseSavedPlace(raw: unknown): SavedPlace | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;
  const loc =
    typeof o.location === "object" && o.location !== null && !Array.isArray(o.location)
      ? (o.location as Record<string, unknown>)
      : null;
  const lat = loc && typeof loc.lat === "number" ? loc.lat : undefined;
  const lng = loc && typeof loc.lng === "number" ? loc.lng : undefined;
  return {
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
  };
}

memoryRouter.get("/chat", requireAuth, async (req, res) => {
  try {
    const messages = await getChatMessages(req.auth!.userId);
    res.json({ messages });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al cargar el chat";
    res.status(500).json({ error: message });
  }
});

memoryRouter.put("/chat", requireAuth, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const messages = parseMessages(body.messages);
  try {
    await replaceChatMessages(req.auth!.userId, messages);
    res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al guardar el chat";
    res.status(500).json({ error: message });
  }
});

memoryRouter.get("/saved-places", requireAuth, async (req, res) => {
  try {
    const places = await getSavedPlaces(req.auth!.userId);
    res.json({ places });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al cargar lugares";
    res.status(500).json({ error: message });
  }
});

memoryRouter.post("/saved-places", requireAuth, async (req, res) => {
  const place = parseSavedPlace(req.body);
  if (!place) {
    res.status(400).json({ error: "Lugar inválido" });
    return;
  }
  try {
    const saved = await upsertSavedPlace(req.auth!.userId, place);
    res.status(201).json({ place: saved });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al guardar el lugar";
    res.status(500).json({ error: message });
  }
});

memoryRouter.delete("/saved-places/:id", requireAuth, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  try {
    const ok = await deleteSavedPlace(req.auth!.userId, id);
    if (!ok) {
      res.status(404).json({ error: "Lugar no encontrado" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al eliminar";
    res.status(500).json({ error: message });
  }
});

memoryRouter.delete("/all", requireAuth, async (req, res) => {
  try {
    await clearUserData(req.auth!.userId);
    res.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al borrar datos";
    res.status(500).json({ error: message });
  }
});
