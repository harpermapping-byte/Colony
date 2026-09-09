@echo off
REM Mantenimiento automatico del servidor: comprueba GitHub y, si toca,
REM reinicia. Pensado para UNA sola Tarea Programada de Windows que se
REM repita cada pocos minutos (2-5 min) — ver docs/GDD_Despliegue_Local.md.
REM
REM Hace dos cosas, en este orden:
REM   1) autoActualizar.ps1     -> si hay commits nuevos en origin/main, los
REM      baja. Cambios de client/assets entran EN CALIENTE (solo rebuild del
REM      cliente, sin cortar a nadie); cambios de server/ esperan a que no
REM      haya jugadores para reconstruir y reiniciar PM2.
REM   2) reinicioProgramado.ps1 -> reinicio de higiene cada 8 horas, tambien
REM      solo cuando el servidor esta vacio.
REM
REM Ninguno de los dos corta nunca una partida en curso: si hay gente
REM jugando, ambos se aplazan solos y lo reintentan en la siguiente pasada.
REM
REM Uso: doble clic para probarlo a mano, o como accion de la Tarea
REM Programada:
REM   Programa:   cmd.exe
REM   Argumentos: /c "C:\ruta\a\Colony\server\deploy\tareaProgramada.bat"

setlocal
REM %~dp0 = server\deploy\ -> la raiz del repo esta dos niveles arriba
cd /d "%~dp0..\.."

echo [%date% %time%] -- Comprobando GitHub --
powershell -ExecutionPolicy Bypass -File "server\deploy\autoActualizar.ps1"

echo [%date% %time%] -- Comprobando reinicio programado --
powershell -ExecutionPolicy Bypass -File "server\deploy\reinicioProgramado.ps1" -HorasMinimas 8

endlocal
