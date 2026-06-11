# Guía de API keys — LocalGuide AI

Cuando quieras activar respuestas con datos reales, seguí estos pasos. **No subas las keys al repositorio**; solo van en `backend/.env`.

## 1. Activar modo real

En `backend/.env`:

```env
ENABLE_REAL_PROVIDERS=true
```

Reiniciá el backend (`npm run dev`).

## 2. OpenAI (recomendado)

**Para qué sirve:** interpretar la intención de la pregunta y redactar respuestas naturales usando solo datos de Places, OSM o Wikidata.

**Dónde obtenerla:**

1. Entrá a [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Creá una cuenta o iniciá sesión
3. Generá una API key nueva
4. Copiala en `backend/.env`:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

**Costo:** facturación por uso según el modelo. `gpt-4o-mini` es el más económico para este MVP.

**Sin OpenAI:** el sistema sigue funcionando con fallback por palabras clave y formato fijo de listados.

## 3. Google Places API (recomendado para locales)

**Para qué sirve:** restaurantes, bares, museos, hoteles y otros POI con ratings y direcciones.

**Dónde obtenerla:**

1. [Google Cloud Console](https://console.cloud.google.com/)
2. Creá o elegí un proyecto
3. Habilitá **Places API (New)** (Maps Platform)
4. Creá una credencial tipo **API key**
5. Restringila por IP (servidor) o según tu despliegue
6. Activá facturación (Google suele ofrecer crédito mensual gratuito; revisá la cuota actual)

```env
GOOGLE_PLACES_API_KEY=AIza...
```

**Sin Google Places:** el backend usa **OpenStreetMap (Overpass)** como alternativa para lugares cercanos.

## 4. Wikidata y OpenStreetMap (sin key)

Estas fuentes **no requieren API key**:

| Fuente | Uso |
|--------|-----|
| **Wikidata** | Población, superficie y descripción de la ciudad |
| **OpenStreetMap / Overpass** | POI cercanos cuando Google Places no está o no devuelve resultados |
| **Nominatim** | Geocodificación inversa para vincular coordenadas con Wikidata |

Se activan automáticamente con `ENABLE_REAL_PROVIDERS=true`.

## 5. App móvil

En `mobile/.env`, apuntá al backend:

| Entorno | URL típica |
|---------|------------|
| Simulador iOS | `http://localhost:3011` |
| Emulador Android | `http://10.0.2.2:3011` |
| Celular físico | `http://<IP-LAN-de-tu-PC>:3011` |

Reiniciá Expo después de cambiar `.env`.

## 6. Verificar configuración

Con el backend en marcha:

```powershell
Invoke-RestMethod "http://localhost:3011/api/providers/status" | ConvertTo-Json
```

Campos útiles:

- `realProvidersEnabled` — debe ser `true`
- `openaiConfigured` / `googlePlacesConfigured` — keys cargadas
- `wikidataEnabled` / `osmEnabled` — activos con modo real

## Orden sugerido de integración

1. `ENABLE_REAL_PROVIDERS=true` → probá preguntas de ciudad y lugares (Wikidata + OSM)
2. Agregá `GOOGLE_PLACES_API_KEY` → locales con **fotos**, ratings y botones Maps/Waze
3. Agregá `OPENAI_API_KEY` → respuestas más naturales y mejor clasificación de intención

### Qué desbloquea cada key

| Key | Funciones |
|-----|-----------|
| Solo modo real | Wikidata (ciudad), OSM (lugares sin foto), Maps/Waze en OSM |
| Google Places | Fotos reales, ratings, direcciones más completas |
| OpenAI | Respuestas redactadas de forma natural |

Las fotos se sirven vía `GET /api/places/photo?ref=...` (la API key no se expone al navegador).
