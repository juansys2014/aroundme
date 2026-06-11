function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parsePort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const DEFAULT_PORT = 3011;
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_TTS_MODEL = "tts-1";
const DEFAULT_OPENAI_TTS_VOICE = "nova";

/**
 * Configuración centralizada (sin efectos secundarios al importar).
 */
const dbHost = (process.env.DB_HOST ?? "").trim();

export const env = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  openaiApiKey: (process.env.OPENAI_API_KEY ?? "").trim(),
  googlePlacesApiKey: (process.env.GOOGLE_PLACES_API_KEY ?? "").trim(),
  openaiModel: (process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
  openaiTtsModel:
    (process.env.OPENAI_TTS_MODEL ?? DEFAULT_OPENAI_TTS_MODEL).trim() || DEFAULT_OPENAI_TTS_MODEL,
  openaiTtsDefaultVoice:
    (process.env.OPENAI_TTS_VOICE ?? DEFAULT_OPENAI_TTS_VOICE).trim().toLowerCase() ||
    DEFAULT_OPENAI_TTS_VOICE,
  /** Si es true, se pueden usar providers reales (OpenAI, Places) según keys. */
  enableRealProviders: parseBool(process.env.ENABLE_REAL_PROVIDERS, false),
  jwtSecret: (process.env.JWT_SECRET ?? "").trim(),
  database: {
    enabled: Boolean(dbHost),
    host: dbHost,
    port: parsePort(process.env.DB_PORT, 3306),
    user: (process.env.DB_USER ?? "").trim(),
    password: process.env.DB_PASSWORD ?? "",
    name: (process.env.DB_NAME ?? "localguide").trim() || "localguide",
  },
} as const;
