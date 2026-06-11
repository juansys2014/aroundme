import { Router } from "express";

import { env } from "../config/env.js";
import { verifyOpenAIConnection } from "../providers/openaiProvider.js";

export const providersRouter = Router();

providersRouter.get("/status", async (req, res) => {
  const googleConfigured = env.googlePlacesApiKey.length > 0;
  const openaiConfigured = env.openaiApiKey.length > 0;
  const real = env.enableRealProviders;
  const verify =
    req.query.verify === "1" || req.query.verify === "true" || req.query.test === "1";

  let openaiTest: Awaited<ReturnType<typeof verifyOpenAIConnection>> | undefined;
  if (verify && openaiConfigured) {
    openaiTest = await verifyOpenAIConnection();
  }

  res.json({
    realProvidersEnabled: real,
    openaiConfigured,
    openaiEnabled: real && openaiConfigured,
    openaiModel: openaiConfigured ? env.openaiModel : null,
    openaiTest,
    googlePlacesConfigured: googleConfigured,
    googlePlacesEnabled: real && googleConfigured,
    wikidataAvailable: true,
    wikidataEnabled: real,
    osmAvailable: true,
    osmEnabled: real,
  });
});
