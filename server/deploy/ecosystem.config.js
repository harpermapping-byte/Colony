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
      // 4G, no 1G (2026-09-09): el PC de hosting es una máquina DEDICADA con
      // 32GB, y `max_memory_restart` no es un tope de consumo sino un
      // GATILLO DE REINICIO — con 1G, un Hub legítimamente grande (mapa
      // principal + varias rooms vivas + streaming de sectores) tumbaba a
      // todos los jugadores conectados justo cuando más gente había. 4G deja
      // margen real y sigue actuando de red de seguridad ante una fuga.
      max_memory_restart: "4G",
      // Heap explícito acorde al tope de arriba: el límite por defecto de V8
      // depende de la RAM detectada y no tiene por qué coincidir con lo que
      // aquí decidimos.
      node_args: ["--max-old-space-size=6144"],
      env: {
        // Desde 2026-09-09 este MISMO proceso sirve el cliente y todos sus
        // assets estáticos (server/src/estatico/servidorEstatico.ts): cada
        // sector/.glb es un `fs.createReadStream`, y las lecturas de disco de
        // Node van por el threadpool de libuv, que por defecto son solo 4
        // hilos. Con varios jugadores materializando sectores a la vez (el
        // cliente pide un anillo entero de golpe) esos 4 hilos son el cuello
        // de botella real; 16 aprovecha una CPU dedicada de varios núcleos.
        // El WebSocket de Colyseus NO usa el threadpool (es I/O de red), así
        // que esto no le quita nada a la simulación.
        UV_THREADPOOL_SIZE: "16",
      },
      out_file: "./deploy/logs/out.log",
      error_file: "./deploy/logs/error.log",
      time: true,
    },
  ],
};
