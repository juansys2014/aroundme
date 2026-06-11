const STORAGE_KEY = "LOCALGUIDE_USER_PROFILE";
const CHAT_HISTORY_KEY = "LOCALGUIDE_CHAT_HISTORY";
const SAVED_PLACES_KEY = "LOCALGUIDE_SAVED_PLACES";
const AUTH_TOKEN_KEY = "LOCALGUIDE_AUTH_TOKEN";
const VOICE_REPLY_KEY = "LOCALGUIDE_VOICE_REPLY";
const VOICE_DIALOG_KEY = "LOCALGUIDE_VOICE_DIALOG";
const VOICE_URI_KEY = "LOCALGUIDE_VOICE_URI";
const SPEECH_LOCALE_KEY = "LOCALGUIDE_SPEECH_LOCALE";
const TTS_ENGINE_KEY = "LOCALGUIDE_TTS_ENGINE";
const OPENAI_VOICE_KEY = "LOCALGUIDE_OPENAI_VOICE";

const OPENAI_TTS_VOICES = [
  { id: "nova", label: "Nova — cálida (recomendada, tipo ChatGPT)" },
  { id: "shimmer", label: "Shimmer — suave" },
  { id: "alloy", label: "Alloy — neutra" },
  { id: "echo", label: "Echo — masculina" },
  { id: "fable", label: "Fable — narrativa" },
  { id: "onyx", label: "Onyx — grave" },
];

const SPEECH_LOCALE_OPTIONS = [
  { id: "es-AR", label: "Español (Argentina)" },
  { id: "es-ES", label: "Español (España)" },
  { id: "es-MX", label: "Español (México)" },
  { id: "en-US", label: "English (Estados Unidos)" },
  { id: "en-GB", label: "English (Reino Unido)" },
];

const SpeechRecognitionCtor =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

let activeRecognition = null;
let locationWatchId = null;
let voiceFlowToken = 0;
let voiceResumeTimer = null;
let chatMicRestartFn = null;
/** En modo diálogo: mantener el micrófono activo entre turnos hasta que el usuario toque Parar. */
let dialogMicWanted = false;
let lastGeocodeAt = 0;
let lastLocationRenderAt = 0;
let activeTtsAudio = null;
let activeTtsObjectUrl = null;
const MIC_FLUSH_MS = 1400;
const MIC_RESTART_AFTER_SPEECH_MS = 1500;

function isMobileDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
}

function isSecureForGeolocation() {
  if (typeof window === "undefined") return false;
  return window.isSecureContext === true;
}

function getLocationHelpMessage(errCode) {
  if (!isSecureForGeolocation()) {
    return {
      text: "Para usar el GPS hace falta HTTPS (sitio seguro). Abrí AroundMe con https:// en lugar de http://.",
      secure: true,
    };
  }
  if (errCode === 1) {
    return {
      text: "Permiso de ubicación denegado. Tocá «Activar ubicación» o permitilo en ajustes del navegador y del teléfono.",
      secure: false,
    };
  }
  return {
    text: "No se pudo obtener la ubicación. Revisá que el GPS esté encendido e intentá de nuevo.",
    secure: false,
  };
}

function buildLocationBanner(onRetry) {
  const help = getLocationHelpMessage(
    state.locationError?.includes("denegado") ? 1 : undefined
  );
  const msg = state.locationError || help.text;
  const banner = el(
    "div",
    "location-banner" + (help.secure || msg.includes("HTTPS") ? " hint-secure" : "")
  );
  banner.appendChild(el("strong", null, "Ubicación necesaria"));
  banner.appendChild(document.createTextNode(msg));
  if (onRetry && isSecureForGeolocation()) {
    const btn = el("button", "btn", "Activar ubicación");
    btn.type = "button";
    btn.onclick = () => onRetry();
    banner.appendChild(btn);
  }
  return banner;
}

function requestLocationOnce(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError(new Error("unsupported"));
    return;
  }
  if (!isSecureForGeolocation()) {
    onError(new Error("insecure"));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess(pos),
    (err) => onError(err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 }
  );
}

function retryLocationPermission() {
  state.locationLoading = true;
  state.locationError = null;
  render();
  requestLocationOnce(
    (pos) => {
      applyPosition(pos);
      if (locationWatchId == null) startLocationWatch();
    },
    (err) => {
      state.locationLoading = false;
      const help = getLocationHelpMessage(err?.code);
      state.locationError = help.text;
      render();
    }
  );
}

const INTERESTS = [
  "comida",
  "historia",
  "naturaleza",
  "compras",
  "vida nocturna",
  "museos",
  "lugares tranquilos",
  "lugares familiares",
  "lugares económicos",
];

const FOODS = [
  "italiana",
  "argentina",
  "mexicana",
  "japonesa",
  "vegetariana",
  "carne",
  "pescado",
  "café",
];

const BUDGETS = ["bajo", "medio", "alto"];

const app = document.getElementById("app");
let state = {
  screen: "loading",
  authRequired: false,
  authUser: null,
  profile: null,
  savedPlaces: [],
  location: null,
  locationLoading: false,
  locationError: null,
  messages: [],
  sending: false,
  listening: false,
  speaking: false,
  voiceReplyEnabled: true,
  voiceDialogMode: false,
  selectedVoiceUri: "",
  speechVoices: [],
  openaiTtsEnabled: false,
  ttsEngine: "openai",
  openaiVoice: "nova",
  suggestedPlaces: [],
  selectedPlace: null,
};

function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: authHeaders({
      "Content-Type": "application/json",
      ...(options.headers || {}),
    }),
  });
  if (res.status === 401 && state.authRequired) {
    clearAuthSession();
    state.screen = "login";
    render();
    throw new Error("Sesión expirada. Volvé a iniciar sesión.");
  }
  return res;
}

let chatSyncTimer = null;

function getProfile() {
  if (state.authRequired && state.profile) return state.profile;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveProfile(profile) {
  state.profile = profile;
  if (state.authRequired) {
    const res = await apiFetch("/api/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "No se pudo guardar el perfil");
    }
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function clearAuthSession() {
  setAuthToken("");
  state.authUser = null;
  state.profile = null;
  state.savedPlaces = [];
  state.messages = [];
}

function clearProfile() {
  clearAuthSession();
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(CHAT_HISTORY_KEY);
  localStorage.removeItem(SAVED_PLACES_KEY);
}

async function clearProfileRemote() {
  if (state.authRequired && getAuthToken()) {
    await apiFetch("/api/memory/all", { method: "DELETE" }).catch(() => {});
  }
  clearProfile();
}

function slimPlaceForMemory(place) {
  if (!place) return null;
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    rating: place.rating,
    location: place.location,
    mapsUrl: place.mapsUrl,
    wazeUrl: place.wazeUrl,
  };
}

function serializeChatMessage(msg) {
  return {
    role: msg.role,
    text: msg.text,
    places: msg.places?.map(slimPlaceForMemory).filter(Boolean),
  };
}

function loadChatHistory() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistChatHistory() {
  const slim = state.messages.slice(-40).map(serializeChatMessage);
  if (!state.authRequired) {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(slim));
    } catch {
      // ignore quota errors
    }
    return;
  }
  if (!getAuthToken()) return;
  clearTimeout(chatSyncTimer);
  chatSyncTimer = setTimeout(() => {
    void apiFetch("/api/memory/chat", {
      method: "PUT",
      body: JSON.stringify({ messages: slim }),
    }).catch(() => {});
  }, 400);
}

function getSavedPlaces() {
  if (state.authRequired) return state.savedPlaces;
  try {
    const raw = localStorage.getItem(SAVED_PLACES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePlaceToMemory(place, note) {
  const enriched = { ...place };
  if (enriched.location && state.location) {
    const q = "";
    enriched.mapsUrl = getNavigationUrl(enriched, q);
    enriched.wazeUrl =
      enriched.wazeUrl ||
      `https://waze.com/ul?ll=${enriched.location.lat},${enriched.location.lng}&navigate=yes`;
  }
  const entry = {
    ...slimPlaceForMemory(enriched),
    note: note || "",
    savedAt: new Date().toISOString(),
  };
  if (state.authRequired) {
    void apiFetch("/api/memory/saved-places", {
      method: "POST",
      body: JSON.stringify(entry),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (data.place) {
          const list = getSavedPlaces().filter(
            (p) => p.name !== data.place.name && (p.id ?? "") !== (data.place.id ?? "")
          );
          list.push(data.place);
          state.savedPlaces = list.slice(-50);
        }
      })
      .catch(() => {});
    const list = getSavedPlaces().filter(
      (p) => p.name !== entry.name && (p.id ?? "") !== (entry.id ?? "")
    );
    list.push(entry);
    state.savedPlaces = list.slice(-50);
    return entry;
  }
  const list = getSavedPlaces().filter(
    (p) => p.name !== entry.name && (p.id ?? "") !== (entry.id ?? "")
  );
  list.push(entry);
  localStorage.setItem(SAVED_PLACES_KEY, JSON.stringify(list.slice(-50)));
  return entry;
}

function buildConversationHistoryForApi() {
  const all = state.messages.slice(-24).map(serializeChatMessage);
  const last = all[all.length - 1];
  if (last?.role === "user") return all.slice(0, -1);
  return all;
}

function isSaveMemoryCommand(n) {
  return /apunta|anota|guarda|guardá|recorda|recordá|fijate este|quiero volver|guardar este|este lugar me interesa|me interesa.*volver/.test(
    n
  );
}

function isRecallMemoryCommand(n) {
  return /te acord|te acuerd|recordas|recuerdas|donde quedaba|donde era|donde quedo|que me recomend|me recomendaste|cual era|ubicacion de|direccion de|lo que guard|lugares guard/.test(
    n
  );
}

function findPlaceInLocalMemory(question) {
  const n = normalizeForMatch(question);
  const candidates = [...getSavedPlaces()];
  for (const msg of state.messages) {
    if (msg.role === "assistant" && msg.places?.length) {
      for (const p of msg.places) candidates.push(p);
    }
  }
  const seen = new Set();
  const unique = [];
  for (const p of candidates) {
    const key = `${p.id ?? ""}|${normalizeForMatch(p.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  for (const p of unique) {
    const name = normalizeForMatch(p.name);
    if (name.length > 2 && n.includes(name)) return p;
  }
  let best = null;
  let bestScore = 0;
  for (const p of unique) {
    const words = normalizeForMatch(p.name)
      .split(/\s+/)
      .filter((w) => w.length > 3);
    let score = 0;
    for (const w of words) {
      if (n.includes(w)) score += w.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 5 ? best : null;
}

function tryHandleSaveMemoryCommand(question) {
  const n = normalizeForMatch(question);
  if (!isSaveMemoryCommand(n)) return null;
  const lang = getProfile()?.language === "en" ? "en" : "es";
  const places = getSuggestedPlaces();
  let place = resolvePlaceFromQuestion(question, places) || state.selectedPlace;
  if (!place && places.length === 1) place = places[0];
  if (!place) {
    return {
      handled: true,
      text:
        lang === "en"
          ? "Which place should I save? Tap a card or say which one (e.g. the first)."
          : "¿Qué lugar apunto? Tocá una tarjeta o decí cuál (ej. el primero).",
    };
  }
  const saved = savePlaceToMemory(place, question);
  state.selectedPlace = place;
  return {
    handled: true,
    text:
      lang === "en"
        ? `Saved: ${saved.name}${saved.address ? ` — ${saved.address}` : ""}. Ask me later when you want to go back.`
        : `Apuntado: ${saved.name}${saved.address ? ` — ${saved.address}` : ""}. Cuando quieras volver, preguntame por este lugar.`,
  };
}

function tryHandleRecallMemoryCommand(question) {
  const n = normalizeForMatch(question);
  if (!isRecallMemoryCommand(n)) return null;
  const lang = getProfile()?.language === "en" ? "en" : "es";
  const found = findPlaceInLocalMemory(question);
  if (!found) return null;
  state.selectedPlace = found;
  const parts =
    lang === "en"
      ? [`Yes — ${found.name}`]
      : [`Sí — ${found.name}`];
  if (found.address) {
    parts.push(lang === "en" ? `it's at ${found.address}` : `queda en ${found.address}`);
  }
  parts.push(
    lang === "en"
      ? 'say «open the map» for directions'
      : "decí «abrí el mapa» si querés ir"
  );
  return {
    handled: true,
    text: `${parts.join(". ")}.`,
    places: [found],
  };
}

function hasProfile() {
  const p = getProfile();
  return Boolean(p?.name?.trim());
}

async function fetchServerStatus() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return { authRequired: false };
    return await res.json();
  } catch {
    return { authRequired: false };
  }
}

async function fetchProvidersStatus() {
  try {
    const res = await fetch("/api/providers/status");
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

function getTtsEngine() {
  try {
    const v = localStorage.getItem(TTS_ENGINE_KEY);
    if (v === "browser" || v === "openai") return v;
  } catch {
    // ignore
  }
  return state.openaiTtsEnabled ? "openai" : "browser";
}

function setTtsEngine(engine) {
  localStorage.setItem(TTS_ENGINE_KEY, engine);
  state.ttsEngine = engine;
}

function getOpenAiVoice() {
  try {
    const v = localStorage.getItem(OPENAI_VOICE_KEY);
    if (v && OPENAI_TTS_VOICES.some((x) => x.id === v)) return v;
  } catch {
    // ignore
  }
  return state.openaiVoice || "nova";
}

function setOpenAiVoice(voice) {
  localStorage.setItem(OPENAI_VOICE_KEY, voice);
  state.openaiVoice = voice;
}

function shouldUseOpenAiTts() {
  return state.openaiTtsEnabled && getTtsEngine() === "openai";
}

async function loadSessionFromServer() {
  const meRes = await apiFetch("/api/auth/me");
  if (!meRes.ok) throw new Error("Sesión inválida");
  const me = await meRes.json();
  state.authUser = { email: me.email };
  state.profile = me.profile?.name?.trim() ? me.profile : null;
  if (state.profile) saveProfileLocalCache(state.profile);

  const [chatRes, placesRes] = await Promise.all([
    apiFetch("/api/memory/chat"),
    apiFetch("/api/memory/saved-places"),
  ]);
  if (chatRes.ok) {
    const chat = await chatRes.json();
    state.messages = Array.isArray(chat.messages) ? chat.messages : [];
  }
  if (placesRes.ok) {
    const data = await placesRes.json();
    state.savedPlaces = Array.isArray(data.places) ? data.places : [];
  }
}

function saveProfileLocalCache(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

function getVoiceReplyEnabled() {
  try {
    return localStorage.getItem(VOICE_REPLY_KEY) !== "false";
  } catch {
    return true;
  }
}

function setVoiceReplyEnabled(enabled) {
  localStorage.setItem(VOICE_REPLY_KEY, enabled ? "true" : "false");
  state.voiceReplyEnabled = enabled;
}

function getVoiceDialogMode() {
  try {
    return localStorage.getItem(VOICE_DIALOG_KEY) === "true";
  } catch {
    return false;
  }
}

function setVoiceDialogMode(enabled) {
  localStorage.setItem(VOICE_DIALOG_KEY, enabled ? "true" : "false");
  state.voiceDialogMode = enabled;
  if (enabled) {
    state.voiceReplyEnabled = true;
    dialogMicWanted = true;
  } else {
    dialogMicWanted = false;
    stopAssistantOutput();
  }
}

function getSpeechLocale() {
  try {
    const stored = localStorage.getItem(SPEECH_LOCALE_KEY);
    if (stored) return stored;
  } catch {
    // ignore
  }
  const p = getProfile();
  return p?.language === "en" ? "en-US" : "es-AR";
}

function setSpeechLocale(locale) {
  localStorage.setItem(SPEECH_LOCALE_KEY, locale);
  state.speechLocale = locale;
  localStorage.removeItem(VOICE_URI_KEY);
  state.selectedVoiceUri = "";
  state.speechVoices = getBrowserVoices();
}

function getSpeechLang() {
  return getSpeechLocale();
}

function getSpeechLangPrefix() {
  return getSpeechLocale().split("-")[0];
}

function looksLikeCoords(text) {
  return /^-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}$/.test(String(text).trim());
}

function getStoredVoiceUri() {
  try {
    return localStorage.getItem(VOICE_URI_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredVoiceUri(uri) {
  localStorage.setItem(VOICE_URI_KEY, uri);
  state.selectedVoiceUri = uri;
}

function scoreVoiceForLocale(voice, locale) {
  const lang = voice.lang.toLowerCase().replace("_", "-");
  const name = voice.name.toLowerCase();
  const loc = locale.toLowerCase();
  let score = 0;
  if (lang === loc) score += 20;
  if (lang.startsWith(loc.split("-")[0])) score += 2;
  if (loc === "es-ar" && (lang === "es-419" || name.includes("argentin") || name.includes("latinoam"))) {
    score += 15;
  }
  if (loc === "es-es" && (lang === "es-es" || name.includes("spain") || name.includes("españa"))) {
    score += 10;
  }
  if (loc === "es-mx" && (lang === "es-mx" || name.includes("mexic"))) score += 10;
  if (loc === "en-us" && (lang === "en-us" || name.includes("united states"))) score += 10;
  if (loc === "en-gb" && (lang === "en-gb" || name.includes("united kingdom") || name.includes("british"))) {
    score += 10;
  }
  if (/google|natural|premium|enhanced|neural|wavenet|online|samantha|paulina|helena|luciana|diego|monica/.test(name)) {
    score += 12;
  }
  if (/compact|espeak|robotic|synthetic|microsoft david|microsoft helena|android default/.test(name)) {
    score -= 10;
  }
  return score;
}

function getBrowserVoices() {
  if (!window.speechSynthesis) return [];
  const locale = getSpeechLocale();
  const all = speechSynthesis.getVoices();
  const ranked = all
    .map((v) => ({ v, score: scoreVoiceForLocale(v, locale) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.v.name.localeCompare(b.v.name));

  if (ranked.length > 0) return ranked.map((x) => x.v);

  const prefix = getSpeechLangPrefix();
  return all
    .filter((v) => v.lang.toLowerCase().replace("_", "-").startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pickVoice() {
  const voices = getBrowserVoices();
  if (!voices.length) return null;
  const saved = getStoredVoiceUri();
  if (saved) {
    const match = voices.find((v) => v.voiceURI === saved);
    if (match) return match;
  }
  return voices[0];
}

function initSpeechVoices() {
  if (!window.speechSynthesis) return;
  const load = () => {
    state.speechVoices = getBrowserVoices();
    if (state.screen === "chat" || state.screen === "settings") render();
  };
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

function openSettings() {
  state.settingsDraft = {
    ...(getProfile() ?? {
      name: "",
      language: "es",
      interests: [],
      foodPreferences: [],
      budget: "medio",
    }),
    speechLocale: getSpeechLocale(),
  };
  state.screen = "settings";
  state.speechVoices = getBrowserVoices();
  render();
}

function stopListening() {
  if (activeRecognition) {
    try {
      activeRecognition.abort();
    } catch {
      try {
        activeRecognition.stop();
      } catch {
        // ignore
      }
    }
    activeRecognition = null;
  }
  state.listening = false;
}

function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  if (activeTtsAudio) {
    try {
      activeTtsAudio.pause();
      activeTtsAudio.src = "";
    } catch {
      // ignore
    }
    activeTtsAudio = null;
  }
  if (activeTtsObjectUrl) {
    URL.revokeObjectURL(activeTtsObjectUrl);
    activeTtsObjectUrl = null;
  }
  state.speaking = false;
}

function clearVoiceResumeTimer() {
  if (voiceResumeTimer != null) {
    clearTimeout(voiceResumeTimer);
    voiceResumeTimer = null;
  }
}

function isAssistantVoiceBusy() {
  const ttsPlaying = activeTtsAudio && !activeTtsAudio.paused && !activeTtsAudio.ended;
  return (
    state.speaking ||
    state.listening ||
    voiceResumeTimer != null ||
    ttsPlaying ||
    (typeof window !== "undefined" &&
      window.speechSynthesis &&
      window.speechSynthesis.speaking)
  );
}

function scheduleMicRestart(delayMs = 400) {
  if (!state.voiceDialogMode || !dialogMicWanted) return;
  clearVoiceResumeTimer();
  const token = voiceFlowToken;
  voiceResumeTimer = setTimeout(() => {
    voiceResumeTimer = null;
    if (token !== voiceFlowToken) return;
    if (!dialogMicWanted || !state.voiceDialogMode) return;
    if (state.screen !== "chat" || state.speaking || state.sending) return;
    if (typeof chatMicRestartFn === "function") chatMicRestartFn();
  }, delayMs);
}

/** Corta lectura en voz alta, micrófono y re-escucha automática del modo diálogo. */
function stopAssistantOutput(options = {}) {
  const endDialogMic = options.endDialogMic !== false;
  voiceFlowToken += 1;
  clearVoiceResumeTimer();
  stopSpeaking();
  stopListening();
  if (endDialogMic) dialogMicWanted = false;
}

function acknowledgeStop() {
  const lang = getProfile()?.language === "en" ? "en" : "es";
  state.messages.push({
    role: "assistant",
    text: lang === "en" ? "Stopped." : "Listo, paré.",
  });
}

function handleUserStop(userText) {
  const wasActive = isAssistantVoiceBusy() || dialogMicWanted;
  stopAssistantOutput();
  if (userText) state.messages.push({ role: "user", text: userText });
  if (wasActive) acknowledgeStop();
  render();
}

function isStopVoiceCommand(text) {
  const n = normalizeForMatch(String(text).trim());
  if (!n) return false;
  const exact = new Set([
    "parar",
    "para",
    "pare",
    "detente",
    "silencio",
    "basta",
    "callate",
    "deja de hablar",
    "no sigas",
    "stop",
    "quiet",
    "shut up",
    "please stop",
  ]);
  if (exact.has(n)) return true;
  return /^(parar|stop|detente|silencio|basta)\b/.test(n) && n.length <= 40;
}

function stopLocationWatch() {
  if (locationWatchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
}

async function reverseGeocodeLabel(lat, lng) {
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { "Accept-Language": "es" } }
    );
    if (geoRes.ok) {
      const geo = await geoRes.json();
      const a = geo.address;
      const parts = [a?.city, a?.state, a?.country].filter(Boolean);
      if (parts.length) return parts.join(", ");
    }
  } catch {
    // sin etiqueta legible
  }
  return null;
}

function applyPosition(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const hadLocation = Boolean(state.location);
  const prevLabel = state.location?.label;
  const safeLabel =
    prevLabel && !looksLikeCoords(prevLabel) ? prevLabel : "Zona detectada";

  state.location = {
    lat,
    lng,
    label: safeLabel,
  };
  state.locationLoading = false;
  state.locationError = null;

  const now = Date.now();
  const shouldRender =
    state.screen === "chat" &&
    (now - lastLocationRenderAt > 8000 || !hadLocation);

  if (shouldRender) {
    lastLocationRenderAt = now;
    render();
  }

  if (!hadLocation || now - lastGeocodeAt > 45000) {
    lastGeocodeAt = now;
    void reverseGeocodeLabel(lat, lng).then((label) => {
      if (state.location && label) {
        state.location.label = label;
        if (state.screen === "chat") render();
      }
    });
  }
}

function startLocationWatch() {
  if (!navigator.geolocation) {
    state.locationError = "Tu navegador no soporta geolocalización.";
    state.locationLoading = false;
    render();
    return;
  }

  if (!isSecureForGeolocation()) {
    state.locationLoading = false;
    state.locationError = getLocationHelpMessage().text;
    render();
    return;
  }

  if (locationWatchId != null) return;

  state.locationLoading = true;
  state.locationError = null;
  render();

  locationWatchId = navigator.geolocation.watchPosition(
    (pos) => applyPosition(pos),
    (err) => {
      state.locationLoading = false;
      state.locationError = getLocationHelpMessage(err.code).text;
      render();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 }
  );
}

function openChatScreen(options = {}) {
  const fresh = options.fresh === true;
  state.screen = "chat";
  if (fresh) {
    state.messages = [];
    state.suggestedPlaces = [];
    state.selectedPlace = null;
  } else if (!state.messages?.length) {
    state.messages = loadChatHistory();
  }
  startLocationWatch();
  render();
  if (state.voiceDialogMode && dialogMicWanted) {
    scheduleMicRestart(800);
  }
}

async function speakText(text, onEnd) {
  if (!text?.trim()) {
    if (onEnd) onEnd();
    return;
  }
  stopListening();
  stopSpeaking();
  const token = voiceFlowToken;
  state.speaking = true;
  if (state.screen === "chat") render();

  const finish = () => {
    if (token !== voiceFlowToken) return;
    state.speaking = false;
    if (state.screen === "chat" || state.screen === "settings") render();
    if (onEnd) onEnd();
  };

  if (shouldUseOpenAiTts()) {
    try {
      const res = await apiFetch("/api/tts/speak", {
        method: "POST",
        body: JSON.stringify({ text: text.trim(), voice: getOpenAiVoice() }),
      });
      if (!res.ok) throw new Error("OpenAI TTS failed");
      const blob = await res.blob();
      if (token !== voiceFlowToken) {
        finish();
        return;
      }
      const url = URL.createObjectURL(blob);
      activeTtsObjectUrl = url;
      const audio = new Audio(url);
      activeTtsAudio = audio;
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
      return;
    } catch {
      // fallback al navegador
    }
  }

  if (!window.speechSynthesis) {
    finish();
    return;
  }

  const utter = new SpeechSynthesisUtterance(text.trim());
  utter.lang = getSpeechLang();
  utter.rate = 0.86;
  utter.pitch = 0.98;
  utter.volume = 1;
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.onstart = () => {
    if (token !== voiceFlowToken) return;
    state.speaking = true;
    if (state.screen === "chat") render();
  };
  utter.onend = finish;
  utter.onerror = finish;
  window.speechSynthesis.speak(utter);
}

function normalizeForMatch(s) {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function getLastUserMessageIndex() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === "user") return i;
  }
  return -1;
}

/** Lugares solo del último turno (después del último mensaje del usuario). */
function getSuggestedPlaces() {
  const lastUserIdx = getLastUserMessageIndex();
  for (let i = state.messages.length - 1; i > lastUserIdx; i--) {
    const m = state.messages[i];
    if (m.role === "assistant" && m.places?.length) return m.places;
  }
  return [];
}

function getSelectedPlaceForContext() {
  const places = getSuggestedPlaces();
  if (!places.length || !state.selectedPlace) return null;
  const sel = state.selectedPlace;
  const stillValid = places.some(
    (p) => p.name === sel.name && (p.id === sel.id || (!p.id && !sel.id))
  );
  return stillValid ? state.selectedPlace : null;
}

function clearPlaceSelectionContext() {
  state.selectedPlace = null;
  state.suggestedPlaces = [];
}

function isNavigationCommand(n) {
  return /mapa|maps|waze|llev|llegar|naveg|dirigir|como llego|abrir|abre|abrí|abi|ir con|llevarme|guiar|ruta|google/.test(
    n
  );
}

function wantsWaze(n) {
  return /waze/.test(n);
}

function ordinalsMatch(n) {
  return /primer|segund|tercer|cuart|quint|\b[1-5]\b|opcion|numero/.test(n);
}

function isSelectionPhrase(n) {
  return (
    /^(elige|elegi|selecciona|seleccionar|quiero|voy con|me quedo con)\b/.test(n) ||
    ordinalsMatch(n) ||
    /me interesa|me gusta|esa opcion|esta opcion|este lugar|el elegido|vamos (con|a)|quiero (ir|esa|ese|a)/.test(
      n
    ) ||
    /\besa\b|\bese\b|\besta\b|\beste\b/.test(n)
  );
}

function placeInCurrentList(place, places) {
  if (!place) return false;
  return places.some(
    (p) => p.name === place.name && (p.id === place.id || (!p.id && !place.id))
  );
}

function resolvePlaceFromQuestion(question, places) {
  const n = normalizeForMatch(question);

  const ordinals = [
    { re: /primer|1\b|uno\b|opcion 1|numero 1/, idx: 0 },
    { re: /segund|2\b|dos\b|opcion 2|numero 2/, idx: 1 },
    { re: /tercer|3\b|tres\b|opcion 3|numero 3/, idx: 2 },
    { re: /cuart|4\b|cuatro\b|opcion 4|numero 4/, idx: 3 },
    { re: /quint|5\b|cinco\b|opcion 5|numero 5/, idx: 4 },
  ];
  for (const o of ordinals) {
    if (o.re.test(n) && places[o.idx]) return places[o.idx];
  }

  for (const p of places) {
    const name = normalizeForMatch(p.name);
    if (name.length > 2 && n.includes(name)) return p;
  }

  const refersToPicked =
    /\besa\b|\bese\b|\besta\b|\beste\b|seleccionad|elegid|la que elegi/.test(n);
  if (refersToPicked && state.selectedPlace && placeInCurrentList(state.selectedPlace, places)) {
    return state.selectedPlace;
  }

  if (places.length === 1 && (isNavigationCommand(n) || isSelectionPhrase(n) || refersToPicked)) {
    return places[0];
  }

  if (state.selectedPlace && placeInCurrentList(state.selectedPlace, places) && isNavigationCommand(n)) {
    return state.selectedPlace;
  }

  return null;
}

function getNavigationUrl(place, question) {
  const loc = place?.location;
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) {
    return wantsWaze(normalizeForMatch(question)) ? place?.wazeUrl : place?.mapsUrl;
  }

  if (wantsWaze(normalizeForMatch(question))) {
    return (
      place.wazeUrl ||
      `https://waze.com/ul?ll=${loc.lat},${loc.lng}&navigate=yes`
    );
  }

  const origin = state.location;
  if (origin?.lat != null && origin?.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${loc.lat},${loc.lng}&travelmode=walking`;
  }

  return (
    place.mapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${loc.lat},${loc.lng}`)}`
  );
}

function openNavigationForPlace(place, question, lang) {
  const url = getNavigationUrl(place, question);
  if (!url) {
    return {
      handled: true,
      text:
        lang === "en"
          ? `${place.name} has no navigation link available.`
          : `${place.name} no tiene enlace de navegación disponible.`,
    };
  }

  window.open(url, "_blank", "noopener,noreferrer");
  state.selectedPlace = place;
  const appName = wantsWaze(normalizeForMatch(question)) ? "Waze" : "Google Maps";
  const address = place.address ? ` ${place.address}` : "";
  return {
    handled: true,
    text:
      lang === "en"
        ? `Opening ${appName} to ${place.name} with directions from your location.${address}`
        : `Abriendo ${appName} hacia ${place.name} con ruta desde donde estás.${address}`,
  };
}

function tryHandleInteractiveCommand(question) {
  const places = getSuggestedPlaces();
  const n = normalizeForMatch(question);
  const lang = getProfile()?.language === "en" ? "en" : "es";

  if (!places.length) return null;

  const nav = isNavigationCommand(n);
  const select = isSelectionPhrase(n);
  if (!nav && !select) return null;

  const place = resolvePlaceFromQuestion(question, places);

  if (nav) {
    if (!place) {
      return {
        handled: true,
        text:
          lang === "en"
            ? "Which one? Say «the first one», tap a card, or «that one interests me, open the map»."
            : "¿Cuál querés? Decí «el primero», tocá una tarjeta, o «esa me interesa, abrí el mapa».",
      };
    }
    return openNavigationForPlace(place, question, lang);
  }

  if (place) {
    state.selectedPlace = place;
    return {
      handled: true,
      text:
        lang === "en"
          ? `Got it: ${place.name}. Say «open Google Maps» or «open Waze».`
          : `Perfecto: ${place.name}. Decí «abrí el mapa» o «ir con Waze».`,
    };
  }

  return {
    handled: true,
    text:
      lang === "en"
        ? "Which option interests you? Say the number or tap a card."
        : "¿Cuál te interesa? Decí el número o tocá una tarjeta.",
  };
}

function stripCoordsFromText(text) {
  return String(text)
    .replace(/\(-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\)/g, "")
    .replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, "")
    .replace(/coordenadas?\s+recibidas?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function respondAssistant(text, options = {}) {
  state.messages.push({
    role: "assistant",
    text: stripCoordsFromText(text),
    simulated: options.simulated,
    sources: options.sources,
    places: options.places,
  });
  if (options.places?.length) {
    state.suggestedPlaces = options.places;
  } else {
    state.suggestedPlaces = [];
    state.selectedPlace = null;
  }
  persistChatHistory();
}

function isLikelyAssistantEcho(text) {
  const n = normalizeForMatch(String(text).trim());
  if (!n || n.length > 120) return false;
  const echoHints = [
    "en que puedo ayudarte",
    "puedo ayudarte",
    "que te interesa",
    "decime si buscas",
    "soy tu guia local",
    "puntos de interes",
    "lugares cerca",
    "how can i help",
    "local guide",
  ];
  return echoHints.some((h) => n.includes(h));
}

function afterAssistantSpeech(text, listenCallback) {
  if (!state.voiceReplyEnabled && !state.voiceDialogMode) return;
  if (state.voiceDialogMode) dialogMicWanted = true;
  const token = voiceFlowToken;
  const onDone =
    state.voiceDialogMode && listenCallback
      ? () => {
          if (token !== voiceFlowToken) return;
          scheduleMicRestart(MIC_RESTART_AFTER_SPEECH_MS);
        }
      : undefined;
  speakText(text, onDone);
}

function startListening(onFinal, onError, options = {}) {
  if (!SpeechRecognitionCtor) {
    onError("Tu navegador no soporta voz. Probá Chrome o Edge.");
    return;
  }

  stopListening();

  const rec = new SpeechRecognitionCtor();
  rec.lang = getSpeechLang();
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;
  activeRecognition = rec;
  state.listening = true;
  if (state.screen === "chat") render();

  let committed = "";
  let flushTimer = null;
  let delivered = false;

  const deliverTranscript = (forceSend) => {
    if (delivered) return;
    const text = committed.trim();
    committed = "";
    if (!text) {
      if (forceSend) {
        onError("No se entendió nada. Hablá claro y cerca del micrófono.");
      } else if (state.voiceDialogMode && dialogMicWanted) {
        scheduleMicRestart(700);
      }
      return;
    }
    if (isLikelyAssistantEcho(text)) {
      if (state.voiceDialogMode && dialogMicWanted) scheduleMicRestart(700);
      return;
    }
    if (isStopVoiceCommand(text)) {
      handleUserStop(text);
      return;
    }
    delivered = true;
    stopListening();
    onFinal(text);
  };

  const scheduleFlush = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      deliverTranscript(false);
    }, MIC_FLUSH_MS);
  };

  rec.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const t = r[0]?.transcript?.trim() ?? "";
      if (!t) continue;
      if (r.isFinal) {
        committed = `${committed} ${t}`.trim();
      } else {
        interim = t;
      }
    }
    const preview = `${committed}${interim ? ` ${interim}` : ""}`.trim();
    if (options.onPartial) options.onPartial(preview);
    if (committed || interim) scheduleFlush();
  };

  rec.onerror = (event) => {
    const code = event?.error ?? "";
    if (code === "no-speech") {
      if (committed.trim()) {
        deliverTranscript(true);
        return;
      }
      stopListening();
      if (dialogMicWanted && state.voiceDialogMode) {
        scheduleMicRestart(700);
        return;
      }
      onError("No se escuchó nada. Probá de nuevo, más cerca del micrófono.");
      return;
    }
    stopListening();
    if (dialogMicWanted && code === "aborted") {
      scheduleMicRestart(350);
      return;
    }
    if (code === "aborted") return;
    onError("No se pudo capturar la voz. Revisá el permiso del micrófono.");
  };

  rec.onend = () => {
    activeRecognition = null;
    state.listening = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!delivered && committed.trim()) deliverTranscript(true);
    if (
      !delivered &&
      dialogMicWanted &&
      state.voiceDialogMode &&
      !state.speaking &&
      !state.sending &&
      state.screen === "chat"
    ) {
      scheduleMicRestart(700);
    }
    if (state.screen === "chat") render();
  };

  try {
    rec.start();
  } catch {
    stopListening();
    onError("No se pudo iniciar el micrófono.");
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const ICONS = {
  mic: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`,
  send: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2z"/></svg>`,
};

function iconBtn(className, title, iconKey) {
  const btn = el("button", className);
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = ICONS[iconKey] ?? "";
  return btn;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const list = app.querySelector(".chat-list");
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function render() {
  app.innerHTML = "";
  if (state.screen === "loading") return renderLoading();
  if (state.screen === "login") return renderLogin();
  if (state.screen === "register") return renderRegister();
  if (state.screen === "setup") return renderSetup();
  if (state.screen === "home") return renderHome();
  if (state.screen === "chat") {
    renderChat();
    scrollChatToBottom();
    return;
  }
  if (state.screen === "settings") return renderSettings();
}

function renderLoading() {
  const screen = el("div", "screen centered");
  screen.appendChild(el("div", "spinner"));
  app.appendChild(screen);
}

function chipGroup(options, selected, multi, onChange) {
  const wrap = el("div", "chips");
  for (const opt of options) {
    const chip = el("button", "chip" + (selected.includes(opt) ? " on" : ""), opt);
    chip.type = "button";
    chip.onclick = () => {
      if (multi) {
        onChange(
          selected.includes(opt) ? selected.filter((x) => x !== opt) : [...selected, opt]
        );
      } else {
        onChange([opt]);
      }
    };
    wrap.appendChild(chip);
  }
  return wrap;
}

function renderLogin() {
  const screen = el("div", "screen");
  screen.appendChild(el("h2", "title", "LocalGuide AI"));
  screen.appendChild(el("p", "subtitle", "Iniciá sesión"));

  const emailInput = el("input", "input");
  emailInput.type = "email";
  emailInput.placeholder = "Email";
  emailInput.autocomplete = "email";
  screen.appendChild(emailInput);

  const passInput = el("input", "input");
  passInput.type = "password";
  passInput.placeholder = "Contraseña";
  passInput.autocomplete = "current-password";
  screen.appendChild(passInput);

  const error = el("div", "error");
  screen.appendChild(error);

  const loginBtn = el("button", "btn", "Entrar");
  loginBtn.onclick = async () => {
    error.textContent = "";
    loginBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          password: passInput.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo iniciar sesión");
      setAuthToken(data.token);
      state.authUser = { email: data.email };
      state.profile = data.profile?.name?.trim() ? data.profile : null;
      if (state.profile) saveProfileLocalCache(state.profile);
      await loadSessionFromServer();
      if (hasProfile()) openChatScreen();
      else state.screen = "setup";
      render();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : "Error al iniciar sesión";
    } finally {
      loginBtn.disabled = false;
    }
  };
  screen.appendChild(loginBtn);

  const registerLink = el("button", "btn secondary", "Crear cuenta");
  registerLink.type = "button";
  registerLink.onclick = () => {
    state.screen = "register";
    render();
  };
  screen.appendChild(registerLink);
  app.appendChild(screen);
}

function renderRegister() {
  const screen = el("div", "screen");
  screen.appendChild(el("h2", "title", "Crear cuenta"));
  screen.appendChild(el("p", "hint", "Tu perfil y conversaciones se guardan en el servidor."));

  screen.appendChild(el("div", "label", "Nombre"));
  const nameInput = el("input", "input");
  nameInput.placeholder = "Cómo te llamamos";
  screen.appendChild(nameInput);

  const emailInput = el("input", "input");
  emailInput.type = "email";
  emailInput.placeholder = "Email";
  emailInput.autocomplete = "email";
  screen.appendChild(emailInput);

  const passInput = el("input", "input");
  passInput.type = "password";
  passInput.placeholder = "Contraseña (mín. 8 caracteres)";
  passInput.autocomplete = "new-password";
  screen.appendChild(passInput);

  const error = el("div", "error");
  screen.appendChild(error);

  const registerBtn = el("button", "btn", "Registrarme");
  registerBtn.onclick = async () => {
    error.textContent = "";
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = "Ingresá tu nombre.";
      return;
    }
    registerBtn.disabled = true;
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          email: emailInput.value.trim(),
          password: passInput.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo registrar");
      setAuthToken(data.token);
      state.authUser = { email: data.email };
      state.profile = data.profile;
      saveProfileLocalCache(data.profile);
      state.messages = [];
      state.savedPlaces = [];
      state.screen = "setup";
      render();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : "Error al registrar";
    } finally {
      registerBtn.disabled = false;
    }
  };
  screen.appendChild(registerBtn);

  const backBtn = el("button", "btn secondary", "Ya tengo cuenta");
  backBtn.type = "button";
  backBtn.onclick = () => {
    state.screen = "login";
    render();
  };
  screen.appendChild(backBtn);
  app.appendChild(screen);
}

function renderSetup() {
  const draft = state.profile ?? {
    name: "",
    language: "es",
    interests: [],
    foodPreferences: [],
    budget: "medio",
  };

  const screen = el("div", "screen");
  screen.appendChild(el("h2", "title", "Configurá tu perfil"));
  screen.appendChild(
    el(
      "p",
      "hint",
      state.authRequired
        ? "Estos datos se guardan en tu cuenta."
        : "Sin cuenta: los datos se guardan solo en este navegador."
    )
  );

  screen.appendChild(el("div", "label", "Nombre"));
  const nameInput = el("input", "input");
  nameInput.value = draft.name;
  nameInput.placeholder = "Cómo te llamamos";
  screen.appendChild(nameInput);

  screen.appendChild(el("div", "label", "Idioma"));
  const langRow = el("div", "row");
  for (const lang of ["es", "en"]) {
    const btn = el(
      "button",
      "chip" + (draft.language === lang ? " on" : ""),
      lang === "es" ? "Español" : "English"
    );
    btn.type = "button";
    btn.onclick = () => {
      draft.language = lang;
      state.profile = { ...draft };
      render();
    };
    langRow.appendChild(btn);
  }
  screen.appendChild(langRow);

  screen.appendChild(el("div", "label", "Intereses"));
  screen.appendChild(
    chipGroup(INTERESTS, draft.interests, true, (next) => {
      draft.interests = next;
      state.profile = { ...draft };
      render();
    })
  );

  screen.appendChild(el("div", "label", "Preferencias de comida"));
  screen.appendChild(
    chipGroup(FOODS, draft.foodPreferences, true, (next) => {
      draft.foodPreferences = next;
      state.profile = { ...draft };
      render();
    })
  );

  screen.appendChild(el("div", "label", "Presupuesto"));
  const budgetRow = el("div", "row");
  for (const b of BUDGETS) {
    const btn = el("button", "chip" + (draft.budget === b ? " on" : ""), b);
    btn.type = "button";
    btn.onclick = () => {
      draft.budget = b;
      state.profile = { ...draft };
      render();
    };
    budgetRow.appendChild(btn);
  }
  screen.appendChild(budgetRow);

  const error = el("div", "error");
  screen.appendChild(error);

  const saveBtn = el("button", "btn", "Guardar y continuar");
  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = "Ingresá tu nombre para continuar.";
      return;
    }
    saveBtn.disabled = true;
    try {
      await saveProfile({ ...draft, name });
      setSpeechLocale(draft.language === "en" ? "en-US" : "es-AR");
      openChatScreen({ fresh: true });
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : "No se pudo guardar";
    } finally {
      saveBtn.disabled = false;
    }
  };
  screen.appendChild(saveBtn);

  app.appendChild(screen);
}

function renderHome() {
  const screen = el("div", "screen");
  screen.appendChild(el("h2", "title", "LocalGuide AI"));
  screen.appendChild(el("p", "subtitle", "Ajustes"));

  const settingsBtn = el("button", "btn secondary", "Ajustes");
  settingsBtn.onclick = () => openSettings();
  screen.appendChild(settingsBtn);

  startLocationWatch();

  if (state.locationLoading && !state.location) {
    screen.appendChild(el("div", "location-status", "Detectando ubicación automáticamente..."));
    screen.appendChild(el("div", "spinner"));
  } else if (state.locationError) {
    screen.appendChild(el("div", "error", state.locationError));
    const retry = el("button", "btn secondary", "Reintentar ubicación");
    retry.onclick = () => {
      stopLocationWatch();
      startLocationWatch();
    };
    screen.appendChild(retry);
  } else if (state.location) {
    screen.appendChild(el("div", "label", "GPS activo"));
    screen.appendChild(
      el("div", "hint", "La ubicación se usa en segundo plano. Preguntá en el chat: «¿dónde estoy?»")
    );
  }

  const chatBtn = el("button", "btn", "Volver al chat");
  chatBtn.onclick = () => openChatScreen();
  screen.appendChild(chatBtn);

  app.appendChild(screen);
}

function renderPlaceCards(places) {
  const wrap = el("div", "place-cards");
  for (const p of places) {
    const isSelected =
      state.selectedPlace &&
      state.selectedPlace.name === p.name &&
      (state.selectedPlace.id === p.id || (!state.selectedPlace.id && !p.id));
    const card = el("div", "place-card" + (isSelected ? " selected" : ""));
    card.title = "Tocá para seleccionar";
    card.onclick = (ev) => {
      if (ev.target.closest("a")) return;
      state.selectedPlace = p;
      state.suggestedPlaces = places;
      render();
    };
    if (p.photoUrl) {
      const img = document.createElement("img");
      img.className = "place-photo";
      img.src = p.photoUrl;
      img.alt = p.name;
      img.loading = "lazy";
      card.appendChild(img);
    }
    card.appendChild(el("div", "place-name", p.name));
    if (p.rating != null) {
      const reviews =
        p.userRatingsTotal != null ? ` (${p.userRatingsTotal} reseñas)` : "";
      card.appendChild(el("div", "place-meta", `⭐ ${p.rating}${reviews}`));
    }
    if (p.address) {
      card.appendChild(el("div", "place-meta", p.address));
    }
    const actions = el("div", "place-actions");
    if (p.mapsUrl) {
      const maps = document.createElement("a");
      maps.href = p.mapsUrl;
      maps.target = "_blank";
      maps.rel = "noopener noreferrer";
      maps.className = "btn secondary btn-small";
      maps.textContent = "Google Maps";
      actions.appendChild(maps);
    }
    if (p.wazeUrl) {
      const waze = document.createElement("a");
      waze.href = p.wazeUrl;
      waze.target = "_blank";
      waze.rel = "noopener noreferrer";
      waze.className = "btn secondary btn-small";
      waze.textContent = "Waze";
      actions.appendChild(waze);
    }
    if (isSelected) {
      card.appendChild(el("div", "place-selected-badge", "Seleccionado"));
    }
    if (actions.childNodes.length) card.appendChild(actions);
    wrap.appendChild(card);
  }
  return wrap;
}

function renderChat() {
  const screen = el("div", "screen chat-screen");

  const header = el("div", "chat-header");
  const headerRow = el("div", "chat-header-row");
  const settingsBtn = el("button", "btn secondary btn-small", "Ajustes");
  settingsBtn.onclick = () => {
    stopAssistantOutput();
    openSettings();
  };
  headerRow.appendChild(settingsBtn);
  const statusHint = state.location
    ? "Asistente listo"
    : state.locationLoading
      ? "Preparando..."
      : "Esperando GPS";
  headerRow.appendChild(el("span", "hint chat-status", statusHint));
  header.appendChild(headerRow);
  screen.appendChild(header);

  if (!state.location && (state.locationError || !isSecureForGeolocation() || state.locationLoading === false)) {
    if (state.locationError || !isSecureForGeolocation()) {
      screen.appendChild(buildLocationBanner(retryLocationPermission));
    }
  }

  if (!state.location && state.locationLoading) {
    const waiting = el("div", "screen centered");
    waiting.style.minHeight = "120px";
    waiting.appendChild(el("div", "spinner"));
    waiting.appendChild(el("p", "hint", "Detectando ubicación automáticamente..."));
    screen.appendChild(waiting);
  }

  const activePlaces = getSuggestedPlaces();
  const activeSelection = getSelectedPlaceForContext();

  if (activePlaces.length) {
    const hint =
      getProfile()?.language === "en"
        ? 'Tap a card or say: "open the map for the first one".'
        : isMobileDevice()
          ? "Tocá una tarjeta o decí «abrí el mapa»."
          : 'Decí: «apuntá este lugar», «abrí el mapa», o «¿te acordás de…?».';
    screen.appendChild(el("p", "voice-hint interactive-hint", hint));
  }

  if (activeSelection) {
    const selRow = el("div", "selected-place-row");
    selRow.appendChild(
      el("span", "selected-place-label", `Seleccionado: ${activeSelection.name}`)
    );
    if (activeSelection.mapsUrl) {
      const mapsBtn = el("button", "btn secondary btn-small", "Maps");
      mapsBtn.type = "button";
      mapsBtn.onclick = () => {
        window.open(activeSelection.mapsUrl, "_blank", "noopener,noreferrer");
      };
      selRow.appendChild(mapsBtn);
    }
    if (activeSelection.wazeUrl) {
      const wazeBtn = el("button", "btn secondary btn-small", "Waze");
      wazeBtn.type = "button";
      wazeBtn.onclick = () => {
        window.open(activeSelection.wazeUrl, "_blank", "noopener,noreferrer");
      };
      selRow.appendChild(wazeBtn);
    }
    screen.appendChild(selRow);
  }

  const list = el("div", "chat-list");
  for (const msg of state.messages) {
    const bubble = el("div", `bubble ${msg.role}`);
    bubble.appendChild(el("div", "bubble-label", msg.role === "user" ? "Tú" : "Asistente"));
    bubble.appendChild(el("div", null, msg.text));
    if (msg.role === "assistant" && msg.places?.length) {
      bubble.appendChild(renderPlaceCards(msg.places));
    }
    if (msg.role === "assistant") {
      const listenBtn = el("button", "btn secondary btn-small", "Escuchar");
      listenBtn.type = "button";
      listenBtn.onclick = () => speakText(msg.text);
      bubble.appendChild(listenBtn);
    }
    list.appendChild(bubble);
  }
  screen.appendChild(list);

  chatMicRestartFn = null;

  const composer = el("div", "chat-composer");
  const row = el("div", "chat-input-row");
  const input = el("input", "input");
  input.placeholder = "Escribí tu mensaje…";
  const micBtn = iconBtn(
    "btn btn-icon mic" + (state.listening ? " listening" : ""),
    state.listening ? "Escuchando…" : "Hablar",
    "mic"
  );
  micBtn.disabled = state.sending || !SpeechRecognitionCtor;
  const stopBusy = isAssistantVoiceBusy() || (state.voiceDialogMode && dialogMicWanted);
  const stopBtn = iconBtn(
    "btn btn-icon stop" + (stopBusy ? " stop-active" : ""),
    "Parar (Esc)",
    "stop"
  );
  stopBtn.onclick = () => handleUserStop();
  const send = iconBtn("btn btn-icon send", "Enviar", "send");
  send.disabled = state.sending;
  const voiceError = el("div", "error");

  function startMicListening() {
    voiceError.textContent = "";
    if (state.speaking) {
      voiceFlowToken += 1;
      clearVoiceResumeTimer();
      stopSpeaking();
    }
    if (state.listening || state.sending) return;
    if (state.voiceDialogMode) dialogMicWanted = true;
    startListening(
      (text) => {
        if (!text) {
          voiceError.textContent = "No se entendió nada. Probá de nuevo.";
          if (state.voiceDialogMode && dialogMicWanted) scheduleMicRestart(600);
          render();
          return;
        }
        input.value = text;
        void sendMessage(text);
      },
      (msg) => {
        voiceError.textContent = msg;
        render();
      },
      {
        onPartial: (preview) => {
          if (preview) {
            input.value = preview;
            input.placeholder = "Escuchando…";
          }
          render();
        },
      }
    );
    render();
  }

  async function sendMessage(questionText) {
    const question = (questionText ?? input.value).trim();
    if (!question || state.sending) return;

    if (isStopVoiceCommand(question)) {
      input.value = "";
      handleUserStop(question);
      return;
    }

    if (!state.location) {
      voiceError.textContent = "Esperando ubicación GPS...";
      startLocationWatch();
      render();
      return;
    }

    stopListening();
    stopAssistantOutput({ endDialogMic: false });

    const saveMemory = tryHandleSaveMemoryCommand(question);
    if (saveMemory?.handled) {
      state.messages.push({ role: "user", text: question });
      input.value = "";
      respondAssistant(saveMemory.text, { places: saveMemory.places });
      render();
      afterAssistantSpeech(saveMemory.text, startMicListening);
      return;
    }

    const recallMemory = tryHandleRecallMemoryCommand(question);
    if (recallMemory?.handled) {
      state.messages.push({ role: "user", text: question });
      input.value = "";
      respondAssistant(recallMemory.text, { places: recallMemory.places });
      render();
      afterAssistantSpeech(recallMemory.text, startMicListening);
      return;
    }

    const interactive = tryHandleInteractiveCommand(question);
    if (interactive?.handled) {
      state.messages.push({ role: "user", text: question });
      input.value = "";
      persistChatHistory();
      respondAssistant(interactive.text);
      render();
      afterAssistantSpeech(interactive.text, startMicListening);
      return;
    }

    clearPlaceSelectionContext();
    state.messages.push({ role: "user", text: question });
    persistChatHistory();
    input.value = "";
    state.sending = true;
    voiceError.textContent = "";
    render();

    try {
      const profile = getProfile();
      const body = {
        question,
        lat: state.location.lat,
        lng: state.location.lng,
        userProfile: profile?.name?.trim() ? profile : undefined,
        conversationHistory: buildConversationHistoryForApi(),
        savedPlaces: getSavedPlaces(),
      };

      const res = await apiFetch("/api/assistant/ask", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Error del servidor (${res.status})`);
      }

      const reply = await res.json();
      const places = Array.isArray(reply.places) ? reply.places : undefined;
      respondAssistant(reply.answer, {
        simulated: reply.simulated,
        sources: reply.sources,
        places,
      });

      afterAssistantSpeech(reply.answer, startMicListening);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Error al contactar al servidor.";
      respondAssistant(text);
      afterAssistantSpeech(text, startMicListening);
    } finally {
      state.sending = false;
      render();
    }
  }

  chatMicRestartFn = startMicListening;

  micBtn.onclick = () => {
    if (state.listening) {
      handleUserStop();
      return;
    }
    if (state.speaking && getSuggestedPlaces().length) {
      stopSpeaking();
      if (state.voiceDialogMode) dialogMicWanted = true;
      startMicListening();
      return;
    }
    if (state.voiceDialogMode) dialogMicWanted = true;
    startMicListening();
  };

  send.onclick = sendMessage;
  input.onkeydown = (ev) => {
    if (ev.key === "Enter") void sendMessage();
  };

  row.appendChild(input);
  row.appendChild(micBtn);
  row.appendChild(stopBtn);
  row.appendChild(send);
  composer.appendChild(voiceError);
  composer.appendChild(row);
  screen.appendChild(composer);
  app.appendChild(screen);
}

function renderSettings() {
  const draft = state.settingsDraft ?? {
    name: "",
    language: "es",
    interests: [],
    foodPreferences: [],
    budget: "medio",
    speechLocale: getSpeechLocale(),
  };

  const screen = el("div", "screen settings-screen");
  const header = el("div", "row");
  const back = el("button", "btn secondary", "Volver al chat");
  back.onclick = () => openChatScreen();
  header.appendChild(back);
  screen.appendChild(header);

  screen.appendChild(el("h2", "title", "Ajustes"));
  screen.appendChild(el("p", "hint", "Perfil, voz y preferencias del asistente."));
  if (state.authUser?.email) {
    screen.appendChild(el("p", "hint", `Cuenta: ${state.authUser.email}`));
  }

  screen.appendChild(el("h3", "settings-section", "Tu perfil"));
  screen.appendChild(el("div", "label", "Nombre"));
  const nameInput = el("input", "input");
  nameInput.value = draft.name;
  screen.appendChild(nameInput);

  screen.appendChild(el("div", "label", "Idioma de respuestas"));
  const langRow = el("div", "row");
  for (const lang of ["es", "en"]) {
    const btn = el(
      "button",
      "chip" + (draft.language === lang ? " on" : ""),
      lang === "es" ? "Español" : "English"
    );
    btn.type = "button";
    btn.onclick = () => {
      draft.language = lang;
      draft.speechLocale = lang === "en" ? "en-US" : "es-AR";
      state.settingsDraft = { ...draft };
      setSpeechLocale(draft.speechLocale);
      render();
    };
    langRow.appendChild(btn);
  }
  screen.appendChild(langRow);

  screen.appendChild(el("div", "label", "Intereses"));
  screen.appendChild(
    chipGroup(INTERESTS, draft.interests, true, (next) => {
      draft.interests = next;
      state.settingsDraft = { ...draft };
      render();
    })
  );

  screen.appendChild(el("div", "label", "Preferencias de comida"));
  screen.appendChild(
    chipGroup(FOODS, draft.foodPreferences, true, (next) => {
      draft.foodPreferences = next;
      state.settingsDraft = { ...draft };
      render();
    })
  );

  screen.appendChild(el("div", "label", "Presupuesto"));
  const budgetRow = el("div", "row");
  for (const b of BUDGETS) {
    const btn = el("button", "chip" + (draft.budget === b ? " on" : ""), b);
    btn.type = "button";
    btn.onclick = () => {
      draft.budget = b;
      state.settingsDraft = { ...draft };
      render();
    };
    budgetRow.appendChild(btn);
  }
  screen.appendChild(budgetRow);

  screen.appendChild(el("h3", "settings-section", "Voz del asistente"));
  const ttsEngine = getTtsEngine();
  if (state.openaiTtsEnabled) {
    screen.appendChild(
      el(
        "p",
        "hint",
        "Voz OpenAI: natural, similar a ChatGPT. Recomendada en celular (Samsung, etc.)."
      )
    );
    screen.appendChild(el("div", "label", "Motor de voz"));
    const engineRow = el("div", "row");
    const openaiChip = el(
      "button",
      "chip" + (ttsEngine === "openai" ? " on" : ""),
      "OpenAI (natural)"
    );
    openaiChip.type = "button";
    openaiChip.onclick = () => {
      setTtsEngine("openai");
      render();
    };
    const browserChip = el(
      "button",
      "chip" + (ttsEngine === "browser" ? " on" : ""),
      "Navegador"
    );
    browserChip.type = "button";
    browserChip.onclick = () => {
      setTtsEngine("browser");
      render();
    };
    engineRow.appendChild(openaiChip);
    engineRow.appendChild(browserChip);
    screen.appendChild(engineRow);

    if (ttsEngine === "openai") {
      screen.appendChild(el("div", "label", "Voz OpenAI"));
      const openaiSelect = document.createElement("select");
      openaiSelect.className = "voice-select";
      const currentOpenAi = getOpenAiVoice();
      for (const v of OPENAI_TTS_VOICES) {
        const opt = document.createElement("option");
        opt.value = v.id;
        opt.textContent = v.label;
        if (v.id === currentOpenAi) opt.selected = true;
        openaiSelect.appendChild(opt);
      }
      openaiSelect.onchange = () => {
        setOpenAiVoice(openaiSelect.value);
        void speakText(
          draft.language === "en"
            ? "Hello, this is how I will sound from now on."
            : "Hola, así voy a sonar a partir de ahora."
        );
      };
      screen.appendChild(openaiSelect);
    }
  } else {
    screen.appendChild(
      el("p", "hint", "OpenAI TTS no disponible en el servidor. Se usa la voz del navegador.")
    );
  }

  screen.appendChild(el("div", "label", "Acento / región (micrófono y voz del navegador)"));
  const localeSelect = document.createElement("select");
  localeSelect.className = "voice-select";
  for (const opt of SPEECH_LOCALE_OPTIONS) {
    const o = document.createElement("option");
    o.value = opt.id;
    o.textContent = opt.label;
    if (opt.id === (draft.speechLocale || getSpeechLocale())) o.selected = true;
    localeSelect.appendChild(o);
  }
  localeSelect.onchange = () => {
    draft.speechLocale = localeSelect.value;
    state.settingsDraft = { ...draft };
    setSpeechLocale(localeSelect.value);
    render();
  };
  screen.appendChild(localeSelect);

  const voices = state.speechVoices.length ? state.speechVoices : getBrowserVoices();
  if (!state.openaiTtsEnabled || ttsEngine === "browser") {
    screen.appendChild(el("div", "label", "Locutor del navegador"));
    screen.appendChild(
      el(
        "p",
        "voice-hint",
        "Solo aplica si elegiste «Navegador». En celular suele haber una sola voz."
      )
    );
    if (voices.length === 0) {
      screen.appendChild(
        el("p", "voice-hint", "Cargando voces… Recargá la página si no aparecen.")
      );
    } else {
      const voiceSelect = document.createElement("select");
      voiceSelect.className = "voice-select";
      const autoOpt = document.createElement("option");
      autoOpt.value = "";
      autoOpt.textContent = "Automática (según región)";
      voiceSelect.appendChild(autoOpt);
      const current = getStoredVoiceUri();
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        const opt = document.createElement("option");
        opt.value = v.voiceURI;
        const tag = i === 0 && !current ? " ★ recomendada" : "";
        opt.textContent = `${v.name} — ${v.lang}${tag}`;
        if (v.voiceURI === current) opt.selected = true;
        voiceSelect.appendChild(opt);
      }
      voiceSelect.onchange = () => {
        if (voiceSelect.value) setStoredVoiceUri(voiceSelect.value);
        else {
          localStorage.removeItem(VOICE_URI_KEY);
          state.selectedVoiceUri = "";
        }
        void speakText("Así voy a sonar a partir de ahora.");
      };
      screen.appendChild(voiceSelect);
    }
  }

  const testVoiceBtn = el("button", "btn secondary", "Probar voz");
  testVoiceBtn.type = "button";
  testVoiceBtn.onclick = () => {
    void speakText(
      draft.language === "en"
        ? "Hello, I am your local guide."
        : "Hola, soy tu guía local. Así voy a sonar."
    );
  };
  screen.appendChild(testVoiceBtn);

  const voiceToggle = el(
    "button",
    "chip" + (state.voiceReplyEnabled ? " on" : ""),
    "Leer respuestas en voz alta"
  );
  voiceToggle.type = "button";
  voiceToggle.onclick = () => {
    setVoiceReplyEnabled(!state.voiceReplyEnabled);
    render();
  };
  screen.appendChild(voiceToggle);

  const dialogToggle = el(
    "button",
    "chip" + (state.voiceDialogMode ? " on" : ""),
    "Modo diálogo por voz"
  );
  dialogToggle.type = "button";
  dialogToggle.onclick = () => {
    setVoiceDialogMode(!state.voiceDialogMode);
    render();
  };
  screen.appendChild(dialogToggle);

  screen.appendChild(el("h3", "settings-section", "Ubicación"));
  screen.appendChild(
    el(
      "p",
      "hint",
      "El GPS funciona en segundo plano. El asistente no muestra coordenadas; preguntale «¿dónde estoy?» si necesitás el nombre del lugar."
    )
  );

  const error = el("div", "error");
  screen.appendChild(error);

  const saveBtn = el("button", "btn", "Guardar ajustes");
  saveBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = "Ingresá tu nombre para continuar.";
      return;
    }
    saveBtn.disabled = true;
    try {
      await saveProfile({
        name,
        language: draft.language,
        interests: draft.interests,
        foodPreferences: draft.foodPreferences,
        budget: draft.budget,
      });
      if (draft.speechLocale) setSpeechLocale(draft.speechLocale);
      state.settingsDraft = null;
      openChatScreen();
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : "No se pudo guardar";
    } finally {
      saveBtn.disabled = false;
    }
  };
  screen.appendChild(saveBtn);

  if (state.authRequired) {
    const logoutBtn = el("button", "btn secondary", "Cerrar sesión");
    logoutBtn.onclick = () => {
      clearAuthSession();
      state.screen = "login";
      state.settingsDraft = null;
      render();
    };
    screen.appendChild(logoutBtn);
  }

  const deleteBtn = el("button", "btn danger", state.authRequired ? "Borrar chat y lugares guardados" : "Borrar perfil y ajustes");
  deleteBtn.onclick = async () => {
    const msg = state.authRequired
      ? "Se borrarán tu historial de chat y lugares apuntados en el servidor. ¿Continuar?"
      : "Se eliminarán perfil y preferencias de este navegador. ¿Continuar?";
    if (!confirm(msg)) return;
    if (state.authRequired) await clearProfileRemote();
    else clearProfile();
    localStorage.removeItem(VOICE_REPLY_KEY);
    localStorage.removeItem(VOICE_DIALOG_KEY);
    localStorage.removeItem(VOICE_URI_KEY);
    localStorage.removeItem(SPEECH_LOCALE_KEY);
    localStorage.removeItem(TTS_ENGINE_KEY);
    localStorage.removeItem(OPENAI_VOICE_KEY);
    state.screen = state.authRequired ? "setup" : "setup";
    state.settingsDraft = null;
    render();
  };
  screen.appendChild(deleteBtn);

  app.appendChild(screen);
}

async function boot() {
  state.voiceReplyEnabled = getVoiceReplyEnabled();
  state.voiceDialogMode = getVoiceDialogMode();
  if (state.voiceDialogMode) dialogMicWanted = true;
  state.selectedVoiceUri = getStoredVoiceUri();
  state.speechLocale = getSpeechLocale();
  state.openaiVoice = getOpenAiVoice();

  const providers = await fetchProvidersStatus();
  state.openaiTtsEnabled = Boolean(providers.openaiTtsEnabled);
  state.ttsEngine = getTtsEngine();
  if (state.openaiTtsEnabled && !localStorage.getItem(TTS_ENGINE_KEY)) {
    setTtsEngine("openai");
  }

  initSpeechVoices();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.screen === "chat" && isAssistantVoiceBusy()) {
      e.preventDefault();
      handleUserStop();
    }
  });

  const status = await fetchServerStatus();
  state.authRequired = Boolean(status.authRequired || status.database);

  if (state.authRequired) {
    if (!getAuthToken()) {
      state.screen = "login";
      render();
      return;
    }
    try {
      await loadSessionFromServer();
    } catch {
      clearAuthSession();
      state.screen = "login";
      render();
      return;
    }
    if (hasProfile()) openChatScreen();
    else state.screen = "setup";
    render();
    return;
  }

  if (hasProfile()) openChatScreen();
  else {
    state.screen = "setup";
    render();
  }
}

void boot();
