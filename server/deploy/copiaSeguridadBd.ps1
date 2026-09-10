# Copia de seguridad de la base de datos del juego (PostgreSQL local).
#
# Pedido del streamer 2026-09-09 al decidir que la BD viva en su propio PC en
# vez de en Neon: sin nube de por medio, las copias pasan a ser
# responsabilidad nuestra — si ese disco muere sin copias, se pierden TODOS
# los personajes, casas, gremios y economia del servidor.
#
# Se lanza desde la MISMA Tarea Programada que el resto del mantenimiento
# (server\deploy\tareaProgramada.bat, cada pocos minutos) y se autolimita:
# si la ultima copia tiene menos de -HorasEntreCopias horas, sale sin hacer
# nada. Asi no hace falta una segunda tarea de Windows solo para esto.
#
# Formato "custom" (-Fc) a proposito, no un .sql plano: pesa bastante menos,
# y pg_restore puede recuperar SOLO una tabla concreta de dentro (p.ej. si un
# dia hay que devolver solo los inventarios sin pisar el resto del mundo).
#
# Uso normal (automatico, via tareaProgramada.bat):
#   powershell -ExecutionPolicy Bypass -File server/deploy/copiaSeguridadBd.ps1
# Forzar una copia ya, sin esperar a que toque:
#   powershell -ExecutionPolicy Bypass -File server/deploy/copiaSeguridadBd.ps1 -Forzar
#
# COMO RESTAURAR (leelo ANTES de necesitarlo — una copia que no sabes
# restaurar no es una copia):
#   1) Para el servidor:            pm2 stop colony-server
#   2) Restaura la copia entera:
#        pg_restore -h localhost -U colony -d colony --clean --if-exists "ruta\a\colony_FECHA.dump"
#      (o solo una tabla:  pg_restore ... --data-only --table=jugadores "ruta\...dump")
#   3) Arranca de nuevo:            pm2 start colony-server
#   Te pedira la contrasena del usuario colony: es la que hay en server\.env,
#   dentro de DATABASE_URL.
#
# Ver docs/GDD_Despliegue_Local.md para la guia completa.

param(
  [int]$HorasEntreCopias = 24,
  [int]$CopiasAGuardar = 14,
  [switch]$Forzar
)

$ErrorActionPreference = "Stop"

# Join-Path por segmentos (no "server\.env" en una sola cadena) para que las
# rutas se construyan con el separador del sistema: asi este script se puede
# ejecutar y probar tambien fuera de Windows, que es donde se desarrolla.
$raizRepo = Resolve-Path (Join-Path (Join-Path $PSScriptRoot "..") "..")
$carpetaCopias = Join-Path $PSScriptRoot "copias"
$rutaEnv = Join-Path (Join-Path $raizRepo "server") ".env"

if (-not (Test-Path $rutaEnv)) {
  Write-Host "No existe server\.env — sin DATABASE_URL no hay nada que copiar."
  exit 0
}

# La URL de conexion es la MISMA que usa el servidor: una sola fuente de
# verdad, sin duplicar credenciales en este script.
$lineaUrl = Get-Content $rutaEnv | Where-Object { $_ -match "^\s*DATABASE_URL\s*=" } | Select-Object -First 1
if (-not $lineaUrl) {
  Write-Host "server\.env no define DATABASE_URL — nada que copiar."
  exit 0
}
$url = ($lineaUrl -replace "^\s*DATABASE_URL\s*=\s*", "").Trim().Trim('"').Trim("'")
if (-not $url) {
  Write-Host "DATABASE_URL esta vacia — nada que copiar."
  exit 0
}

# OJO: [uri]"texto cualquiera" NO lanza excepcion en PowerShell (lo toma por
# una URI relativa y deja Host/UserInfo a null), asi que hay que comprobar a
# mano que es absoluta y trae usuario y servidor. Sin esto, una DATABASE_URL
# mal escrita reventaba mas abajo con un error ilegible de PowerShell en vez
# de avisar en cristiano.
$uri = $null
try { $uri = [uri]$url } catch { }
if (-not $uri -or -not $uri.IsAbsoluteUri -or -not $uri.Host -or -not $uri.UserInfo) {
  Write-Host "DATABASE_URL no parece una cadena de conexion valida (se espera algo como postgres://usuario:clave@localhost:5432/colony) — se omite la copia."
  exit 0
}

# Una BD remota (Neon u otra) tambien se puede copiar, pero el aviso importa:
# este script existe porque la BD es local y nadie mas la respalda.
$partesUsuario = $uri.UserInfo.Split(":")
$usuario = [uri]::UnescapeDataString($partesUsuario[0])
$password = if ($partesUsuario.Length -gt 1) { [uri]::UnescapeDataString($partesUsuario[1]) } else { "" }
$servidor = $uri.Host
$puerto = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$baseDatos = $uri.AbsolutePath.TrimStart("/")

New-Item -ItemType Directory -Force -Path $carpetaCopias | Out-Null

# ¿Toca copia? (autolimitacion: esta tarea se dispara cada pocos minutos)
$ultima = Get-ChildItem -Path $carpetaCopias -Filter "colony_*.dump" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Forzar -and $ultima) {
  $horas = ((Get-Date) - $ultima.LastWriteTime).TotalHours
  if ($horas -lt $HorasEntreCopias) {
    Write-Host ("Ultima copia hace {0:N1} h (< {1} h) — todavia no toca." -f $horas, $HorasEntreCopias)
    exit 0
  }
}

# pg_dump no suele estar en el PATH tras la instalacion tipica de Windows:
# se busca en la ruta estandar del instalador de PostgreSQL.
$pgDump = "pg_dump"
if (-not (Get-Command $pgDump -ErrorAction SilentlyContinue)) {
  $candidato = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $candidato) {
    Write-Host "No se encuentra pg_dump.exe — ¿esta PostgreSQL instalado? Se omite la copia."
    exit 0
  }
  $pgDump = $candidato.FullName
}

# Con segundos: dos copias forzadas en el mismo minuto no se pisan entre si.
$marcaTiempo = Get-Date -Format "yyyy-MM-dd_HHmmss"
$destino = Join-Path $carpetaCopias "colony_$marcaTiempo.dump"

Write-Host "== Copia de seguridad de '$baseDatos' -> $destino ==" -ForegroundColor Cyan
$env:PGPASSWORD = $password
try {
  & $pgDump -h $servidor -p $puerto -U $usuario -d $baseDatos -Fc -f $destino
  if ($LASTEXITCODE -ne 0) { throw "pg_dump devolvio codigo $LASTEXITCODE" }
} catch {
  Write-Host "FALLO la copia: $_" -ForegroundColor Red
  # Un archivo a medias es peor que ninguno: confundiria al restaurar.
  if (Test-Path $destino) { Remove-Item $destino -Force }
  exit 1
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

$tamano = [math]::Round((Get-Item $destino).Length / 1MB, 2)
Write-Host "== Copia hecha ($tamano MB) ==" -ForegroundColor Green

# Rotacion: nos quedamos con las N mas recientes.
$sobrantes = Get-ChildItem -Path $carpetaCopias -Filter "colony_*.dump" |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip $CopiasAGuardar
foreach ($vieja in $sobrantes) {
  Remove-Item $vieja.FullName -Force
  Write-Host "Copia antigua borrada: $($vieja.Name)"
}
