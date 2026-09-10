# Actualiza servidor Y CLIENTE a la ultima version de GitHub y reinicia el
# proceso.
#
# Desde 2026-09-09 el mismo proceso Node sirve tambien el cliente web
# (client/dist/, ver server/src/estatico/servidorEstatico.ts) — ya no hay
# Vercel que compile el cliente por su cuenta, asi que este script compila
# los dos workspaces antes de reiniciar.
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

# El build del cliente copia ADEMAS toda la carpeta assets/ del repo a
# client/dist/assets/ (client/vite.config.ts::servirAssetsRaiz) — por eso hay
# que rehacerlo tambien cuando lo unico que cambia es un rehorneado de mapa.
Write-Host "== Compilando cliente ==" -ForegroundColor Cyan
npm run build -w client

# Se recrea el proceso en vez de reiniciarlo: "pm2 restart" reutiliza la
# definicion guardada, que puede apuntar a otra carpeta y que NO recoge los
# cambios de ecosystem.config.js (memoria, apagado ordenado, variables). Como
# este script lo lanzas tu a mano y a conciencia, recrear es lo correcto.
Write-Host "== Reiniciando proceso (PM2) ==" -ForegroundColor Cyan
pm2 delete colony-server
pm2 start server/deploy/ecosystem.config.js
pm2 save

Write-Host "== Listo. Ver logs en vivo con: pm2 logs colony-server ==" -ForegroundColor Green
