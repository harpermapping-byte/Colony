// Config de PM2 para correr el servidor 24/7 en el PC de hosting (Windows u
// otro OS). PM2 reinicia el proceso solo si crashea y, con
// "pm2-windows-startup"/"pm2 startup", vuelve a arrancar solo tras reiniciar
// el PC. Las variables de entorno (DATABASE_URL, etc.) las coge de
// server/.env vía dotenv (ver src/index.ts) — no hace falta duplicarlas aquí.
//
// Uso (desde server/):
//   pm2 start deploy/ecosystem.config.js
//   pm2 save
//   pm2 startup   (Linux/Mac) — en Windows usar el paquete pm2-windows-startup
//
// Ver docs/GDD_Despliegue_Local.md para la guía completa.
module.exports = {
  apps: [
    {
      name: "colony-server",
      script: "dist/index.js",
      cwd: __dirname + "/..",
      instances: 1,
      autorestart: true,
      // Colyseus guarda estado de partida en memoria de proceso — nunca
      // usar modo "cluster" (rompería las rooms al repartirse entre
      // procesos). Un único fork es lo correcto aquí.
      exec_mode: "fork",
      max_memory_restart: "1G",
      out_file: "./deploy/logs/out.log",
      error_file: "./deploy/logs/error.log",
      time: true,
    },
  ],
};
