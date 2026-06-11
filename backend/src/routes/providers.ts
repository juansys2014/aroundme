import { Router } from "express";

import { env } from "../config/env.js";

export const providersRouter = Router();

providersRouter.get("/status", (_req, res) => {
  const googleConfigured = env.googlePlacesApiKey.length > 0;
  const openaiConfigured = env.openaiApiKey.length > 0;
  const real = env.enableRealProviders;
  res.json({
    realProvidersEnabled: real,
    openaiConfigured,
    openaiEnabled: real && openaiConfigured,
    openaiModel: openaiConfigured ? env.openaiModel : null,
    googlePlacesConfigured: googleConfigured,
    googlePlacesEnabled: real && googleConfigured,
    wikidataAvailable: true,
    wikidataEnabled: real,
    osmAvailable: true,
    osmEnabled: real,
  });
});
