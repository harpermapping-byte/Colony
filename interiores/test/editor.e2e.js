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

    // ---- Puertas y ventanas como instancia editable (2026-09-04) ----
    // Edificio NUEVO aparte (no el de arriba, cuya sala ya quedó con
    // origen:"modificado" a nivel de SALA por "cambiar tipo de sala" — eso
    // bloquearía regenerarMobiliario entero salvo forzar:true, que no es
    // lo que este bloque quiere probar): así el candado de puerta/ventana
    // se prueba con la granularidad fina real (mueble/ventana/puerta
    // conservados uno a uno, el resto de la sala sí se rehace).
    let carpetaCapturas;
    // Devuelve {nivel, indiceSala, resultado} de la ÚNICA sala del edificio
    // con puerta.origen==="modificado" en cada punto de este bloque — no
    // depende de qué tenga seleccionado el navegador (nivelSel/indiceSalaSel
    // del cliente), así que sigue siendo válido incluso justo después de
    // un reload() que resetea esa selección.
    async function salaConPuertaModificada() {
      const estado = await (await fetch(URL_BASE + "api/edificio")).json();
      for (const p of estado.edificio.plantas) {
        for (let i = 0; i < p.salas.length; i++) {
          if (p.salas[i].resultado.puerta.origen === "modificado") return { nivel: p.nivel, indiceSala: i, resultado: p.salas[i].resultado };
        }
      }
      return null;
    }
    async function estadoSalaSeleccionada() {
      const s = await salaConPuertaModificada();
      return s && s.resultado;
    }
    // Clica en el árbol la fila (nivel,indiceSala) exacta — usa los
    // data-nivel/data-indice-sala que renderArbol ya expone (aditivo, solo
    // para que este test pueda apuntar sin depender del texto visible ni
    // de qué tipo de sala le tocó a esta semilla).
    async function seleccionarEnArbol(nivel, indiceSala) {
      await page.click(`aside.arbol .sala[data-nivel="${nivel}"][data-indice-sala="${indiceSala}"]`);
      await page.waitForTimeout(200);
    }

    await test("generar un segundo edificio para probar puerta/ventana, seleccionando su sala más grande", async () => {
      const fs = require("fs");
      carpetaCapturas = fs.mkdtempSync(require("path").join(require("os").tmpdir(), "editor-e2e-capturas-"));
      await page.selectOption("#selTipoEdificio", "castillo");
      await page.fill("#inSemilla", "e2e-suite-puertas-ventanas");
      await page.click("#btnGenerar");
      await page.waitForTimeout(500);

      // Misma heurística "sala más grande" que el test de añadir mueble de
      // más arriba — no busca "gran_salon" por nombre porque esa sala en
      // concreto no siempre le toca al edificio con esta semilla (depende
      // del sorteo de salasPorPlanta, ver edificio.js:elegirNumeroSalas).
      const filas = await page.$$("aside.arbol .sala");
      let mejorIdx = 0, mejorArea = 0;
      for (let i = 0; i < filas.length; i++) {
        const t = await filas[i].textContent();
        const m = t.match(/(\d+)x(\d+)/);
        if (m) { const area = +m[1] * +m[2]; if (area > mejorArea) { mejorArea = area; mejorIdx = i; } }
      }
      await filas[mejorIdx].click();
      await page.waitForTimeout(250);
      const panel = await page.textContent("#panelPuerta");
      assert(panel.includes("sur") || panel.includes("norte") || panel.includes("este") || panel.includes("oeste"), `el panel de puerta debería mostrar un lado real, dice: "${panel}"`);
    });

    await test("mover la puerta a otro punto del perímetro real", async () => {
      await page.click("#btnMoverPuerta");
      await page.waitForTimeout(150);
      const hotspots = page.locator('main.lienzo svg circle[fill="#6aa0d8"]');
      const n = await hotspots.count();
      assert(n > 1, `esperaba varios hotspots de perímetro para poder elegir uno distinto al actual, hay ${n}`);
      await hotspots.last().click({ force: true });
      await page.waitForTimeout(300);

      const salaModificada = await estadoSalaSeleccionada();
      assert(salaModificada, "no se encontró ninguna sala con puerta.origen==='modificado' tras moverPuerta");
      // La casilla real de la puerta (su lado + umbral interior) tiene que
      // seguir cayendo en suelo real de la máscara (o del rectángulo si no
      // hay máscara) — no "dentro de un muro ni fuera de la forma".
      const { puerta, ancho, largo, mascara } = salaModificada;
      const umbral =
        puerta.lado === "norte" ? { x: puerta.x, y: 0 }
        : puerta.lado === "este" ? { x: ancho - 1, y: puerta.y }
        : puerta.lado === "oeste" ? { x: 0, y: puerta.y }
        : { x: puerta.x, y: largo - 1 };
      const esSueloReal = !mascara || mascara[umbral.y * ancho + umbral.x] === "1";
      assert(esSueloReal, `el umbral de la puerta movida (${umbral.x},${umbral.y}) cae fuera del suelo real de la máscara`);
      await page.screenshot({ path: require("path").join(carpetaCapturas, "01-puerta-movida.png") });
    });

    await test("añadir una ventana nueva en el perímetro real", async () => {
      const antes = (await estadoSalaSeleccionada()).ventanas.length;
      await page.click("#btnAnadirVentana");
      await page.waitForTimeout(150);
      const hotspots = page.locator('main.lienzo svg circle[fill="#6aa0d8"]');
      // El primer hotspot puede coincidir con el umbral de la puerta recién
      // movida (aviso forzable "coincide_con_la_puerta") — probar varios
      // hasta dar con uno libre, mismo espíritu robusto que el test de
      // añadir mueble de más arriba.
      const n = await hotspots.count();
      let colocada = false;
      for (let i = n - 1; i >= 0 && !colocada; i--) {
        const armado = await page.$("#btnAnadirVentana.armado");
        if (!armado) await page.click("#btnAnadirVentana"); // se pudo desarmar solo si un intento anterior sí coló
        await page.waitForTimeout(80);
        await hotspots.nth(i).click({ force: true });
        await page.waitForTimeout(250);
        const sala = await estadoSalaSeleccionada();
        colocada = sala.ventanas.length > antes;
      }
      assert(colocada, "no se consiguió colocar ninguna ventana nueva en el perímetro real");

      const sala = await estadoSalaSeleccionada();
      const nueva = sala.ventanas.find((v) => v.origen === "modificado");
      assert(nueva, "la ventana añadida debería tener origen 'modificado'");
      const celdas = [];
      for (let i = 0; i < nueva.ancho; i++) celdas.push(nueva.lado === "norte" || nueva.lado === "sur" ? { x: nueva.x + i, y: nueva.y } : { x: nueva.x, y: nueva.y + i });
      for (const c of celdas) {
        const esSueloReal = !sala.mascara || sala.mascara[c.y * sala.ancho + c.x] === "1";
        assert(esSueloReal, `la ventana añadida cubre una celda (${c.x},${c.y}) fuera del suelo real`);
      }
      await page.screenshot({ path: require("path").join(carpetaCapturas, "02-ventana-anadida.png") });
    });

    await test("mover la ventana ya colocada a otro tramo", async () => {
      const salaAntes = await estadoSalaSeleccionada();
      const ventanaAntes = salaAntes.ventanas.find((v) => v.origen === "modificado");
      await page.click(`[data-mover="${ventanaAntes.instanceId}"]`);
      await page.waitForTimeout(150);
      const hotspots = page.locator('main.lienzo svg circle[fill="#6aa0d8"]');
      const n = await hotspots.count();
      let movida = false;
      for (let i = 0; i < n && !movida; i++) {
        const armado = await page.$("[data-mover].armado, .paleta button.armado"); // el botón de mover ventana no lleva clase 'armado' (no está en la paleta) — solo comprobamos si sigue habiendo modo activo vía intento repetido
        await hotspots.nth(i).click({ force: true });
        await page.waitForTimeout(250);
        const sala = await estadoSalaSeleccionada();
        const v = sala.ventanas.find((it) => it.instanceId === ventanaAntes.instanceId);
        movida = v && (v.x !== ventanaAntes.x || v.y !== ventanaAntes.y || v.lado !== ventanaAntes.lado);
        if (!movida) await page.click(`[data-mover="${ventanaAntes.instanceId}"]`); // reintenta si el hotspot chocó (borde_ya_ocupado/coincide_con_la_puerta)
      }
      assert(movida, "la ventana no cambió de posición tras moverVentana");
    });

    await test("eliminar la ventana la quita de la lista", async () => {
      const sala = await estadoSalaSeleccionada();
      const v = sala.ventanas.find((it) => it.origen === "modificado");
      await page.click(`[data-eliminar="${v.instanceId}"]`);
      await page.waitForTimeout(250);
      const salaDespues = await estadoSalaSeleccionada();
      assert(!salaDespues.ventanas.some((it) => it.instanceId === v.instanceId), "la ventana debería haber desaparecido tras eliminarVentana");
    });

    await test("volver a añadir puerta+ventana, guardar y recargar conserva ambas", async () => {
      // Deja una ventana modificada de verdad para el resto del bloque
      // (el test anterior la borró para probar eliminarVentana).
      await page.click("#btnAnadirVentana");
      await page.waitForTimeout(150);
      const hotspots = page.locator('main.lienzo svg circle[fill="#6aa0d8"]');
      const n = await hotspots.count();
      for (let i = n - 1; i >= 0; i--) {
        const armado = await page.$("#btnAnadirVentana.armado");
        if (!armado) break;
        await hotspots.nth(i).click({ force: true });
        await page.waitForTimeout(200);
      }

      const antesGuardar = await estadoSalaSeleccionada();
      const puertaAntes = JSON.stringify(antesGuardar.puerta);
      const ventanaModificadaAntes = antesGuardar.ventanas.find((v) => v.origen === "modificado");
      assert(ventanaModificadaAntes, "debería quedar una ventana modificada antes de guardar");

      await page.click("#btnGuardar");
      await page.waitForTimeout(300);

      // Recarga la página entera (estado del cliente en blanco de verdad,
      // no solo re-render) y carga el guardado desde el desplegable —
      // mismo flujo real que usaría el streamer.
      await page.reload();
      await page.waitForTimeout(400);
      // Selecciona por contenido del NOMBRE de archivo (no "el último de
      // la lista": output/ es compartido entre ejecuciones de esta suite y
      // con lo que deje cualquier otra sesión, así que el orden alfabético
      // no es de fiar) — el id del edificio (tipoEdificioId_semilla) es la
      // semilla real que se generó arriba.
      const valorGuardado = await page.locator("#selGuardados option", { hasText: "e2e-suite-puertas-ventanas" }).getAttribute("value");
      assert(valorGuardado, "no apareció el guardado de este test en el desplegable #selGuardados");
      await page.selectOption("#selGuardados", valorGuardado);
      await page.click("#btnCargar");
      await page.waitForTimeout(400);

      const trasCargar = await estadoSalaSeleccionada();
      assert(trasCargar, "tras cargar debería seguir habiendo una sala con puerta.origen==='modificado'");
      assert(JSON.stringify(trasCargar.puerta) === puertaAntes, `la puerta no sobrevivió guardar→cargar (antes: ${puertaAntes}, después: ${JSON.stringify(trasCargar.puerta)})`);
      const ventanaTrasCargar = trasCargar.ventanas.find((v) => v.instanceId === ventanaModificadaAntes.instanceId);
      assert(ventanaTrasCargar, "la ventana modificada no sobrevivió guardar→cargar");

      // Re-selecciona en el árbol la MISMA sala (recargar la página
      // resetea la selección del cliente a nivel[0]/sala 0, casi nunca la
      // que tiene la puerta/ventana editadas) para que el test siguiente,
      // que sí depende de qué sala tiene seleccionada el navegador
      // (regenerar mobiliario opera sobre nivelSel/indiceSalaSel), actúe
      // sobre la sala correcta — sin esto, "regenerar" tocaría una sala
      // sin nada modificado y el test de abajo pasaría por razones
      // equivocadas (comprobado: falló hasta añadir este seleccionarEnArbol).
      const objetivo = await salaConPuertaModificada();
      assert(objetivo, "no se encontró la sala con la puerta modificada para reseleccionarla");
      await seleccionarEnArbol(objetivo.nivel, objetivo.indiceSala);
    });

    await test("regenerar mobiliario sin forzar conserva la puerta y ventana movidas", async () => {
      const antes = await estadoSalaSeleccionada();
      const puertaAntes = JSON.stringify(antes.puerta);
      const ventanaAntes = antes.ventanas.find((v) => v.origen === "modificado");
      const nMueblesAntes = antes.colocados.length;

      const chk = await page.$("#chkForzar");
      assert(!(await chk.isChecked()), "el checkbox 'forzar' debería empezar desmarcado para esta prueba");
      await page.click("#btnRegenMobiliario");
      await page.waitForTimeout(400);

      const despues = await estadoSalaSeleccionada();
      assert(despues, "la sala con puerta modificada debería seguir existiendo tras regenerar mobiliario");
      assert(JSON.stringify(despues.puerta) === puertaAntes, "regenerar mobiliario (sin forzar) movió la puerta modificada a mano");
      const ventanaDespues = despues.ventanas.find((v) => v.instanceId === ventanaAntes.instanceId);
      assert(ventanaDespues, "regenerar mobiliario (sin forzar) descartó la ventana modificada a mano");
      // El resto del mobiliario SÍ se rehace (mismo criterio ya probado
      // para muebles con origen "generado") — no es el mismo array exacto
      // de antes, aunque el conteo pueda coincidir por azar.
      assert(despues.colocados.length >= 1, `la sala debería seguir teniendo mobiliario generado tras regenerar (tiene ${despues.colocados.length})`);
      void nMueblesAntes; // documentado arriba: no se compara 1:1, solo se deja constancia de que existía

      await page.screenshot({ path: require("path").join(carpetaCapturas, "03-tras-regenerar.png") });
      console.log(`     capturas guardadas en ${carpetaCapturas}`);
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
