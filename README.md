# LocalGuide AI (MVP)

App móvil tipo guía local con IA: ubicación en tiempo real y chat que consulta al backend (respuesta **simulada** hasta conectar APIs).

## Estructura

- `backend/` — Node.js + Express + TypeScript
- `mobile/` — React Native + Expo + TypeScript
- `docs/` — notas técnicas y guía de API keys

## Requisitos

- Node.js 18 o superior
- npm (incluido con Node)

## Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Por defecto escucha en `http://localhost:3011`. Si ese u otro puerto está ocupado, cambiá `PORT` en `backend/.env` (por ejemplo `PORT=3020`).

### Variables de entorno (`backend/.env`)

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto HTTP (por defecto 3011 vía código si no se define). |
| `ENABLE_REAL_PROVIDERS` | `true` / `false` (por defecto `false`). Con `true` y las keys necesarias, se usan OpenAI (intención + redacción) y Google Places según corresponda. |
| `OPENAI_API_KEY` | Key de la [API de OpenAI](https://platform.openai.com/api-keys). **No la subas al repo**; solo en `backend/.env` o variables del servidor. |
| `OPENAI_MODEL` | Modelo de chat (por defecto `gpt-4o-mini`). |
| `GOOGLE_PLACES_API_KEY` | Key de la API **Places (New)** de Google Cloud. Ver sección siguiente. **No subas `.env` al repositorio.** |

Copiá `backend/.env.example` a `backend/.env` y completá las variables (el archivo `.env` no debe versionarse).

**Guía completa de keys (cuando quieras integrarlas):** [docs/api-keys.md](docs/api-keys.md)

#### OpenAI (intención y redacción)

1. Creá una API key en el panel de OpenAI y asignala a `OPENAI_API_KEY`.
2. Opcional: `OPENAI_MODEL` (por defecto `gpt-4o-mini`).
3. El modelo **solo recibe** en el prompt datos ya obtenidos por el backend (p. ej. lista de lugares de Google). Las instrucciones del sistema prohíben inventar nombres, ratings, direcciones o estadísticas.
4. Si OpenAI falla (timeout ~12 s, error HTTP, etc.), se usa el **listado formateado** con datos de Places, sin error 500.

#### Google Places API (clave segura)

1. En [Google Cloud Console](https://console.cloud.google.com/) creá o elegí un proyecto.
2. Habilitá **Places API (New)** (Maps Platform).
3. Creá credencial **API key**; restringila por IP (servidor) o por referer HTTP si aplica.
4. Facturación: Places suele requerir cuenta de facturación activa (consultá la cuota gratuita actual de Google).
5. Copiá la key en `backend/.env` como `GOOGLE_PLACES_API_KEY=...` (solo en tu máquina o servidor, nunca en git).

#### Activar providers reales

1. `ENABLE_REAL_PROVIDERS=true`
2. `GOOGLE_PLACES_API_KEY` para búsquedas de lugares.
3. `OPENAI_API_KEY` (recomendado): interpreta intención y redacta con datos reales. Sin esta key, la intención de lugares usa **palabras clave** como respaldo.

La query de Places prioriza lo que devuelve OpenAI en `searchQuery`; si OpenAI falla, se usa el fallback por keywords. Si OpenAI redacta la respuesta, solo puede usar los lugares devueltos por Google.

### Modo simulado vs respuesta con datos reales

- **Simulado** (`simulated: true`): `ENABLE_REAL_PROVIDERS=false`, intención `unknown`, fallo de Places, cero resultados, o `city_facts` sin Wikidata conectado.
- **Datos reales de Google** (`simulated: false`, `sources` incluye `"google_places"`): Places devolvió locales; el texto puede ser **redactado por OpenAI** solo con ese JSON, o el **formato fijo** si OpenAI no está o falla.

### Estado de providers

```http
GET /api/providers/status
```

Ejemplo de respuesta:

```json
{
  "realProvidersEnabled": true,
  "openaiConfigured": true,
  "openaiEnabled": true,
  "openaiModel": "gpt-4o-mini",
  "googlePlacesConfigured": true,
  "googlePlacesEnabled": true,
  "wikidataAvailable": true,
  "wikidataEnabled": true,
  "osmAvailable": true,
  "osmEnabled": true
}
```

- `openaiConfigured` / `openaiEnabled`: key de OpenAI cargada y flag activo.
- `openaiModel`: modelo usado en las llamadas (o `null` si no hay key configurada).
- `realProvidersEnabled`: valor de `ENABLE_REAL_PROVIDERS`.
- `googlePlacesConfigured` / `googlePlacesEnabled`: key de Places y flag.
- `wikidataAvailable` / `wikidataEnabled`: Wikidata + Nominatim (sin key; datos de ciudad).
- `osmAvailable` / `osmEnabled`: OpenStreetMap vía Overpass (sin key; POI cercanos como fallback de Places).

Probar en terminal (con el servidor en marcha):

```powershell
Invoke-RestMethod "http://localhost:3011/api/providers/status" | ConvertTo-Json
```

### Endpoints

- `GET /api/health` — comprobación de servicio
- `GET /api/providers/status` — estado de configuración de providers
- `POST /api/assistant/ask` — mismo contrato: `question`, `lat`, `lng`, `userProfile` opcional. Con providers activos, la respuesta puede ser simulada, basada solo en Places (listado o redacción OpenAI), o mensaje de “datos de ciudad no conectados” para `city_facts`.

#### Probar OpenAI + Google Places

En `.env`: `ENABLE_REAL_PROVIDERS=true`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, y opcionalmente `OPENAI_MODEL`.

```powershell
$body = @{
  question = "¿Dónde puedo comer pasta cerca?"
  lat = 26.5253
  lng = -80.0664
  userProfile = @{
    name = "Juan"
    language = "es"
    interests = @("comida")
    foodPreferences = @("italiana")
    budget = "medio"
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod "http://localhost:3011/api/assistant/ask" -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
```

**Respuesta esperada (con resultados de Google y OpenAI):** `simulated: false`, `sources` con `"google_places"`, y en `answer` un texto natural que **solo** menciona locales y datos presentes en la respuesta de Places (nombres, ratings, direcciones según la API).

**Solo Places (sin OpenAI o si OpenAI falla):** mismo `simulated: false` y listado estructurado con datos reales de Google.

**Si no hay resultados:** `simulated` suele ser `true`, mensaje explicando que no hubo resultados confiables cerca (sin inventar nombres).

## Perfil local del usuario (app)

- **Sin login ni base de datos**: nombre e preferencias se guardan solo en el dispositivo con **AsyncStorage**.
- **Clave de almacenamiento**: `LOCALGUIDE_USER_PROFILE` (ver `mobile/src/storage/userProfileStorage.ts`).
- **Datos**: nombre, idioma (`es` / `en`), lista de intereses, preferencias de comida, presupuesto (`bajo` / `medio` / `alto`).
- **Primera vez**: la app muestra la pantalla de configuración de perfil; después, inicio y chat como antes.
- **Borrar perfil**: en **Mi perfil** tocá *Borrar perfil local*; se eliminan los datos del teléfono y volvés al setup inicial.

## App móvil (Expo)

```bash
cd mobile
cp .env.example .env
npm install
npx expo start
```

En `.env`, define la URL del backend:

- Emulador Android: suele funcionar `http://10.0.2.2:3011` hacia el host (mismo puerto que `PORT` del backend)
- Simulador iOS: `http://localhost:3011`
- Dispositivo físico: `http://<IP-LAN-de-tu-PC>:3011`

## Reglas del proyecto

Ver `.cursor/rules.md`.
