# GDD — Despliegue local (PC del streamer, 24/7)

Guía real del hosting alternativo a Render: el servidor corre 24/7 en el propio PC del streamer (Windows), con PM2 gestionando el proceso, Postgres/Neon como base de datos, dominio propio (`colony-streamer.online`) y Cloudflare Tunnel para exponerlo sin abrir puertos (el streamer está detrás de CG-NAT). Contexto completo de la decisión en `CLAUDE.md` § "Hosting 24/7 alternativo".

## Setup inicial (una vez)

1. Clonar el repo, `npm install` en la raíz (instala los workspaces).
2. `server/.env` con `DATABASE_URL` (Neon) y el resto de variables — ver `server/.env.example`.
3. `npm run build -w server`.
4. `pm2 start server/deploy/ecosystem.config.js` (fork, no cluster — Colyseus guarda estado de partida en memoria de proceso, un solo fork es obligatorio).
5. `pm2 save` + `pm2 startup`/paquete `pm2-windows-startup` para que sobreviva a un reinicio del PC.
6. Cloudflare Tunnel apuntando `play.colony-streamer.online` al puerto local del servidor.

## Actualizar a mano (`actualizar.ps1`)

`git pull` + `npm install` + build + `pm2 restart colony-server`, disparado por el streamer cuando decide que es buen momento (p.ej. sin nadie jugando). Nunca se dispara solo — sigue existiendo para cuando se quiera forzar un redeploy inmediato sin esperar al ciclo de sondeo del script automático de abajo.

```
powershell -ExecutionPolicy Bypass -File server/deploy/actualizar.ps1
```

## Auto-deploy (`autoActualizar.ps1`, 2026-09-09)

Pedido explícito del streamer ("que el pm2 se reinicie solo con cada push a main a github") — revierte a propósito la decisión anterior de mantener el redeploy 100% manual, pero conservando la misma garantía de seguridad: **nunca corta una partida en curso**.

**Cómo decide si reiniciar:**
1. `git fetch origin main` y compara contra un marcador local (`server/deploy/.ultimoCommitDesplegado`, no versionado — es el commit que de verdad está corriendo en PM2 ahora mismo, que puede ir por detrás del HEAD local si un `pull` anterior no llegó a reiniciar).
2. Si hay commits nuevos, `git pull` siempre (barato, mantiene el working tree al día aunque no haga falta reiniciar).
3. Si el diff entre el commit desplegado y el nuevo `origin/main` **no toca `server/`** (cambios de cliente, bakeadores, docs...) → no hace falta reiniciar nada, actualiza el marcador y termina.
4. Si SÍ toca `server/`, consulta `GET http://localhost:<PORT>/estado` (nuevo endpoint sin autenticar, expone solo `{jugadoresConectados}` — contador global de sesiones vivas en el proceso, `server/src/mundo/contadorConexiones.ts`, incrementado/decrementado en `crearJugador`/`onLeave` de `RoomExteriorBase.ts`, el único punto de entrada/salida compartido por las 5 room types).
5. Si `jugadoresConectados > 0` → se aplaza sin tocar nada, se reintenta la próxima vez que se dispare la tarea.
6. Si está en 0 → `npm install` + `npm run build -w server` + `pm2 restart colony-server`, y actualiza el marcador al nuevo commit.

**Setup (una vez, además del setup inicial de arriba):** crear una Tarea Programada de Windows que ejecute, cada pocos minutos (2-5 min es razonable — el coste de cada intento en vacío es solo un `git fetch` + una petición HTTP local):

```
powershell -ExecutionPolicy Bypass -File server/deploy/autoActualizar.ps1
```

(Configurador de Tareas → Crear tarea básica → Desencadenador "Repetir cada" → Acción "Iniciar un programa": `powershell.exe` con argumentos `-ExecutionPolicy Bypass -File C:\ruta\a\Colony\server\deploy\autoActualizar.ps1`, directorio de inicio `C:\ruta\a\Colony`.)

**Por qué el marcador es un archivo local y no simplemente "el HEAD de git":** porque el script puede hacer `git pull` sin reiniciar (paso 3 arriba) — en ese momento el HEAD local YA está por delante de lo que PM2 tiene cargado en memoria. Sin el marcador, la siguiente ejecución no podría saber si el cambio pendiente de verdad toca `server/` respecto a lo que está corriendo, solo respecto al HEAD ya actualizado (que ya no refleja el commit real desplegado).

**Qué pasa si el servidor nunca se vacía:** el reinicio se aplaza indefinidamente — el streamer sigue teniendo `actualizar.ps1` a mano para forzarlo si necesita la versión nueva ya. No hay ningún timeout que fuerce un reinicio con gente conectada: es una decisión de diseño explícita, no un límite técnico.
