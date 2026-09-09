# Reinicio de higiene cada N horas (por defecto 8), pedido del streamer
# 2026-09-09 ("que tenga reinicios cada 8 horas automaticos").
#
# NO reinicia a hora fija, sino "en el primer momento libre pasadas las N
# horas encendido". El motivo es tecnico, no una preferencia: Colyseus solo
# guarda el estado de los jugadores al apagarse si recibe una senal
# (SIGINT/SIGTERM -> gracefullyShutdown -> onLeave -> guarda posicion y
# vitales), y en Windows `pm2 restart` termina el proceso sin que esos
# handlers lleguen a correr. Reiniciar con gente dentro no solo les corta la
# partida: puede perder su ultimo guardado de posicion/vitales. Con el
# servidor vacio no hay nada que guardar, asi que el reinicio es inocuo.
#
# Si a las 8 horas hay alguien jugando, se aplaza y se reintenta en la
# siguiente pasada de la Tarea Programada — es decir, el servidor se
# reinicia "cada 8 horas o poco despues, cuando no moleste a nadie".
#
# Uso (normalmente desde server\deploy\tareaProgramada.bat, que ademas
# comprueba GitHub — ver docs/GDD_Despliegue_Local.md):
#   powershell -ExecutionPolicy Bypass -File server/deploy/reinicioProgramado.ps1
#   powershell -ExecutionPolicy Bypass -File server/deploy/reinicioProgramado.ps1 -HorasMinimas 12

param(
  [int]$HorasMinimas = 8
)

$ErrorActionPreference = "Stop"

$puertoEstado = if ($env:PORT) { $env:PORT } else { "2567" }

try {
  $estado = Invoke-RestMethod -Uri "http://localhost:$puertoEstado/estado" -TimeoutSec 5
} catch {
  # El proceso esta caido o arrancando: PM2 ya se encarga de levantarlo
  # (autorestart), aqui no hay nada que reiniciar.
  Write-Host "No se pudo consultar /estado — nada que hacer."
  exit 0
}

$horasEncendido = [math]::Round($estado.uptimeSegundos / 3600, 2)

if ($estado.uptimeSegundos -lt ($HorasMinimas * 3600)) {
  Write-Host "Encendido desde hace $horasEncendido h (< $HorasMinimas h) — todavia no toca reiniciar."
  exit 0
}

if ($estado.jugadoresConectados -gt 0) {
  Write-Host "Tocaria reiniciar ($horasEncendido h encendido) pero hay $($estado.jugadoresConectados) jugador(es) dentro — se aplaza a la proxima pasada."
  exit 0
}

Write-Host "== Reinicio programado: $horasEncendido h encendido y 0 jugadores — reiniciando ==" -ForegroundColor Cyan
pm2 restart colony-server
Write-Host "== Reiniciado ==" -ForegroundColor Green
