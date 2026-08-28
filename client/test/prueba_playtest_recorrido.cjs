"use strict";
// Recorrido de prueba pedido por el streamer: andar por el mapa exterior,
// entrar/salir de varios POIs de distinto tipo (edificio, mazmorra cueva,
// mazmorra edificio, aldea normal, aldea hostil), viendo cómo queda
// decorado por dentro y si algo falla al entrar/salir. NO es parte de la
// suite automática (usa un bake de prueba en assets/mapas/playtest, no el
// mapa principal). Ejecutar:
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/prueba_playtest_recorrido.cjs
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const RAIZ = path.resolve(__dirname, "..", "..");
const MAPA_RAIZ = "playtest";
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const CARPETA_CAPTURAS = path.join(__dirname, "capturas_playtest");
fs.mkdirSync(CARPETA_CAPTURAS, { recursive: true });

function cargarIndice(mapaId) {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, "assets", "mapas", mapaId, "indice.json"), "utf8"));
}

async function esperarPuerto(url, intentos = 60) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return;
    } catch {}
    await esperar(500);
  }
  throw new Error(`No responde ${url}`);
}

let contador = 0;
async function foto(page, nombre) {
  contador++;
  const archivo = `${String(contador).padStart(2, "0")}_${nombre}.png`;
  await page.screenshot({ path: path.join(CARPETA_CAPTURAS, archivo) });
  console.log(`  [foto] ${archivo}`);
}

// Mantiene una dirección pulsada un rato (simula andar) — VEL_ANDAR=3.75
// casillas/seg (server/src/rooms/base/RoomExteriorBase.ts).
async function andar(page, dir, segundos) {
  const teclas = { arriba: "w", abajo: "s", izquierda: "a", derecha: "d" };
  const k = teclas[dir];
  await page.keyboard.down(k);
  await esperar(segundos * 1000);
  await page.keyboard.up(k);
  await esperar(200);
}

async function usarPortal(page) {
  await page.keyboard.press("f");
  await esperar(1800); // navegación a otra room + carga de sector
}

async function main() {
  const procesos = [];
  const errores = [];
  const lanzar = (comando, args, cwd, env) => {
    const p = spawn(comando, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env }, detached: true });
    p.stdout.on("data", (d) => process.stdout.write(`[${comando}] ${d}`));
    p.stderr.on("data", (d) => process.stderr.write(`[${comando}] ${d}`));
    procesos.push(p);
    return p;
  };
  const matarTodo = () => {
    for (const p of procesos) {
      try { process.kill(-p.pid, "SIGKILL"); } catch {}
      try { p.kill("SIGKILL"); } catch {}
    }
  };

  try {
    lanzar("npx", ["tsx", "src/index.ts"], path.join(RAIZ, "server"), {});
    lanzar("npx", ["vite", "--port", "5199", "--strictPort"], path.join(RAIZ, "client"), { VITE_RUTA_MAPA: `/assets/mapas/${MAPA_RAIZ}` });
    await esperarPuerto("http://localhost:5199/");
    await esperarPuerto("http://localhost:2567/");
    await esperar(1000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => { console.log("[error página]", String(err)); errores.push(String(err)); });
    page.on("console", (msg) => { if (msg.type() === "error") { console.log("[console error]", msg.text()); errores.push(msg.text()); } });

    const indicePrincipal = cargarIndice(MAPA_RAIZ);

    // --- 1) Recorrido por el mapa general: entra/sale de varios POI de
    // distinto tipo, uno de cada categoría relevante. -------------------
    const paradas = [
      { nombre: "ruina", portal: indicePrincipal.portales.find((p) => p.tipoEdificioId === "ruina") },
      { nombre: "choza_curandero", portal: indicePrincipal.portales.find((p) => p.tipoEdificioId === "choza_curandero") },
      { nombre: "barco_encallado", portal: indicePrincipal.portales.find((p) => p.tipoEdificioId === "barco_encallado") },
      { nombre: "cueva_goblins (mazmorra-cueva)", portal: indicePrincipal.portales.find((p) => p.tipoEdificioId === "cueva_goblins") },
      { nombre: "torre_nigromante (mazmorra-edificio)", portal: indicePrincipal.portales.find((p) => p.tipoEdificioId === "torre_nigromante") },
      { nombre: "casa_humilde", portal: indicePrincipal.portales.find((p) => p.tipoEdificioId === "casa_humilde") },
    ];

    for (const parada of paradas) {
      if (!parada.portal) { console.log(`\n[AVISO] no hay portal para "${parada.nombre}" en este bake, se omite`); continue; }
      const p = parada.portal;
      console.log(`\n--- ${parada.nombre} en (${p.x},${p.y}) ---`);

      // Aparece unas casillas al sur del portal y anda hacia él.
      const sala = p.esMazmorra ? "mazmorra" : "interior";
      await page.goto(`http://localhost:5199/?sala=region&mapaId=${MAPA_RAIZ}&entradaX=${p.x}&entradaY=${p.y + 7}&nombre=Explorador`);
      await esperar(2500);
      await foto(page, `${parada.nombre}_exterior_llegada`);

      await andar(page, "arriba", 2.2);
      await usarPortal(page);
      const urlInterior = page.url();
      const dentroInterior = urlInterior.includes(`sala=${sala}`);
      console.log(`  entrada -> ${dentroInterior ? "OK" : "FALLO"} (url: ${urlInterior})`);
      if (!dentroInterior) errores.push(`${parada.nombre}: no se entró al portal (sigue en ${urlInterior})`);
      await foto(page, `${parada.nombre}_interior_llegada`);

      // Pasea un poco por dentro para ver cómo está amueblado/iluminado.
      await andar(page, "abajo", 0.6);
      await andar(page, "derecha", 1.2);
      await foto(page, `${parada.nombre}_interior_paseo`);
      await andar(page, "izquierda", 1.2);
      await andar(page, "arriba", 0.6);

      // Vuelve a la entrada y sale.
      await usarPortal(page);
      const urlExterior = page.url();
      const fueraOtraVez = urlExterior.includes("sala=region");
      console.log(`  salida -> ${fueraOtraVez ? "OK" : "FALLO"} (url: ${urlExterior})`);
      if (!fueraOtraVez) errores.push(`${parada.nombre}: no se volvió a la región al salir (${urlExterior})`);
      await foto(page, `${parada.nombre}_exterior_salida`);
    }

    // --- 2) Aldea hostil (dungeon tipo asentamiento) ---------------------
    const poiHostil = indicePrincipal.portales.find((p) => p.tipo === "exterior" && p.destino?.mapaId?.includes("cultistas"));
    if (poiHostil) {
      console.log(`\n--- aldea hostil (mazmorra-asentamiento) en (${poiHostil.x},${poiHostil.y}) ---`);
      await page.goto(`http://localhost:5199/?sala=region&mapaId=${MAPA_RAIZ}&entradaX=${poiHostil.x}&entradaY=${poiHostil.y + 6}&nombre=Explorador`);
      await esperar(2500);
      await foto(page, "aldea_hostil_exterior_llegada");
      await andar(page, "arriba", 1.8);
      await usarPortal(page);
      console.log(`  entrada -> url: ${page.url()}`);
      await foto(page, "aldea_hostil_dentro_muralla");

      const idxHostil = cargarIndice(poiHostil.destino.mapaId);
      const casaHostil = idxHostil.portales.find((p) => p.tipo === "interior");
      if (casaHostil) {
        await page.goto(`http://localhost:5199/?sala=region&mapaId=${poiHostil.destino.mapaId}&entradaX=${casaHostil.x}&entradaY=${casaHostil.y + 5}&nombre=Explorador`);
        await esperar(2000);
        await andar(page, "arriba", 1.5);
        await usarPortal(page);
        console.log(`  casa "${casaHostil.tipoEdificioId}" -> url: ${page.url()}`);
        await foto(page, `aldea_hostil_interior_${casaHostil.tipoEdificioId}`);
        await usarPortal(page);
        await foto(page, "aldea_hostil_salida_casa");
      }
    } else {
      console.log("\n[AVISO] no hay aldea hostil (asentamiento_cultistas/poblado_orco/etc) en este bake");
    }

    // --- 3) Aldea principal (asentamiento normal) + un par de interiores -
    const poiAldea = indicePrincipal.portales.find((p) => p.tipo === "exterior" && p.destino?.mapaId?.includes("aldea_agricola"));
    if (poiAldea) {
      console.log(`\n--- aldea principal en (${poiAldea.x},${poiAldea.y}) ---`);
      await page.goto(`http://localhost:5199/?sala=region&mapaId=${MAPA_RAIZ}&entradaX=${poiAldea.x}&entradaY=${poiAldea.y + 6}&nombre=Explorador`);
      await esperar(2500);
      await foto(page, "aldea_principal_exterior_llegada");
      await andar(page, "arriba", 1.8);
      await usarPortal(page);
      console.log(`  entrada -> url: ${page.url()}`);
      await esperar(500);
      await foto(page, "aldea_principal_dentro_muralla");

      const idxAldea = cargarIndice(poiAldea.destino.mapaId);
      const casas = idxAldea.portales.filter((p) => p.tipo === "interior").slice(0, 2);
      for (const casa of casas) {
        await page.goto(`http://localhost:5199/?sala=region&mapaId=${poiAldea.destino.mapaId}&entradaX=${casa.x}&entradaY=${casa.y + 5}&nombre=Explorador`);
        await esperar(2000);
        await foto(page, `aldea_principal_llegada_${casa.tipoEdificioId}`);
        await andar(page, "arriba", 1.5);
        await usarPortal(page);
        console.log(`  casa "${casa.tipoEdificioId}" -> url: ${page.url()}`);
        await foto(page, `aldea_principal_interior_${casa.tipoEdificioId}`);
        await andar(page, "abajo", 0.5);
        await foto(page, `aldea_principal_interior_${casa.tipoEdificioId}_paseo`);
        await usarPortal(page);
        console.log(`  salida "${casa.tipoEdificioId}" -> url: ${page.url()}`);
      }
    } else {
      console.log("\n[AVISO] no hay aldea principal (aldea_agricola) en este bake");
    }

    console.log(`\n=== RESUMEN ===`);
    console.log(`Capturas en ${CARPETA_CAPTURAS}`);
    console.log(`Errores de consola/página detectados: ${errores.length}`);
    for (const e of errores) console.log(`  - ${e}`);

    await browser.close();
  } finally {
    matarTodo();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
