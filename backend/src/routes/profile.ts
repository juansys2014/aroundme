import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getUserById, upsertProfile } from "../services/authService.js";
import type { UserProfile } from "../types/userProfile.js";
import { ALLOWED_FOOD, ALLOWED_INTERESTS } from "../types/userProfile.js";

export const profileRouter = Router();

function parseProfileBody(raw: unknown): UserProfile | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;
  if (o.language !== "es" && o.language !== "en") return null;
  if (!Array.isArray(o.interests) || !Array.isArray(o.foodPreferences)) return null;
  if (o.budget !== "bajo" && o.budget !== "medio" && o.budget !== "alto") return null;

  for (const item of o.interests) {
    if (typeof item !== "string" || !ALLOWED_INTERESTS.has(item)) return null;
  }
  for (const item of o.foodPreferences) {
    if (typeof item !== "string" || !ALLOWED_FOOD.has(item)) return null;
  }

  return {
    name,
    language: o.language,
    interests: o.interests as string[],
    foodPreferences: o.foodPreferences as string[],
    budget: o.budget,
  };
}

profileRouter.get("/", requireAuth, async (req, res) => {
  try {
    const data = await getUserById(req.auth!.userId);
    res.json({ profile: data.profile });
  } catch {
    res.status(404).json({ error: "Perfil no encontrado" });
  }
});

profileRouter.put("/", requireAuth, async (req, res) => {
  const profile = parseProfileBody(req.body);
  if (!profile) {
    res.status(400).json({ error: "Perfil inválido" });
    return;
  }
  try {
    const saved = await upsertProfile(req.auth!.userId, profile);
    res.json({ profile: saved });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo guardar el perfil";
    res.status(400).json({ error: message });
  }
});
