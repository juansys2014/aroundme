import { env } from "../config/env.js";

const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const TTS_TIMEOUT_MS = 25_000;
const MAX_INPUT_CHARS = 4096;

export const OPENAI_TTS_VOICES = ["nova", "shimmer", "alloy", "echo", "fable", "onyx"] as const;

export type OpenAiTtsVoice = (typeof OPENAI_TTS_VOICES)[number];

export function isValidOpenAiVoice(voice: string): voice is OpenAiTtsVoice {
  return (OPENAI_TTS_VOICES as readonly string[]).includes(voice);
}

export function resolveOpenAiVoice(voice: string | undefined): OpenAiTtsVoice {
  const v = voice?.trim().toLowerCase() ?? "";
  if (isValidOpenAiVoice(v)) return v;
  const fallback = env.openaiTtsDefaultVoice.toLowerCase();
  if (isValidOpenAiVoice(fallback)) return fallback;
  return "nova";
}

export type SynthesizeSpeechParams = {
  text: string;
  voice?: string;
};

/** Genera audio MP3 vía OpenAI TTS. Sin key o error: `null`. */
export async function synthesizeOpenAiSpeech(params: SynthesizeSpeechParams): Promise<Buffer | null> {
  const apiKey = env.openaiApiKey;
  if (!apiKey || !env.enableRealProviders) return null;

  const input = params.text.trim().slice(0, MAX_INPUT_CHARS);
  if (!input) return null;

  const voice = resolveOpenAiVoice(params.voice);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const res = await fetch(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openaiTtsModel,
        input,
        voice,
        response_format: "mp3",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("OpenAI TTS: HTTP", res.status);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer.byteLength) return null;
    return Buffer.from(arrayBuffer);
  } catch (e) {
    const name = e instanceof Error ? e.name : "error";
    console.error("OpenAI TTS: solicitud fallida", name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
