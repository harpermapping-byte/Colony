# Borra POR COMPLETO la base de datos del juego y la deja vacia para que el
# servidor la reconstruya sola en el siguiente arranque.
#
# IRREVERSIBLE sin la copia de seguridad que este mismo script fuerza antes
# de tocar nada: borra TODAS las cuentas, personajes creados, inventario,
# Farycoins, gremios, propiedades y economia de CUALQUIER jugador real que
# ya hubiera jugado. Pedido explicito del streamer 2026-09-13 al rehornear
# Vetrheim de raiz con una semilla nueva ("borramos todo el mapa actual y
# reiniciamos todo con los nuevos datos") — un mundo completamente distinto
# (otras coordenadas, otras ciudades, otro spawn) no deja nada coherente que
# conservar de las posiciones/propiedades guardadas del mundo viejo.
#
# NUNCA se ejecuta solo — hace falta el flag -Confirmar a proposito, y aun
# con el, el script PARA con una pregunta interactiva salvo que tambien se
# pase -SinPreguntar (pensado para dejarlo tecleado y confirmar a mano,
# nunca para un script automatico que lo dispare por su cuenta).
#
# Que SI sobrevive al reinicio (no vive en la BD, ver CLAUDE.md/GDD_Bakeador_
# POIs.md): el propio mapa horneado (assets/mapas/principal/), el codigo del
# servidor/cliente, y assets/mapas/principal/parcelas.json (se resetea aparte
# en la promocion del bake, no aqui).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File server/deploy/reiniciarBd.ps1 -Confirmar
# (pedira una ultima confirmacion escrita a mano; para saltarsela tambien
# en un uso interactivo ya decidido, anade -SinPreguntar)
#
# Como deshacerlo si hace falta (la copia que este script fuerza justo antes
# de borrar, restaurada con pg_restore — ver copiaSeguridadBd.ps1 para el
# comando exacto y docs/GDD_Despliegue_Local.md para la guia completa).

param(
  [switch]$Confirmar,
  [switch]$SinPreguntar
)

$ErrorActionPreference = "Stop"

if (-not $Confirmar) {
  Write-Host "Este script BORRA POR COMPLETO la base de datos del juego (todas las cuentas/personajes/inventario/gremios reales)." -ForegroundColor Red
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

# Mismo chequeo defensivo que copiaSeguridadBd.ps1: [uri]"texto cualquiera"
# no lanza en PowerShell, hay que comprobar a mano que es una URI absoluta
# con host y usuario antes de fiarse de ella.
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
  Write-Host "Vas a BORRAR POR COMPLETO la base de datos '$baseDatos' en $servidor -y crear una copia de seguridad antes-." -ForegroundColor Red
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

# Paso 1: copia de seguridad OBLIGATORIA, forzada, antes de tocar nada. Si
# falla, se aborta el borrado entero — una copia fallida no es excusa para
# seguir adelante sin red de seguridad.
Write-Host "== Paso 1/4: forzando una copia de seguridad fresca ==" -ForegroundColor Cyan
# Invocado DIRECTO (no via un `powershell`/`pwsh` nuevo — no todos los PCs
# tienen ambos binarios en el PATH) para que corra en la misma sesion que ya
# esta ejecutando este script, sea Windows PowerShell 5.1 o PowerShell 7.
& (Join-Path $PSScriptRoot "copiaSeguridadBd.ps1") -Forzar
if ($LASTEXITCODE -ne 0) {
  Write-Host "FALLO la copia de seguridad — abortando el borrado, no se ha tocado la base de datos." -ForegroundColor Red
  exit 1
}

# Paso 2: parar el servidor (nadie debe escribir en la BD mientras se borra).
Write-Host "== Paso 2/4: parando el servidor (pm2 stop colony-server) ==" -ForegroundColor Cyan
& pm2 stop colony-server | Out-Null

# Paso 3: vaciar el esquema "public" DENTRO de la propia base de datos del
# juego (DROP SCHEMA CASCADE + CREATE SCHEMA), en vez de DROP+CREATE DATABASE
# — decision tomada tras un fallo real probando esto: el rol "colony" que
# crea instalarTodo.ps1 NO tiene privilegio CREATEDB (solo LOGIN), así que
# CREATE DATABASE le da "permission denied" DESPUÉS de que el DROP DATABASE
# ya hubiera borrado la base de datos entera — dejando el servidor SIN
# ninguna base de datos a la que conectarse, un estado peor que el que
# arreglaba. Vaciar el esquema en vez de la base de datos entera solo exige
# ser DUEÑO de esa base de datos (que "colony" sí es, la crea el propio
# instalador) y nunca deja un estado a medias: si algo falla a mitad, la
# base de datos en sí sigue existiendo siempre.
Write-Host "== Paso 3/4: vaciando el esquema de '$baseDatos' ==" -ForegroundColor Cyan
$env:PGPASSWORD = $password
try {
  & $psql -h $servidor -p $puerto -U $usuario -d $baseDatos -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  if ($LASTEXITCODE -ne 0) { throw "el vaciado del esquema devolvio codigo $LASTEXITCODE" }
} catch {
  Write-Host "FALLO vaciando la base de datos: $_" -ForegroundColor Red
  Write-Host "El servidor sigue parado — arrancalo a mano (pm2 start colony-server) tras revisar el error." -ForegroundColor Yellow
  exit 1
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# Paso 4: arrancar de nuevo — bd.ts crea las ~46 tablas solo contra una BD
# vacia (ya verificado en una pasada anterior, ver docs/GDD_Despliegue_Local.md),
# no hace falta ningun script de migracion aparte.
Write-Host "== Paso 4/4: arrancando el servidor de nuevo ==" -ForegroundColor Cyan
& pm2 restart colony-server
Write-Host ""
Write-Host "== Base de datos reiniciada. Revisa 'pm2 logs colony-server' y confirma que crea sus tablas sin errores. ==" -ForegroundColor Green
