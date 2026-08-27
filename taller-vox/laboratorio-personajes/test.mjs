// Prueba E2E del laboratorio con Playwright: carga la página, recorre los 3
// PJ de prueba (esqueleto de 15 huesos en todos), dobla el codo 90° (verifica
// visualmente que la articulación queda TAPADA, no hueca) y arranca el ciclo
// de andar. Capturas en ./capturas/. Ejecutar tras `node build.js`:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node test.mjs [dirCapturas]
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

// import() de ESM ignora NODE_PATH — si playwright no está instalado en
// local, se prueba con la instalación global del entorno del agente.
const { chromium } = await import("playwright").catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));

const dir = dirname(fileURLToPath(import.meta.url));
const capturas = process.argv[2] || join(dir, "capturas");
mkdirSync(capturas, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errores = [];
page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
page.on("pageerror", (e) => errores.push(String(e)));

await page.goto("file://" + join(dir, "laboratorio_personajes.html"));
await page.waitForTimeout(1500);

const botones = page.locator("#personajes button");
const n = await botones.count();
console.log("personajes en el selector:", n);
if (n !== 3) { console.error("FALLO: se esperaban 3 personajes"); process.exit(1); }

let fallo = false;
for (let i = 0; i < n; i++) {
  await botones.nth(i).click();
  await page.waitForTimeout(800);
  const status = await page.textContent("#status");
  const info = await page.textContent("#infoModelo");
  const huesos = await page.locator("#lista .item").count();
  console.log(`PJ ${i + 1}: ${status}`);
  console.log(`  ${info} · items en lista: ${huesos}`);
  if (huesos !== 15) { console.error("  FALLO: no hay 15 huesos"); fallo = true; }
  await page.screenshot({ path: join(capturas, `pj${i + 1}_reposo.png`) });

  // codo doblado 90°: si las tapas de articulación faltan, aquí se ve el
  // brazo hueco/transparente
  await page.locator('#lista .item[data-bone="lowerarmL"]').click();
  await page.locator("#rotX").fill("-90");
  await page.locator("#rotX").dispatchEvent("input");
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(capturas, `pj${i + 1}_codo90.png`) });
  await page.locator("#btnReposo").click();

  // ciclo de andar
  await page.locator("#btnAndar").click();
  await page.waitForTimeout(650);
  await page.screenshot({ path: join(capturas, `pj${i + 1}_andar.png`) });
  await page.locator("#btnAndar").click();
}

console.log("errores de consola:", errores.length ? errores : "ninguno");
await browser.close();
if (fallo || errores.length) process.exit(1);
console.log("OK — capturas en", capturas);
