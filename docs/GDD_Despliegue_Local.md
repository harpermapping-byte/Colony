# GDD — Despliegue local (PC del streamer, 24/7)

Guía real del hosting propio: **todo** (juego y web) corre 24/7 en un PC dedicado del streamer (Windows, 32GB, solo para esto), con PM2 gestionando el proceso, Postgres/Neon como base de datos, dominio propio (`colony-streamer.online`) y Cloudflare Tunnel para exponerlo sin abrir puertos (el streamer está detrás de CG-NAT de Digi, con IP variable). Contexto completo de la decisión en `CLAUDE.md` § "Hosting 24/7 alternativo".

Desde **2026-09-09 ya no hay Vercel**: el cliente web dejó de estar hospedado aparte y lo sirve el MISMO proceso Node que corre Colyseus (§ "Un solo proceso" más abajo). Render lleva suspendido desde antes y tampoco se usa.

## Por qué CG-NAT e IP variable dan igual

Cloudflare Tunnel no necesita ni un puerto abierto ni una IP fija: `cloudflared` abre la conexión **desde** el PC **hacia** el borde de Cloudflare y la mantiene, y el DNS del dominio apunta a Cloudflare, nunca a la IP de casa. Por eso el CG-NAT de Digi (que impide recibir conexiones entrantes) y que la IP cambie sola no afectan a nada: si la IP cambia, el túnel se vuelve a conectar solo y los jugadores no se enteran. Tampoco hace falta DDNS.

Lo que sí importa de la conexión es la **subida** (todo el mapa y los .glb salen del PC), no la bajada.

## Instalación: `instalar.bat` (un solo clic, 2026-09-09)

Pedido del streamer al montar el PC nuevo ("necesito que me instales todo... o mejor, hacemos un BAT que autoinicie el servidor y todas las dependencias"). `server/deploy/instalar.bat` se autoeleva a administrador y lanza `instalarTodo.ps1`, que deja el servidor montado **desde cero**:

0. Comprueba `winget` (y lo repara vía `Microsoft.WinGet.Client` si falta; si el Windows es anterior a la build 17763 avisa y para).
1. Instala lo que falte: **Git** (`Git.Git`, con `--scope machine` para que lo vean también las tareas programadas), **Node.js** (`OpenJS.NodeJS.LTS`), **cloudflared** (`Cloudflare.cloudflared` forzando `--installer-type wix`: el MSI se registra en el PATH del sistema y permite `cloudflared service install`, el portable no).
2. Instala **PostgreSQL 17** de forma desatendida con una contraseña de superusuario **generada por nosotros** (`--custom "--serverport 5432 --superpassword …"`): si se deja la que pone el instalador por defecto, luego no hay forma de crear la base del juego. Esa contraseña nunca se imprime ni se guarda. Detecta además el **puerto real** del cluster (si 5432 estaba ocupado, el instalador de EDB elige otro y el `.env` apuntaría mal).
3. Clona el repo (o hace `pull` si ya estaba) en `%USERPROFILE%\Desktop\Colony` por defecto (parámetro `-Carpeta`).
4. Crea el rol `colony` y la base `colony`, y escribe `DATABASE_URL` en `server/.env` **conservando el resto del archivo**. Si la base ya existía, la respeta con todo lo que tenga dentro.
5. `npm install` + build de servidor y cliente.
6. Instala PM2 si falta, arranca (o reinicia) `colony-server`, `pm2 save`, y **comprueba de verdad** que responde en `http://localhost:2567/estado`.
7. Crea dos Tareas Programadas: `Colony-Mantenimiento` (cada 5 min → `tareaProgramada.bat`) y `Colony-Arranque` (al iniciar sesión → `iniciarServidor.bat`).

**Principio de diseño, no negociable si algún día se toca**: el script nunca da un paso por bueno por el código de salida del instalador — verifica el **binario real** después de cada instalación (`node -v`, existencia de `psql.exe`, el servicio `postgresql*`, respuesta HTTP del servidor). Los códigos de winget que en realidad significan "ya estaba instalado" (`PACKAGE_ALREADY_INSTALLED`, `UPDATE_NOT_APPLICABLE`, `INSTALL_REBOOT_REQUIRED_TO_FINISH`) se tratan como éxito: abortar ahí dejaría al streamer bloqueado sin motivo. Y lo que no se pueda dejar hecho no revienta el script: se acumula y sale al final como lista de "esto lo tienes que hacer tú".

Es **idempotente**: se puede relanzar las veces que haga falta. Lo ya hecho se detecta y se salta, y nunca se pisa una base de datos existente.

**Lo único que NO puede automatizar** es el túnel de Cloudflare, porque exige iniciar sesión en la cuenta desde el navegador. El script termina imprimiendo los comandos exactos (§ "Cloudflare" más abajo).

## Setup manual (alternativa al instalador)

1. Clonar el repo, `npm install` en la raíz (instala los workspaces).
2. `server/.env` con `DATABASE_URL` y el resto de variables — ver `server/.env.example`.
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

## Base de datos: PostgreSQL en el propio PC (2026-09-09)

Decisión del streamer al montar el PC dedicado ("usemos PostgreSQL en mi PC entonces"), sustituyendo a Neon. Motivos: sin topes de horas de cómputo del plan gratis, sin coste, y latencia de menos de 1 ms en vez de ~40 ms contra Londres. **Contrapartida asumida: las copias de seguridad pasan a ser responsabilidad nuestra** — de ahí `copiaSeguridadBd.ps1` (§ siguiente), que no es opcional.

**Cero cambios de código**: `bd.ts` usa Postgres en cuanto `DATABASE_URL` esté definida, y no fuerza SSL, así que una cadena local (`postgres://colony:CONTRASEÑA@localhost:5432/colony`) conecta tal cual. **El esquema se crea solo**: las migraciones son idempotentes (94 `CREATE TABLE IF NOT EXISTS`) y corren en cada arranque, así que basta con crear una base de datos VACÍA y un usuario — el servidor levanta sus ~46 tablas la primera vez.

Lo que hay que hacer una vez (lo automatiza el instalador, § "Instalación"):
1. Instalar PostgreSQL.
2. Crear el rol y la base del juego:
   ```sql
   CREATE ROLE colony WITH LOGIN PASSWORD 'la-que-elijas';
   CREATE DATABASE colony OWNER colony;
   ```
3. Poner `DATABASE_URL=postgres://colony:la-que-elijas@localhost:5432/colony` en `server/.env`.

**Nunca usar el modo SQLite para producción**: existe como fallback cuando `DATABASE_URL` está vacía, pero `node:sqlite` es SÍNCRONO y bloquea el hilo único de Node varios segundos bajo ráfagas de ~25 reconexiones simultáneas (medido, ver `server/src/datos/bd.ts` y el mega-estrés de `CLAUDE.md`) — justo el escenario de un chat entrando en tromba al directo.

**Verificado de verdad en el entorno de desarrollo** (2026-09-09, con un PostgreSQL 16 real, no razonado sobre el papel): base vacía → el servidor arranca y crea las 46 tablas solo; un jugador real entra por navegador y aparece su fila en `jugadores` con vida, vitales, farycoins y posición; se le cambia el saldo a 777 y la posición, **se reinicia el servidor**, vuelve a entrar con el mismo nombre y conserva `id`, saldo y posición exactos (no se duplica la fila); `pg_dump -Fc` produce una copia de 326 KB, se borran los jugadores a propósito y `pg_restore` los devuelve intactos.

## Copias de seguridad de la base de datos (`copiaSeguridadBd.ps1`, 2026-09-09)

Con la BD en el PC ya no hay una nube que respalde nada: si ese disco muere sin copias, se pierden todos los personajes, casas, gremios y la economía del servidor.

El script se lanza desde la MISMA Tarea Programada que el resto del mantenimiento y **se autolimita**: si la última copia tiene menos de 24 h, sale sin hacer nada (así no hace falta una segunda tarea de Windows). Lee la conexión de `server/.env` — una sola fuente de verdad, sin duplicar credenciales —, vuelca con `pg_dump -Fc` a `server/deploy/copias/colony_FECHA.dump`, borra un archivo a medias si falla (una copia corrupta es peor que ninguna) y conserva las 14 más recientes.

Formato "custom" (`-Fc`) a propósito y no `.sql` plano: pesa mucho menos y `pg_restore` puede sacar **una sola tabla** de dentro (por ejemplo devolver los inventarios sin pisar el resto del mundo).

**Cómo restaurar** (documentado aquí porque una copia que no sabes restaurar no es una copia; los comandos están probados de verdad contra este esquema):
```
pm2 stop colony-server
pg_restore -h localhost -U colony -d colony --clean --if-exists "server\deploy\copias\colony_FECHA.dump"
pm2 start colony-server
```
Para una sola tabla: `pg_restore ... --data-only --table=jugadores "…dump"`. La contraseña que pide es la del usuario `colony`, la que está en `DATABASE_URL` dentro de `server/.env`.

**Recomendación pendiente del streamer**: copiar de vez en cuando la carpeta `server/deploy/copias/` a otro sitio (otro disco, un pendrive, la nube). Una copia en el mismo disco que la base de datos protege de un borrado accidental, pero no de que ese disco falle.

## Reinicio programado cada 8 horas (`reinicioProgramado.ps1`, 2026-09-09)

Pedido del streamer ("reinicios cada 8 horas automáticos, aparte de si hay commit nuevo"). **No reinicia a hora fija, sino en el primer momento libre pasadas las N horas encendido** (8 por defecto, `-HorasMinimas`).

El motivo es técnico, no una preferencia: reiniciar con gente dentro les corta la partida. Y hasta el arreglo de la sección siguiente, además **perdía su último guardado**.

Decide con el mismo `/estado`: si `uptimeSegundos` ya pasó de las 8 h **y** `jugadoresConectados` está a 0 → `pm2 restart`. Si hay alguien jugando, se aplaza a la siguiente pasada. En la práctica: "se reinicia cada 8 horas, o poco después, cuando no moleste a nadie".

## Apagado ordenado en Windows: bug real de producción, cerrado (2026-09-09)

**Este era un bug vivo en el servidor del streamer, no una precaución teórica.** Colyseus registra su `gracefullyShutdown` (→ dispone las salas → `onLeave` de cada jugador → guarda posición y vitales) sobre `SIGINT`/`SIGTERM`/`SIGUSR2`. Pero **Windows no tiene señales POSIX de verdad**: `pm2 restart` termina el proceso sin que ningún handler llegue a correr (PM2 usa `SIGINT` por defecto, y en Windows eso equivale a una terminación incondicional). Resultado: cada reinicio con alguien conectado perdía su último guardado, **sin un solo error en los logs** — el proceso simplemente desaparecía.

Arreglo, y son **dos mitades obligatorias que van siempre juntas**:
- `server/deploy/ecosystem.config.js`: `shutdown_with_message: true` + `kill_timeout: 15000`. Con eso PM2 avisa por IPC (mensaje `"shutdown"`) en vez de matar a bocajarro.
- `server/src/index.ts`: un `process.on("message")` que llama a `gameServer.gracefullyShutdown()`. Colyseus **no** trae este handler.

Poner la opción de PM2 **sin** el handler sería peor que no tocar nada: PM2 mandaría un mensaje que nadie escucha y esperaría los 15 s enteros de `kill_timeout` antes de matar igual.

**Verificado con las dos mitades del experimento** (servidor real contra el Postgres local, cliente `colyseus.js` real que entra y se mueve):
- Mandando `"shutdown"` por IPC (exactamente lo que hace PM2): el servidor registra el apagado ordenado, cierra en 34 ms con código 0, y la posición del jugador queda en la base de datos (`pos_x = 1503.649`).
- Matando el proceso con `SIGKILL` (lo que hacía PM2 hasta ahora): cierra en 15 ms, no registra nada, y las columnas `pos_x`/`pos_y` de ese jugador se quedan **vacías**.

El reinicio programado sigue exigiendo servidor vacío de todas formas: con esto el reinicio ya no pierde datos, pero seguir cortando partidas en marcha sería igual de molesto.

## Cloudflare: servir el juego desde el dominio raíz

Con la web y el juego en el mismo proceso, basta un hostname público apuntando al puerto local (`2567` por defecto). El subdominio `play.colony-streamer.online` que se usaba cuando el cliente estaba en Vercel deja de ser necesario (se puede dejar, no molesta).

**Camino recomendado: túnel gestionado desde el dashboard ("remotely-managed"), un solo comando.** Es mucho más simple que el de `config.yml` y evita una trampa real (ver abajo):

1. Entrar en https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel → Cloudflared**, nombre `colony`, guardar.
2. La página muestra un comando de instalación con un **token** largo. En el PC, como administrador:
   ```
   cloudflared service install <TOKEN>
   ```
3. En la pestaña **Public Hostname** del mismo túnel → *Add*: Subdomain **vacío**, Domain `colony-streamer.online`, Type **HTTP**, URL `localhost:2567`.
4. Comprobar: `Get-Service Cloudflared` debe salir *Running*.

**La trampa que ahorra este camino** (confirmada leyendo el código de `cloudflared`, `cmd/cloudflared/windows_service.go`): `cloudflared service install` **sin** token crea el servicio de Windows **sin ningún argumento** en su `ImagePath`. El servicio arranca y aparece como *Running*, pero el túnel nunca se levanta — y no hay ningún error evidente. Con el camino de `config.yml` habría que además copiar `cert.pem` y el `<UUID>.json` a la carpeta del perfil de SYSTEM (`C:\Windows\System32\config\systemprofile\.cloudflared\`) y corregir a mano ese `ImagePath` en el registro. Para un PC de streamer, no compensa.

Si en algún momento se usa la vía de línea de comandos en vez del dashboard, el **dominio raíz (apex) sí está soportado**, pero el registro DNS necesita `--overwrite-dns` si ya existe:
```
cloudflared tunnel route dns --overwrite-dns colony colony-streamer.online
```

Cloudflare termina el HTTPS por su lado, así que el navegador entra por `https://colony-streamer.online` y el WebSocket sale solo como `wss://colony-streamer.online` (mismo origen). **WebSockets funcionan sin configuración adicional.** No hay que configurar nada más en el cliente.

**Cambiar de PC no obliga a copiar ficheros**: lo más limpio es crear un túnel nuevo en el dashboard para el PC nuevo y borrar el viejo desde ahí mismo. (Existe `cloudflared tunnel token --cred-file …` para regenerar las credenciales de un túnel ya existente sin ir a buscar el JSON al ordenador antiguo, pero para un no técnico el túnel nuevo es menos propenso a errores.)

**Borrar el proyecto de Vercel y quitar la tarjeta: solo DESPUÉS de confirmar que se juega bien desde el dominio propio.** Mientras tanto no estorba tenerlo.

## Qué está verificado y qué no

Verificado de verdad en el entorno de desarrollo (2026-09-09), no afirmado: build real de servidor y cliente; servidor real levantado sirviendo `client/dist` y `assets/` en el mismo puerto; por HTTP — `/` devuelve el `index.html` real, el bundle y los `.glb` salen con su `Content-Type` y su `Cache-Control` correctos, un asset inexistente da 404 (no el health check en 200, que el cliente confundiría con éxito), un intento de `../` da 404; un archivo nuevo en `assets/` se sirve al instante y su modificación también, sin recompilar ni reiniciar; con un navegador real (Playwright) sobre un hostname que NO es localhost — para ejercitar la rama de producción de `config.ts` — la página carga, **el WebSocket sale al mismo origen** y el juego arranca con el jugador dentro del mundo. Suites: servidor 1310/1310, cliente 52/52, `tsc --noEmit` limpio en ambos.

Sin verificar (hace falta el PC real del streamer): que el dominio raíz sirva el juego a través del túnel; el rendimiento real sirviendo assets a varios jugadores a la vez por la subida de casa; la Tarea Programada de Windows y el reinicio de las 8 h en su máquina.

**Por qué el marcador es un archivo local y no simplemente "el HEAD de git":** porque el script puede hacer `git pull` sin reiniciar (paso 3 arriba) — en ese momento el HEAD local YA está por delante de lo que PM2 tiene cargado en memoria. Sin el marcador, la siguiente ejecución no podría saber si el cambio pendiente de verdad toca `server/` respecto a lo que está corriendo, solo respecto al HEAD ya actualizado (que ya no refleja el commit real desplegado).

**Qué pasa si el servidor nunca se vacía:** el reinicio se aplaza indefinidamente — el streamer sigue teniendo `actualizar.ps1` a mano para forzarlo si necesita la versión nueva ya. No hay ningún timeout que fuerce un reinicio con gente conectada: es una decisión de diseño explícita, no un límite técnico.
