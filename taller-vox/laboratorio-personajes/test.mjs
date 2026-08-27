import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errores = [];
page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
page.on("pageerror", (e) => errores.push(String(e)));

await page.goto("file:///tmp/claude-0/-home-user-Colony/9483b06d-8f9e-55c9-a785-9c00dfbb142e/scratchpad/lab-pj/laboratorio_personajes.html");
await page.waitForTimeout(1500);
console.log("status:", await page.textContent("#status"));
console.log("info:", await page.textContent("#infoModelo"));
console.log("items en lista:", await page.locator("#lista .item").count());
await page.screenshot({ path: "lab-pj/cap1_reposo.png" });

// seleccionar el codo y doblarlo 90 grados
await page.locator('#lista .item[data-bone="lowerarmL"]').click();
console.log("ficha:", await page.textContent("#fichaNombre"), "/", await page.textContent("#fichaMeta"));
await page.locator("#rotX").fill("-90");
await page.locator("#rotX").dispatchEvent("input");
await page.waitForTimeout(400);
await page.screenshot({ path: "lab-pj/cap2_codo90.png" });

// ciclo de andar
await page.locator("#btnAndar").click();
await page.waitForTimeout(700);
await page.screenshot({ path: "lab-pj/cap3_andar.png" });
console.log("boton andar:", await page.textContent("#btnAndar"));

console.log("errores de consola:", errores.length ? errores : "ninguno");
await browser.close();
