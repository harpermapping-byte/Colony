# Actualiza el servidor a la ultima version de GitHub y lo reinicia.
#
# NUNCA se dispara solo -- lo ejecutas tu a mano en tu PC (PowerShell) cuando
# decidas que es buen momento para poner en marcha la ultima version subida
# al repo (p.ej. sin jugadores conectados). Un push a GitHub NO reinicia el
# servidor por si solo, a proposito: no queremos cortar una partida en curso
# sin aviso.
#
# Uso: desde la raiz del repo (Colony/):
#   powershell -ExecutionPolicy Bypass -File server/deploy/actualizar.ps1
#
# Requiere que el setup inicial ya este hecho: repo clonado, PM2 instalado
# y el proceso arrancado una vez con "pm2 start server/deploy/ecosystem.config.js".
# Ver docs/GDD_Despliegue_Local.md para el resto de la guia.

$ErrorActionPreference = "Stop"

Write-Host "== Actualizando Colony server ==" -ForegroundColor Cyan
git fetch origin
git pull origin main

Write-Host "== Instalando dependencias (raiz + workspaces) ==" -ForegroundColor Cyan
npm install

Write-Host "== Compilando servidor ==" -ForegroundColor Cyan
npm run build -w server

Write-Host "== Reiniciando proceso (PM2) ==" -ForegroundColor Cyan
pm2 restart colony-server

Write-Host "== Listo. Ver logs en vivo con: pm2 logs colony-server ==" -ForegroundColor Green
