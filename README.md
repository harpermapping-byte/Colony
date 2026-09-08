# Streamer Colony

MMO RPG medieval instanciado (Hub persistente + regiones/interiores/mazmorras), con integración de Twitch. **Ver `CLAUDE.md` para el estado real y completo del proyecto** — es la memoria viva que cualquier sesión (humana o agente) debe leer antes de tocar nada; este archivo solo cubre cómo arrancarlo en local.

- **`server/`** — Node.js + [Colyseus](https://colyseus.io/) (rooms `hub`/`region`/`interior`/`mazmorra`/`arena`). Persistencia real: SQLite local automático (sin configurar nada) o Postgres/Neon en producción vía `DATABASE_URL`.
- **`client/`** — [Three.js](https://threejs.org/) (cámara ortográfica isométrica, modelos 3D vóxel reales) + Colyseus.js + Vite + TypeScript.
- **`baker/`, `interiores/`, `ciudades/`, `mazmorras/`, `poblacion/`, `ropa/`, `personajes/`, `taller-vox/`** — bakeadores y generadores procedurales offline (mapa exterior, edificios, aldeas/ciudades, mazmorras, NPCs, ropa, arte 3D). Cada uno tiene su propio README/GDD en `docs/`.

## Cómo correrlo en local

Requiere **Node.js 22.5+** (imprescindible: el server usa `node:sqlite`, nativo desde esa versión, como base de datos local cuando no hay `DATABASE_URL` configurada — con una versión anterior el server no arranca).

```bash
npm install          # instala server y client (workspaces)
npm run dev:server   # terminal 1 — ws://localhost:2567, crea server/datos.sqlite solo
npm run dev:client   # terminal 2 — http://localhost:5173
```

Abre `http://localhost:5173`. El servidor carga automáticamente `assets/mapas/principal/` (el mapa principal del repo) si existe en disco — cero configuración. Todo lo demás es opcional y se desactiva solo con un aviso en consola si falta (Twitch: `TWITCH_BOT_TOKEN`/`TWITCH_BOT_USERNAME`/`TWITCH_CANAL`; diálogo de NPCs con IA: `GEMINI_API_KEY`/`GROQ_API_KEY`) — el resto del juego funciona igual sin ellas.

## Desplegar (gratis)

- **Server**: Render (`render.yaml` en la raíz ya apunta a `rootDir: server` y fija `NODE_VERSION=22`) o Fly.io. Añade `DATABASE_URL` (Postgres/Neon) para persistencia real en un server que se reinicia — sin ella cae a SQLite local, que no sobrevive a un redeploy.
- **Client**: Vercel — Root Directory `client`, build `npm run build`, output `dist`, variable `VITE_COLYSEUS_URL` apuntando a la URL pública del server (ej. `wss://colony-server.onrender.com`).
