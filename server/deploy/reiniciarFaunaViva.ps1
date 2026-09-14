# Borra el ESTADO VIVO PERSISTIDO de la fauna salvaje de un mapa concreto
# (fauna_salvaje/fauna_huevo/fauna_sector_resuelto) para que el servidor
# vuelva a derivarlo 1:1 del bake ACTUAL la próxima vez que alguien se
# acerque — SIN tocar cuentas, personajes, inventario, economía ni gremios.
#
# BUG REAL QUE ESTE SCRIPT CIERRA (2026-09-14, encontrado investigando "hice
# rebake con menos animales y en el spawn sigue saliendo lo mismo"):
# `server/src/mundo/faunaSalvajeViva.ts::activarSector` SOLO lee el archivo
# de bake (`cargarBakeSector`) la PRIMERISIMA vez que un sector se activa
# para un `mapaId` — confirmado leyendo el código:
#   const esPrimeraVez = persistido.ultimaResolucion === null && persistido.filas.length === 0;
#   const bake = esPrimeraVez ? this.deps.cargarBakeSector(s) : [];
# Si ese sector YA tiene filas en `fauna_salvaje` o una fila en
# `fauna_sector_resuelto` (de CUALQUIER bake anterior, aunque tuviera 3x más
# densidad), todas las reactivaciones siguientes IGNORAN el bake nuevo por
# completo — solo rellenan hasta el límite ORIGINAL ya persistido (para las
# especies de "población infinita") o siguen la reproducción normal desde
# los individuos ya guardados. Rehornear el mapa con menos fauna nunca tiene
# ningún efecto visible en una zona que un jugador ya visitó antes del
# rebake — exactamente el síntoma reportado jugando cerca del spawn, que se
# ha visitado en más sesiones de prueba que ninguna otra zona del mapa.
#
# Este script deja intacto TODO lo demás (jugadores, propiedades, Farycoins,
# gremios, construcciones...) — solo las 3 tablas de fauna salvaje del mapa
# indicado (por defecto "principal", el mapa en vivo). El árbol/bosque tiene
# EXACTAMENTE el mismo patrón (`arboles_vivos`/`arboles_sector_resuelto`,
# ver `bosquesVivos.ts`) pero NO se toca aquí — solo se ha reportado el
# síntoma con fauna, tocar bosques sin que se pida sería alcance de más.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File server/deploy/reiniciarFaunaViva.ps1 -Confirmar
# (pedirá una última confirmación escrita a mano; para saltarsela en un uso
# ya decidido, añade -SinPreguntar. Para otro mapa que no sea "principal",
# usa -MapaId <nombre>.)

param(
  [switch]$Confirmar,
  [switch]$SinPreguntar,
  [string]$MapaId = "principal"
)

$ErrorActionPreference = "Stop"

if (-not $Confirmar) {
  Write-Host "Este script borra el estado VIVO de la fauna salvaje del mapa '$MapaId' (no las cuentas ni el resto de la partida)." -ForegroundColor Yellow
  Write-Host "Vuelve a ejecutarlo con -Confirmar si de verdad quieres hacerlo." -ForegroundColor Yellow
  exit 1
}

$raizRepo = Resolve-Path (Join-Path (Join-Path $PSScriptRoot "..") "..")
$rutaEnv = Join-Path (Join-Path $raizRepo "server") ".env"

if (-not (Test-Path $rutaEnv)) {
  Write-Host "No existe server\.env — sin DATABASE_URL no hay nada que borrar." -ForegroundColor Yellow
  exit 0
}

$lineaUrl = Get-Content $rutaEnv | Where-Object { $_ -match "^\s*DATABASE_URL\s*=" } | Select-Object -First 1
if (-not $lineaUrl) {
  Write-Host "server\.env no define DATABASE_URL — nada que borrar." -ForegroundColor Yellow
  exit 0
}
$url = ($lineaUrl -replace "^\s*DATABASE_URL\s*=\s*", "").Trim().Trim('"').Trim("'")
if (-not $url) {
  Write-Host "DATABASE_URL esta vacia — nada que borrar." -ForegroundColor Yellow
  exit 0
}

# Mismo chequeo defensivo que reiniciarBd.ps1/copiaSeguridadBd.ps1:
# [uri]"texto cualquiera" no lanza en PowerShell, hay que comprobar a mano
# que es una URI absoluta con host y usuario antes de fiarse de ella.
$uri = $null
try { $uri = [uri]$url } catch { }
if (-not $uri -or -not $uri.IsAbsoluteUri -or -not $uri.Host -or -not $uri.UserInfo) {
  Write-Host "DATABASE_URL no parece una cadena de conexion valida (se espera algo como postgres://usuario:clave@localhost:5432/colony)." -ForegroundColor Red
  exit 1
}

$partesUsuario = $uri.UserInfo.Split(":")
$usuario = [uri]::UnescapeDataString($partesUsuario[0])
$password = if ($partesUsuario.Length -gt 1) { [uri]::UnescapeDataString($partesUsuario[1]) } else { "" }
$servidor = $uri.Host
$puerto = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$baseDatos = $uri.AbsolutePath.TrimStart("/")

if (-not $SinPreguntar) {
  Write-Host ""
  Write-Host "Vas a borrar la fauna salvaje viva del mapa '$MapaId' en '$baseDatos' ($servidor) -y crear una copia de seguridad antes-." -ForegroundColor Yellow
  $respuesta = Read-Host "Escribe BORRAR (en mayusculas) para continuar"
  if ($respuesta -ne "BORRAR") {
    Write-Host "Cancelado — no se ha tocado nada." -ForegroundColor Yellow
    exit 1
  }
}

# psql/pg_dump no suelen estar en el PATH tras la instalacion tipica de
# Windows: mismo patron de busqueda que ya usa copiaSeguridadBd.ps1.
function Resolver-BinarioPg([string]$nombre) {
  if (Get-Command $nombre -ErrorAction SilentlyContinue) { return $nombre }
  $candidato = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\$nombre.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($candidato) { return $candidato.FullName }
  return $null
}
$psql = Resolver-BinarioPg "psql"
if (-not $psql) {
  Write-Host "No se encuentra psql.exe — ¿esta PostgreSQL instalado? Abortando sin tocar nada." -ForegroundColor Red
  exit 1
}

# Paso 1: copia de seguridad OBLIGATORIA, forzada, antes de tocar nada —
# mismo criterio que reiniciarBd.ps1, aunque aquí solo se toquen 3 tablas:
# una copia mala no es excusa para seguir adelante sin red de seguridad.
Write-Host "== Paso 1/3: forzando una copia de seguridad fresca ==" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "copiaSeguridadBd.ps1") -Forzar
if ($LASTEXITCODE -ne 0) {
  Write-Host "FALLO la copia de seguridad — abortando, no se ha tocado la base de datos." -ForegroundColor Red
  exit 1
}

# Paso 2: parar el servidor (nadie debe activar/desactivar un sector de
# fauna mientras se borra su fila — evita una carrera real entre el borrado
# y un `activarSector`/`desactivarSector` en curso).
Write-Host "== Paso 2/3: parando el servidor (pm2 stop colony-server) ==" -ForegroundColor Cyan
& pm2 stop colony-server | Out-Null

# Paso 3: borrar SOLO las 3 tablas de fauna salvaje del mapa indicado —
# jugadores/propiedades/gremios/construcciones intactos.
Write-Host "== Paso 3/3: borrando fauna_salvaje/fauna_huevo/fauna_sector_resuelto de '$MapaId' ==" -ForegroundColor Cyan
$env:PGPASSWORD = $password
try {
  $sql = @"
DELETE FROM fauna_salvaje WHERE mapa_id = '$MapaId';
DELETE FROM fauna_huevo WHERE mapa_id = '$MapaId';
DELETE FROM fauna_sector_resuelto WHERE mapa_id = '$MapaId';
"@
  & $psql -h $servidor -p $puerto -U $usuario -d $baseDatos -c $sql
  if ($LASTEXITCODE -ne 0) { throw "el borrado devolvio codigo $LASTEXITCODE" }
} catch {
  Write-Host "FALLO borrando la fauna: $_" -ForegroundColor Red
  Write-Host "El servidor sigue parado — arrancalo a mano (pm2 start colony-server) tras revisar el error." -ForegroundColor Yellow
  exit 1
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

Write-Host "== Arrancando el servidor de nuevo (pm2 restart colony-server) ==" -ForegroundColor Cyan
& pm2 restart colony-server
Write-Host ""
Write-Host "== Fauna reiniciada. La próxima vez que alguien se acerque a un sector, se rellenará 1:1 desde el bake actual (el ya reducido). ==" -ForegroundColor Green
