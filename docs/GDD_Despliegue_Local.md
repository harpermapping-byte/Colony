# GDD — Despliegue local (PC del streamer, 24/7)

Guía real del hosting propio: **todo** (juego y web) corre 24/7 en un PC dedicado del streamer (Windows, 32GB, solo para esto), con PM2 gestionando el proceso, Postgres/Neon como base de datos, dominio propio (`colony-streamer.online`) y Cloudflare Tunnel para exponerlo sin abrir puertos (el streamer está detrás de CG-NAT de Digi, con IP variable). Contexto completo de la decisión en `CLAUDE.md` § "Hosting 24/7 alternativo".

Desde **2026-09-09 ya no hay Vercel**: el cliente web dejó de estar hospedado aparte y lo sirve el MISMO proceso Node que corre Colyseus (§ "Un solo proceso" más abajo). Render lleva suspendido desde antes y tampoco se usa.

## Por qué CG-NAT e IP variable dan igual

Cloudflare Tunnel no necesita ni un puerto abierto ni una IP fija: `cloudflared` abre la conexión **desde** el PC **hacia** el borde de Cloudflare y la mantiene, y el DNS del dominio apunta a Cloudflare, nunca a la IP de casa. Por eso el CG-NAT de Digi (que impide recibir conexiones entrantes) y que la IP cambie sola no afectan a nada: si la IP cambia, el túnel se vuelve a conectar solo y los jugadores no se enteran. Tampoco hace falta DDNS.

Lo que sí importa de la conexión es la **subida** (todo el mapa y los .glb salen del PC), no la bajada.

## Setup inicial (una vez)

1. Clonar el repo, `npm install` en la raíz (instala los workspaces).
2. `server/.env` con `DATABASE_URL` (Neon) y el resto de variables — ver `server/.env.example`.
3. `npm run build -w server` **y** `npm run build -w client` (los dos: el proceso sirve también la web).
4. `pm2 start server/deploy/ecosystem.config.js` (fork, no cluster — Colyseus guarda estado de partida en memoria de proceso, un solo fork es obligatorio).
5. `pm2 save` + `pm2 startup`/paquete `pm2-windows-startup` para que sobreviva a un reinicio del PC.
6. Cloudflare Tunnel apuntando el **dominio raíz** `colony-streamer.online` al puerto local del servidor (§ "Cloudflare" más abajo).

## Un solo proceso sirve juego + web (2026-09-09)

Pedido del streamer al pasarse el plan gratis de Vercel ("mover todo al PC"). En vez de levantar un segundo servidor de archivos, el `http.Server` que ya existía (health check + rutas de Twitch/admin/cuentas + WebSocket de Colyseus) gana una ruta de fallback que sirve el cliente: `server/src/estatico/servidorEstatico.ts`.

**Orden de resolución de cada petición** (`server/src/index.ts`): rutas de API (`/auth/twitch/*`, `/auth/admin/*`, `/auth/jugador/*`, `/estado`) → estático del cliente → health check de texto plano. El matchmaking de Colyseus (`POST /matchmake/*`) no pasa por ahí: Colyseus registra su propio listener sobre el mismo servidor, y el estático solo atiende GET/HEAD.

**El WebSocket no sufre nada**: el upgrade viaja por el evento `upgrade` del `http.Server`, distinto del `request` que atiende el estático. Verificado: un upgrade crudo contra el mismo puerto responde `101 Switching Protocols`.

**De dónde sale cada cosa:**
- `/` y el bundle (`/_bundle/**`, `index.html`) → `client/dist/`, o sea el resultado de `npm run build -w client`.
- `/assets/**` (mapas bakeados, `.glb`, texturas) → **directamente la carpeta `assets/` del repo**, NO la copia que `vite build` deja en `client/dist/assets/`. Son 343MB: copiarlos en cada build es tiempo y disco a cambio de nada cuando el servidor vive dentro del propio repo clonado, y así **un rehorneado de mapa entra en vivo con un simple `git pull`**, sin recompilar el cliente y sin reiniciar a nadie. Es además lo mismo que ya hace `vite dev`, así que desarrollo y producción sirven lo mismo desde el mismo sitio. (La copia de `client/dist/assets/` se queda intacta y sin usar, por si algún día hiciera falta un hosting estático.)

**Mismo origen, cero configuración**: como la web y el WebSocket salen del mismo host, `client/src/config.ts` deriva la URL del servidor de `location.host` (`https:` → `wss:`). Ya **no hace falta `VITE_COLYSEUS_URL` en producción** (sigue existiendo como override para desarrollo, que apunta a `localhost:2567`). El fallback anterior era un dominio de Render a fuego, ya apagado — de ahí el "no se pudo conectar con el servidor" que motivó todo esto.

**Caché HTTP**: las mismas reglas que tenía `client/vercel.json` están ahora en el servidor (arte 1 día, mapas 1 hora, ambos con `stale-while-revalidate`; el bundle de Vite, que lleva hash en el nombre, `immutable` de un año; `index.html` siempre `no-cache`). Nunca `immutable` en `assets/`: un `.glb` regenerado con el mismo nombre se quedaría pegado viejo en el navegador del jugador.

**Memoria**: cada archivo se sirve con `createReadStream(...).pipe(res)`, nunca leído entero a RAM — un sector del mapa pesa MB y se piden a decenas.

## Arrancar el servidor tras encender/reiniciar el PC (`iniciarServidor.bat`, 2026-09-09)

Pedido del streamer: un "botón" que dar tras encender el PC en vez de acordarse de los comandos de PM2/cloudflared a mano — alternativa MANUAL a instalar `pm2-windows-startup` (el paquete que hace arrancar PM2 solo con Windows, sin tocar nada; ver "Setup inicial" arriba). Con `pm2-windows-startup` instalado no haría falta este `.bat`, pero no molesta tenerlo de todas formas como red de seguridad.

Doble clic en `server\deploy\iniciarServidor.bat` (o ejecutarlo desde una terminal) hace, en este orden:
1. `pm2 resurrect` — recupera el proceso exacto que había antes de apagar/reiniciar (requiere haber hecho `pm2 save` alguna vez antes, ya sea en el setup inicial o porque el propio script lo hace la primera vez que no encuentra nada).
2. Si no hay nada guardado todavía (primera vez en esta máquina, o nunca se hizo `pm2 save`): arranca desde cero con `pm2 start server/deploy/ecosystem.config.js` + `pm2 save`.
3. Comprueba si el túnel de Cloudflare está instalado como servicio de Windows (`sc query cloudflared`) — si lo está, lo arranca (`net start cloudflared`, no-op si ya estaba en marcha; puede necesitar ejecutar el `.bat` como Administrador para poder arrancar el servicio). Si NO está instalado como servicio (se arranca a mano con `cloudflared tunnel run ...` en una ventana aparte), el script solo avisa — ese caso sigue necesitando que se abra esa ventana a mano, este `.bat` no la sustituye.
4. Muestra `pm2 list` al final para confirmar que `colony-server` aparece como `online`.

**Nunca se dispara solo** — sigue siendo el streamer quien decide encenderlo, igual que `actualizar.ps1`.

## Actualizar a mano (`actualizar.ps1`)

`git pull` + `npm install` + build de **servidor y cliente** + `pm2 restart colony-server`, disparado por el streamer cuando decide que es buen momento (p.ej. sin nadie jugando). Nunca se dispara solo — sigue existiendo para cuando se quiera forzar un redeploy inmediato sin esperar al ciclo de sondeo del script automático de abajo.

```
powershell -ExecutionPolicy Bypass -File server/deploy/actualizar.ps1
```

## Auto-deploy (`autoActualizar.ps1`, 2026-09-09)

Pedido explícito del streamer ("que el pm2 se reinicie solo con cada push a main a github") — revierte a propósito la decisión anterior de mantener el redeploy 100% manual, pero conservando la misma garantía de seguridad: **nunca corta una partida en curso**.

**Cómo decide qué hacer** (tres caminos distintos desde 2026-09-09, porque ahora este proceso sirve también la web):
1. `git fetch origin main` y compara contra un marcador local (`server/deploy/.ultimoCommitDesplegado`, no versionado — es el commit que de verdad está corriendo en PM2 ahora mismo, que puede ir por detrás del HEAD local si un `pull` anterior no llegó a reiniciar).
2. Si hay commits nuevos, `git pull` siempre (barato, mantiene el working tree al día aunque no haga falta reiniciar). **Con esto solo, los cambios de `assets/` ya están en vivo** — se sirven directos del repo, sin compilar nada.
3. Si el diff **no toca `server/` ni `client/`** (rehorneado de mapa, docs, bakeadores...) → no hay nada que compilar, actualiza el marcador y termina.
4. Si toca **solo `client/`** → `npm run build -w client` y ya: el cliente se lee del disco en cada petición, así que entra **en caliente**, sin reiniciar PM2 y sin esperar a que no haya nadie jugando (quien esté dentro sigue su partida y verá la versión nueva al recargar).
5. Si toca **`server/`** → hay que reiniciar el proceso, así que primero consulta `GET http://localhost:<PORT>/estado` (endpoint sin autenticar, expone `{jugadoresConectados, uptimeSegundos}` — contador global de sesiones vivas, `server/src/mundo/contadorConexiones.ts`, incrementado/decrementado en `crearJugador`/`onLeave` de `RoomExteriorBase.ts`, el único punto de entrada/salida compartido por las 5 room types).
6. Si `jugadoresConectados > 0` → se aplaza sin tocar nada, se reintenta la próxima vez que se dispare la tarea.
7. Si está en 0 → `npm install` + build de servidor y cliente + `pm2 restart colony-server`, y actualiza el marcador al nuevo commit.

**Setup (una vez, además del setup inicial de arriba):** una sola Tarea Programada de Windows que ejecute `server\deploy\tareaProgramada.bat` cada pocos minutos (2-5 min es razonable — el coste de cada intento en vacío es solo un `git fetch` y una petición HTTP local). Ese `.bat` encadena las dos tareas de mantenimiento: comprobar GitHub (este script) y el reinicio programado (§ siguiente).

(Configurador de Tareas → Crear tarea básica → Desencadenador "Repetir cada" → Acción "Iniciar un programa": `cmd.exe` con argumentos `/c "C:\ruta\a\Colony\server\deploy\tareaProgramada.bat"`, directorio de inicio `C:\ruta\a\Colony`.)

## Reinicio programado cada 8 horas (`reinicioProgramado.ps1`, 2026-09-09)

Pedido del streamer ("reinicios cada 8 horas automáticos, aparte de si hay commit nuevo"). **No reinicia a hora fija, sino en el primer momento libre pasadas las N horas encendido** (8 por defecto, `-HorasMinimas`).

El motivo es técnico, no una preferencia: Colyseus solo guarda el estado de los jugadores al apagarse si recibe una señal (`SIGINT`/`SIGTERM` → `gracefullyShutdown` → `onLeave` → guarda posición y vitales), y **en Windows `pm2 restart` termina el proceso sin que esos handlers lleguen a correr** (Windows no tiene señales POSIX de verdad). Reiniciar con gente dentro no solo les corta la partida: puede perder su último guardado de posición/vitales. Con el servidor vacío no hay nada que guardar, así que el reinicio es inocuo.

Decide con el mismo `/estado`: si `uptimeSegundos` ya pasó de las 8 h **y** `jugadoresConectados` está a 0 → `pm2 restart`. Si hay alguien jugando, se aplaza a la siguiente pasada. En la práctica: "se reinicia cada 8 horas, o poco después, cuando no moleste a nadie".

## Cloudflare: servir el juego desde el dominio raíz

Con la web y el juego en el mismo proceso, basta un hostname público apuntando al puerto local (`2567` por defecto). El subdominio `play.colony-streamer.online` que se usaba cuando el cliente estaba en Vercel deja de ser necesario (se puede dejar, no molesta).

Desde la terminal del PC, con el túnel ya creado:

```
cloudflared tunnel route dns NOMBRE-DEL-TUNEL colony-streamer.online
```

Y en el fichero de configuración del túnel (`C:\Users\<usuario>\.cloudflared\config.yml`), la regla de ingreso apuntando al servidor local:

```yaml
ingress:
  - hostname: colony-streamer.online
    service: http://localhost:2567
  - service: http_status:404
```

Alternativa por interfaz: Cloudflare Zero Trust → Networks → Tunnels → el túnel → Public Hostname → Add, con hostname `colony-streamer.online` (subdomain vacío), tipo HTTP, URL `localhost:2567`.

Cloudflare termina el HTTPS por su lado, así que el navegador entra por `https://colony-streamer.online` y el WebSocket sale solo como `wss://colony-streamer.online` (mismo origen). No hay que configurar nada más en el cliente.

**Borrar el proyecto de Vercel y quitar la tarjeta: solo DESPUÉS de confirmar que se juega bien desde el dominio propio.** Mientras tanto no estorba tenerlo.

## Qué está verificado y qué no

Verificado de verdad en el entorno de desarrollo (2026-09-09), no afirmado: build real de servidor y cliente; servidor real levantado sirviendo `client/dist` y `assets/` en el mismo puerto; por HTTP — `/` devuelve el `index.html` real, el bundle y los `.glb` salen con su `Content-Type` y su `Cache-Control` correctos, un asset inexistente da 404 (no el health check en 200, que el cliente confundiría con éxito), un intento de `../` da 404; un archivo nuevo en `assets/` se sirve al instante y su modificación también, sin recompilar ni reiniciar; con un navegador real (Playwright) sobre un hostname que NO es localhost — para ejercitar la rama de producción de `config.ts` — la página carga, **el WebSocket sale al mismo origen** y el juego arranca con el jugador dentro del mundo. Suites: servidor 1310/1310, cliente 52/52, `tsc --noEmit` limpio en ambos.

Sin verificar (hace falta el PC real del streamer): que el dominio raíz sirva el juego a través del túnel; el rendimiento real sirviendo assets a varios jugadores a la vez por la subida de casa; la Tarea Programada de Windows y el reinicio de las 8 h en su máquina.

**Por qué el marcador es un archivo local y no simplemente "el HEAD de git":** porque el script puede hacer `git pull` sin reiniciar (paso 3 arriba) — en ese momento el HEAD local YA está por delante de lo que PM2 tiene cargado en memoria. Sin el marcador, la siguiente ejecución no podría saber si el cambio pendiente de verdad toca `server/` respecto a lo que está corriendo, solo respecto al HEAD ya actualizado (que ya no refleja el commit real desplegado).

**Qué pasa si el servidor nunca se vacía:** el reinicio se aplaza indefinidamente — el streamer sigue teniendo `actualizar.ps1` a mano para forzarlo si necesita la versión nueva ya. No hay ningún timeout que fuerce un reinicio con gente conectada: es una decisión de diseño explícita, no un límite técnico.
