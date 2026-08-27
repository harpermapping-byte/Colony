"use strict";

// SVG -> PNG de la galería de personajes (playwright global del entorno):
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node personajes/src/prueba_render_png.js

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  const carpeta = path.join(__dirname, "..", "output");
  const svgs = fs.readdirSync(carpeta).filter((n) => n.endsWith(".svg"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 500 } });
  for (const nombre of svgs) {
    await page.goto("file://" + path.join(carpeta, nombre));
    await page.screenshot({ path: path.join(carpeta, nombre.replace(/\.svg$/, ".png")) });
  }
  await browser.close();
  console.log(`${svgs.length} SVG -> PNG en ${carpeta}`);
})();
