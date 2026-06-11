# Notas técnicas — LocalGuide AI (MVP)

## Contrato HTTP

### `GET /api/health`

```json
{ "ok": true, "service": "localguide-ai-backend" }
```

### `GET /api/providers/status`

Estado de configuración de providers (simulado vs real, keys cargadas).

### `POST /api/assistant/ask`

**Body (JSON):**

```json
{
  "question": "¿Cuál es el mejor restaurante para comer pasta cerca?",
  "lat": 26.5253,
  "lng": -80.0664,
  "userProfile": {
    "name": "Juan",
    "language": "es",
    "interests": ["comida"],
    "foodPreferences": ["italiana"],
    "budget": "medio"
  }
}
```

**Respuesta:**

```json
{
  "answer": "...",
  "simulated": false,
  "location": { "lat": 26.5253, "lng": -80.0664 },
  "sources": ["google_places"],
  "places": [
    {
      "name": "Los Inmortales",
      "address": "Lavalle 746",
      "rating": 4.2,
      "photoUrl": "/api/places/photo?ref=places%2F...",
      "mapsUrl": "https://www.google.com/maps/dir/?api=1&...",
      "wazeUrl": "https://waze.com/ul?ll=-34.60,-58.38&navigate=yes",
      "source": "google_places"
    }
  ]
}
```

- `simulated: true` — sin datos verificables o modo simulado activo.
- `sources` — fuentes usadas: `google_places`, `osm`, `wikidata`.
- `places` — tarjetas con foto (Google Places), Google Maps y Waze cuando hay coordenadas.

## Integraciones

| Fuente | Estado | Requiere key |
|--------|--------|--------------|
| OpenAI API | Implementado | Sí (`OPENAI_API_KEY`) |
| Google Places API (New) | Implementado | Sí (`GOOGLE_PLACES_API_KEY`) |
| Wikidata + Nominatim | Implementado | No |
| OpenStreetMap / Overpass | Implementado | No |

Pipeline (`localGuideService`):

1. Si `ENABLE_REAL_PROVIDERS=false` → respuesta simulada.
2. Clasificación de intención: OpenAI o fallback por keywords.
3. `places` → Google Places; si vacío, OSM.
4. `city_facts` → Wikidata vía geocodificación y SPARQL.
5. Redacción: OpenAI con datos reales, o formato fijo.

Ver [api-keys.md](./api-keys.md) para activar keys cuando corresponda.

## Variables de entorno

- Backend: `backend/.env` (ver `backend/.env.example`)
- Mobile: `mobile/.env` → `EXPO_PUBLIC_API_URL`

## App móvil

- Perfil local en AsyncStorage (`LOCALGUIDE_USER_PROFILE`)
- Chat muestra aviso si `simulated: true` y lista `sources`
- Sin login ni base de datos en el MVP

## Fuera del MVP actual

- Persistencia MySQL/PostgreSQL
- Autenticación de usuarios
- Historial de chat en servidor
