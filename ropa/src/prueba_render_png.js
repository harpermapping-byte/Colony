"use strict";

// Convierte a PNG los SVG que deja ropa/src/prueba_render_voxel.js, para
// poder revisar visualmente cada prenda sin abrir un visor de SVG.
// playwright no es dependencia del proyecto (cero deps en los
// bakeadores) — usa el playwright global del entorno:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node ropa/src/prueba_render_png.js

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const carpeta = path.join(__dirname, "..", "output");
  const svgs = fs.readdirSync(carpeta).filter((n) => n.endsWith(".svg"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const nombre of svgs) {
    await page.goto("file://" + path.join(carpeta, nombre));
    await page.screenshot({ path: path.join(carpeta, nombre.replace(/\.svg$/, ".png")) });
  }
  await browser.close();
  console.log(`${svgs.length} SVG -> PNG en ${carpeta}`);
})();
