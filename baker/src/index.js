#!/usr/bin/env node
"use strict";

const path = require("path");
const { generarMapa, cargarJSON } = require("./generar");

async function main() {
  const rutaConfig = process.argv[2];
  if (!rutaConfig) {
    console.error("Uso: node src/index.js <config.json>");
    console.error("(o usa la interfaz gráfica: node gui/servidor.js)");
    process.exit(1);
  }

  const config = cargarJSON(path.resolve(rutaConfig));
  await generarMapa(config, { onProgreso: (msg) => console.log(msg) });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
