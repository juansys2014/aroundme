import { Router } from "express";

import { env } from "../config/env.js";
import { requireAuthIfDb } from "../middleware/auth.js";
import {
  isValidOpenAiVoice,
  OPENAI_TTS_VOICES,
  resolveOpenAiVoice,
  synthesizeOpenAiSpeech,
} from "../providers/openaiTtsProvider.js";

export const ttsRouter = Router();

const MAX_TEXT_LEN = 4096;

ttsRouter.get("/voices", (_req, res) => {
  const available = env.enableRealProviders && env.openaiApiKey.length > 0;
  res.json({
    available,
    model: available ? env.openaiTtsModel : null,
    defaultVoice: env.openaiTtsDefaultVoice,
    voices: OPENAI_TTS_VOICES.map((id) => ({ id, label: id })),
  });
});

ttsRouter.post("/speak", requireAuthIfDb, async (req, res) => {
  const body = req.body as { text?: unknown; voice?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    res.status(400).json({ error: "text es obligatorio" });
    return;
  }
  if (text.length > MAX_TEXT_LEN) {
    res.status(400).json({ error: `text no puede superar ${MAX_TEXT_LEN} caracteres` });
    return;
  }

  if (!env.enableRealProviders || !env.openaiApiKey) {
    res.status(503).json({ error: "OpenAI TTS no está disponible en el servidor" });
    return;
  }

  const voiceRaw = typeof body.voice === "string" ? body.voice.trim() : "";
  const voice = voiceRaw && isValidOpenAiVoice(voiceRaw) ? voiceRaw : resolveOpenAiVoice(undefined);

  const audio = await synthesizeOpenAiSpeech({ text, voice });
  if (!audio) {
    res.status(502).json({ error: "No se pudo generar el audio" });
    return;
  }

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", "no-store");
  res.send(audio);
});
