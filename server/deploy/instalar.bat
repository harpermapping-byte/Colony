@echo off
REM ============================================================
REM   INSTALADOR DE COLONY  --  doble clic y listo
REM ============================================================
REM
REM Deja el servidor del juego montado y corriendo en este PC desde cero:
REM instala lo que falte (Git, Node, PostgreSQL, PM2, cloudflared), descarga
REM el proyecto, crea la base de datos, lo compila y lo arranca con PM2.
REM
REM Pedido del streamer 2026-09-09 ("necesito que me instales todo... o mejor,
REM hacemos un BAT que autoinicie el servidor y todas las dependencias").
REM
REM Se puede volver a ejecutar las veces que haga falta: lo que ya este hecho
REM se detecta y se salta, no se rompe ni se duplica nada.
REM
REM Ver docs/GDD_Despliegue_Local.md para la guia completa.

REM Hace falta administrador para instalar programas: si no lo somos, nos
REM relanzamos pidiendo permiso (saldra el aviso de Windows).
net session >nul 2>&1
if errorlevel 1 (
    echo Pidiendo permisos de administrador...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalarTodo.ps1" %*

echo.
pause
