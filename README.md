# Streamer Colony — prototipo Fase 1

Prototipo mínimo cliente-servidor: dos (o más) sprites placeholder moviéndose en pantalla, sincronizados en tiempo real entre pestañas/navegadores distintos.

- **`server/`** — Node.js + [Colyseus](https://colyseus.io/) (sala `hub` autoritativa).
- **`client/`** — [Phaser 3](https://phaser.io/) + Vite + TypeScript.
- **`baker/`** — bakeador de mapas exteriores (genera el mundo una sola vez, offline, sin dependencias) + visor con cámara libre para revisarlo. Ver `baker/README.md` para instrucciones.
- **`interiores/`** — catálogo del bakeador de interiores (casas, tabernas, castillos — instancias separadas del mapa exterior, a las que se entra por los POI tipo `portal`). Motor de generación (WFC) todavía sin construir — ver `interiores/README.md`.
- **`docs/`** — documentos de diseño: `GDD_Bakeador_Exteriores.md`, `GDD_Bakeador_Interiores.md`, catálogo de especies (`Catalogo_Especies_Exterior.md`) y backlog de mecánicas futuras (`Backlog_Mecanicas_Futuras.md`).

## Cómo correrlo en local

Requiere Node.js 18+ (recomendado 22).

```bash
npm install          # instala server y client (workspaces)
npm run dev:server   # terminal 1 — arranca en ws://localhost:2567
npm run dev:client   # terminal 2 — arranca en http://localhost:5173
```

Abre `http://localhost:5173` en dos pestañas (o dos navegadores) distintas. Muévete con `WASD` o las flechas — deberías ver tu propio sprite (naranja) moverse en ambas pestañas, y el sprite del otro jugador (verde) aparecer y moverse también.

## Diseño pensado para planes 100% gratuitos

- **Render/Fly.io (free) — server**: la simulación corre a 30hz (barata en CPU) pero el estado solo se manda al cliente 15 veces/seg (`setPatchRate`), para bajar el consumo de ancho de banda. El cliente solo envía un mensaje de input cuando *cambia* la dirección (no en cada frame), no hay polling. `maxClients` está limitado por sala para no disparar el uso de RAM. El servidor responde `200 OK` en cualquier ruta HTTP, así que sirve como health check — importante porque el plan free de Render "duerme" el proceso tras 15 min sin tráfico y lo despierta con la siguiente petición (~1 min).
- **Supabase/Neon (free) — Postgres**: todavía no se usa en esta Fase 1 (no hay persistencia de inventario/cuenta aún), pero la arquitectura ya está pensada para que el server sea el único que hable con la base de datos — el cliente nunca la toca directo.
- **Vercel (free) — client**: `client/` es un build estático de Vite, ideal para Vercel. En el dashboard de Vercel, configura el proyecto con **Root Directory: `client`**, build command `npm run build`, output `dist`. Añade la variable de entorno `VITE_COLYSEUS_URL` apuntando a la URL pública de tu server en Render/Fly (ej. `wss://colony-server.onrender.com`).

## Desplegar el server (Render, gratis)

Este repo ya trae `render.yaml` en la raíz apuntando a `rootDir: server`. En Render: "New" → "Blueprint" → conecta este repo → debería detectar `render.yaml` solo. Si no, configura a mano: Root Directory `server`, Build Command `npm install && npm run build`, Start Command `npm start`, plan **Free**.

## Próximos pasos (Fase 2+)

- Persistencia de cuenta/inventario (Postgres vía Supabase/Neon).
- Chat global y por proximidad.
- Parcelas/instancias de gremio con simulación de grid.
- NPCs con IA (Gobernadores).
