# LocalGuide AI — reglas del proyecto

## Datos y APIs

- No inventar datos reales (población, negocios, historia, etc.) si no hay una API o fuente conectada y verificable.
- Las respuestas de asistente sin integración activa deben ser **explícitamente simuladas o genéricas**, sin presentarse como hechos del lugar.

## Estructura del repositorio

- Mantener **backend** y **mobile** como proyectos separados (`/backend`, `/mobile`), cada uno con su propio `package.json` y dependencias.
- No mezclar lógica de servidor en la app móvil ni lógica de UI en el servidor salvo contratos HTTP claros.

## Tecnología

- Usar **TypeScript** en backend y mobile salvo archivos de configuración que requieran otro formato.

## Alcance (MVP)

- No agregar funcionalidades extra fuera del alcance acordado del MVP sin acuerdo explícito.
- Priorizar código limpio, contratos API estables y extensiones preparadas para OpenAI, Google Places, Wikidata y OpenStreetMap cuando correspondan.

## Cambios en el código

- Antes de modificar muchos archivos o hacer refactors amplios, **indicar qué archivos se van a tocar** y el motivo.

## Objetivo inicial

- Tener **backend + app móvil funcionando** con ubicación del usuario, chat hacia el servidor y respuestas **simuladas** hasta conectar APIs reales.
