#!/usr/bin/env node
"use strict";

// Test de integración del editor web — arranca interiores/gui/servidor.js
// de verdad, lo conduce con Playwright (generar edificio, filtrar el
// catálogo, colocar/rotar/eliminar una pieza, cambiar tipo de sala,
// regenerar respetando lo modificado) y apaga el servidor al terminar.
// Requiere Playwright con Chromium ya instalado — si no está disponible
// en este entorno, el test avisa y termina en 0 en vez de romper el resto
// de la suite (mismo espíritu que catalogo.test.js: no depender de nada
// que no sea estrictamente necesario, y aquí Playwright SÍ lo es para
// probar el editor real, pero no para el resto del bakeador).

const path = require("path");
const { spawn } = require("child_process");

const PUERTO = process.env.PUERTO_TEST_EDITOR || 4199;
const URL_BASE = `http://localhost:${PUERTO}/`;

let playwright;
try {
  playwright = require("playwright");
} catch (e) {
  console.log("Playwright no está instalado en este entorno — se omite editor.e2e.js (no es un fallo).");
  process.exit(0);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function esperarServidor(url, intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url + "api/tiposEdificio");
      if (r.ok) return true;
    } catch (e) {
      // todavía no está arriba
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("el servidor del editor no respondió a tiempo");
}

async function main() {
  const servidorProc = spawn(process.execPath, [path.join(__dirname, "..", "gui", "servidor.js")], {
    env: { ...process.env, PUERTO_INTERIORES: String(PUERTO) },
    stdio: "ignore",
  });

  let pasados = 0, fallados = 0;
  const fallos = [];
  async function test(nombre, fn) {
    try {
      await fn();
      pasados++;
      console.log(`  ok  ${nombre}`);
    } catch (e) {
      fallados++;
      fallos.push({ nombre, error: e });
      console.log(`FALLO  ${nombre}`);
      console.log(`       ${e.message}`);
    }
  }

  let browser;
  try {
    await esperarServidor(URL_BASE);
    browser = await playwright.chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("dialog", (d) => d.accept());

    await test("la página carga sin errores de JS", async () => {
      const errores = [];
      page.on("pageerror", (e) => errores.push(e.message));
      await page.goto(URL_BASE);
      await page.waitForTimeout(400);
      assert(errores.length === 0, `errores: ${errores.join("; ")}`);
    });

    await test("generar un edificio puebla el árbol edificio/planta/sala", async () => {
      // castillo trae un gran_salon grande (hasta 14x19) — necesario más
      // abajo para tener sitio de sobra donde colocar algo sin que todo
      // el suelo esté ya ocupado por lo generado.
      await page.selectOption("#selTipoEdificio", "castillo");
      await page.fill("#inSemilla", "e2e-suite-1");
      await page.click("#btnGenerar");
      await page.waitForTimeout(500);
      const salas = await page.$$("aside.arbol .sala");
      assert(salas.length > 0, "el árbol debería listar salas tras generar");
    });

    await test("el catálogo de contenido carga en la paleta (más allá de la lista plana anterior)", async () => {
      const nItems = await page.$$eval(".paleta button", (els) => els.length);
      assert(nItems > 50, `esperaba >50 piezas en la paleta, hay ${nItems}`);
    });

    await test("filtrar por categoría reduce la lista", async () => {
      const antes = await page.$$eval(".paleta button", (els) => els.length);
      await page.selectOption("#selCategoriaCatalogo", "iluminacion");
      await page.waitForTimeout(150);
      const despues = await page.$$eval(".paleta button", (els) => els.length);
      assert(despues < antes, `filtrar por categoría debería reducir la lista (${antes} -> ${despues})`);
      await page.selectOption("#selCategoriaCatalogo", "");
    });

    await test("buscar por texto encuentra piezas por nombre", async () => {
      await page.fill("#inBuscarCatalogo", "silla");
      await page.waitForTimeout(150);
      const nombres = await page.$$eval(".paleta button .fila-item", (els) => els.map((e) => e.textContent.trim()));
      assert(nombres.some((n) => n.toLowerCase().includes("silla")), "la búsqueda 'silla' no encontró la silla");
      await page.fill("#inBuscarCatalogo", "");
    });

    await test("seleccionar la sala más grande y añadir un mueble desde la paleta", async () => {
      const salas = await page.$$("aside.arbol .sala");
      let mejorIdx = 0, mejorArea = 0;
      for (let i = 0; i < salas.length; i++) {
        const t = await salas[i].textContent();
        const m = t.match(/(\d+)x(\d+)/);
        if (t.includes("gran_salon")) { mejorIdx = i; mejorArea = Infinity; continue; }
        if (m && mejorArea !== Infinity) {
          const area = +m[1] * +m[2];
          if (area > mejorArea) { mejorArea = area; mejorIdx = i; }
        }
      }
      await salas[mejorIdx].click();
      await page.waitForTimeout(250);

      // El check real de éxito es contra el estado del servidor (busca un
      // taburete con origen "modificado"), no el panel de la UI. Las
      // casillas "transparentes" de debajo del mobiliario ya colocado
      // reciben el clic del mueble que tienen encima (hit-testing normal
      // del navegador, `force:true` no lo evita) — probar varias
      // casillas hasta dar con una libre es lo robusto, no una condición
      // de fallo.
      async function hayTaburetePropio() {
        const estado = await (await fetch(URL_BASE + "api/edificio")).json();
        for (const p of estado.edificio.plantas) for (const s of p.salas) for (const it of s.resultado.colocados) if (it.id === "taburete" && it.origen === "modificado") return true;
        return false;
      }

      const locator = page.locator('main.lienzo svg polygon[fill="transparent"]');
      const n = await locator.count();
      let encontrado = false;
      for (let intento = 0; intento < Math.min(n, 30) && !encontrado; intento++) {
        const armado = await page.$(".paleta button.armado");
        if (!armado) await page.click('.paleta button:has-text("Taburete")');
        await page.waitForTimeout(80);
        await locator.nth(intento).click({ force: true });
        await page.waitForTimeout(400);
        encontrado = await hayTaburetePropio();
      }
      assert(encontrado, "no se encontró ningún 'taburete' con origen modificado en el edificio tras colocarlo");
    });

    await test("rotar la pieza seleccionada cambia su rotación", async () => {
      const antes = await page.textContent("#panelMueble");
      const rotAntes = antes.match(/Rotación(\d+)/)[1];
      await page.click("#btnRotar", { force: true });
      await page.waitForTimeout(200);
      const despues = await page.textContent("#panelMueble");
      const rotDespues = despues.match(/Rotación(\d+)/)[1];
      assert(rotAntes !== rotDespues, `la rotación no cambió (${rotAntes} -> ${rotDespues})`);
    });

    await test("marcar estado 'roto' se refleja en el panel", async () => {
      await page.click("#btnRoto", { force: true });
      await page.waitForTimeout(200);
      const panel = await page.textContent("#panelMueble");
      assert(panel.includes("roto"), "el panel no muestra el estado 'roto'");
    });

    await test("eliminar la pieza limpia la selección", async () => {
      await page.click("#btnEliminar", { force: true });
      await page.waitForTimeout(200);
      const panel = await page.textContent("#panelMueble");
      assert(panel.includes("Haz clic en un mueble"), "debería quedar sin selección tras eliminar");
    });

    await test("cambiar tipo de sala y regenerar mobiliario respeta la edición", async () => {
      await page.selectOption("#selCambiarTipoSala", "almacen");
      await page.click("#btnCambiarTipoSala");
      await page.waitForTimeout(200);
      const estadoTxt = await page.textContent("#btnRegenMobiliario");
      await page.click("#btnRegenMobiliario");
      await page.waitForTimeout(200);
      const estado = await page.textContent("#estadoTxt");
      assert(estado.includes("modificada") || estado.includes("sala_modificada"), `regenerar mobiliario sobre una sala editada a mano debería negarse sin forzar (dice: "${estado}")`);
    });

    await test("guardar escribe un archivo en output/", async () => {
      await page.click("#btnGuardar");
      await page.waitForTimeout(250);
      const estado = await page.textContent("#estadoTxt");
      assert(estado.includes("guardado en"), `esperaba confirmación de guardado, dice: "${estado}"`);
    });
  } finally {
    if (browser) await browser.close();
    servidorProc.kill();
  }

  console.log(`\n${pasados} ok, ${fallados} fallo(s) de ${pasados + fallados} tests (editor.e2e.js).`);
  if (fallados > 0) {
    for (const f of fallos) console.log(`  - ${f.nombre}: ${f.error.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("error inesperado en editor.e2e.js:", e);
  process.exitCode = 1;
});
