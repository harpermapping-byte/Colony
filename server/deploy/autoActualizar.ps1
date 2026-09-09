# Auto-deploy: si hay commits nuevos en origin/main que tocan server/,
# espera a que el servidor esté VACÍO (GET /estado) y entonces hace
# git pull + build + pm2 restart, sin intervención manual.
#
# Pensado para lanzarse cada pocos minutos desde una Tarea Programada de
# Windows (ver docs/GDD_Despliegue_Local.md § Auto-deploy) — a diferencia
# de actualizar.ps1 (100% manual, "nunca reinicia solo" a propósito), este
# SÍ reinicia solo: pedido explícito del streamer 2026-09-09 revirtiendo esa
# decisión ("que el pm2 se reinicie solo con cada push a main"), con la
# misma condición de seguridad de siempre — nunca cortar una partida en
# curso — automatizada en vez de exigir que el streamer elija el momento a
# mano. Si hay jugadores conectados, se aplaza sin tocar nada y se
# reintenta la próxima vez que se dispare esta tarea.
#
# Uso: desde la raíz del repo (Colony/), vía Tarea Programada apuntando a:
#   powershell -ExecutionPolicy Bypass -File server/deploy/autoActualizar.ps1
#
# Requiere el mismo setup inicial que actualizar.ps1 (repo clonado, PM2
# instalado, proceso arrancado una vez con
# "pm2 start server/deploy/ecosystem.config.js").

$ErrorActionPreference = "Stop"

# Marcador LOCAL (no versionado, ver .gitignore) con el commit que estaba
# corriendo la última vez que se reinició de verdad — necesario porque el
# script puede hacer `git pull` sin reiniciar (cambio fuera de server/) y
# entonces el HEAD local ya NO coincide con "lo que está corriendo ahora".
$marcador = Join-Path $PSScriptRoot ".ultimoCommitDesplegado"
$puertoEstado = if ($env:PORT) { $env:PORT } else { "2567" }

git fetch origin main | Out-Null
$remoto = (git rev-parse origin/main).Trim()

if (-not (Test-Path $marcador)) {
  # Primera vez que corre este script en esta máquina: asume que lo que
  # está corriendo ahora mismo es el HEAD local actual.
  (git rev-parse HEAD).Trim() | Set-Content $marcador -NoNewline
}
$desplegado = (Get-Content $marcador -Raw).Trim()

if ($desplegado -eq $remoto) {
  # Nada nuevo desde el último despliegue real.
  exit 0
}

# Trae el working tree al día de todas formas (barato, sin build) — así
# `git status` en el PC nunca se queda atrás aunque el reinicio se aplace,
# y si el cambio no toca server/ ya no queda nada más que hacer.
git pull origin main | Out-Null

$tocaServer = git diff --name-only $desplegado $remoto -- server/
if (-not $tocaServer) {
  Write-Host "Push nuevo sin cambios en server/ — nada que reiniciar."
  $remoto | Set-Content $marcador -NoNewline
  exit 0
}

try {
  $estado = Invoke-RestMethod -Uri "http://localhost:$puertoEstado/estado" -TimeoutSec 5
} catch {
  Write-Host "No se pudo consultar /estado (¿el proceso está caído?) — se aplaza el reinicio."
  exit 0
}

if ($estado.jugadoresConectados -gt 0) {
  Write-Host "Hay $($estado.jugadoresConectados) jugador(es) conectado(s) — se aplaza el reinicio a la próxima vez."
  exit 0
}

Write-Host "== Servidor vacío y hay cambios en server/ ($desplegado -> $remoto) — desplegando ==" -ForegroundColor Cyan
npm install
npm run build -w server
pm2 restart colony-server

$remoto | Set-Content $marcador -NoNewline
Write-Host "== Desplegado $remoto ==" -ForegroundColor Green
