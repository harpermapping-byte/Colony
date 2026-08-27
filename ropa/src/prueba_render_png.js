"use strict";

// Convierte a PNG los SVG que deja ropa/src/prueba_render_voxel.js, para
// poder revisar visualmente cada prenda sin abrir un visor de SVG.
// playwright no es dependencia del proyecto (cero deps en los
// bakeadores) — usa el playwright global del entorno:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node ropa/src/prueba_render_png.js

const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const nombre of ["camisa_lino_campesina", "pantalon_lana_campesino", "gorro_lino_campesino"]) {
    const svgPath = path.join(__dirname, "..", "output", `${nombre}.svg`);
    await page.goto("file://" + svgPath);
    await page.screenshot({ path: path.join(__dirname, "..", "output", `${nombre}.png`) });
  }
  await browser.close();
})();
