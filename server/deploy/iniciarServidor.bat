@echo off
REM Arranca el servidor de Colony en este PC tras encenderlo/reiniciarlo:
REM recupera el proceso de PM2 (o lo arranca desde cero si es la primera
REM vez) y comprueba/arranca el tunel de Cloudflare si esta instalado como
REM servicio de Windows.
REM
REM Alternativa MANUAL a "pm2-windows-startup" (el paquete que hace que PM2
REM arranque solo con Windows, sin tocar nada) — pedido explicito del
REM streamer 2026-09-09: en vez de instalar eso, un boton (este .bat) que
REM da doble clic tras encender el PC y deja todo corriendo. Nunca se
REM dispara solo — hay que ejecutarlo a mano cada vez que se reinicia el PC,
REM a menos que ademas se instale pm2-windows-startup (entonces este bat ya
REM no haria falta, pero no molesta tenerlo).
REM
REM Uso: doble clic, o desde una terminal:
REM   server\deploy\iniciarServidor.bat
REM
REM Ver docs/GDD_Despliegue_Local.md para la guia completa del hosting local.

setlocal
REM %~dp0 = carpeta de este .bat (server\deploy\) -> la raiz del repo es dos niveles arriba
cd /d "%~dp0..\.."

echo ================================
echo   Iniciando Colony server
echo ================================
echo.

echo -- Recuperando el proceso de PM2 (o arrancandolo si es la primera vez) --
call pm2 resurrect >nul 2>&1

call pm2 list | findstr /C:"colony-server" >nul
if errorlevel 1 (
    echo No habia nada guardado en PM2 todavia — arrancando desde cero...
    call pm2 start server\deploy\ecosystem.config.js
    call pm2 save
) else (
    echo Proceso recuperado desde el ultimo "pm2 save".
)

echo.
echo -- Comprobando el tunel de Cloudflare --
sc query cloudflared >nul 2>&1
if errorlevel 1 (
    echo El tunel NO esta instalado como servicio de Windows en este PC.
    echo Si lo arrancas a mano, abre otra ventana y usa tu comando habitual
    echo ^(p.ej. "cloudflared tunnel run NOMBRE-DE-TU-TUNEL"^) — dejalo
    echo abierto mientras quieras que el servidor sea accesible desde fuera.
) else (
    net start cloudflared >nul 2>&1
    if errorlevel 1 (
        echo Servicio "cloudflared" ya estaba en marcha ^(o hace falta
        echo ejecutar este .bat como Administrador para poder arrancarlo^).
    ) else (
        echo Servicio "cloudflared" arrancado.
    )
)

echo.
echo -- Estado actual de PM2 --
call pm2 list

echo.
echo Listo. "colony-server" deberia aparecer como "online" arriba.
echo Para ver los logs en vivo: pm2 logs colony-server
echo.
pause
