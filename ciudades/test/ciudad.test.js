"use strict";
// Tests del bakeador ORGÁNICO de ciudades — node --test ciudades/test/ciudad.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { generarCiudad, validarCiudad, cargarAsentamientos } = require("../src/generar");
const { hornearCiudad, TAMANO_CHUNK } = require("../src/index");
const { rasterizarRectRotado } = require("../src/geometria");
const { cargarCatalogos } = require("../../interiores/src/catalogo");

const catalogos = cargarCatalogos();
const asentamientos = cargarAsentamientos();
const tiers = Object.keys(asentamientos).filter((k) => !k.startsWith("_"));

// Nº de semillas por tier para el barrido de validez de más abajo: el bug
// real de conectividad diagonal (docs/GDD_Bakeador_POIs.md §6) SOLO se
// reprodujo empíricamente en los tiers de radio pequeño y pocas puertas
// (aldea_pequena/aldea/pueblo/castillo/asentamiento_hostil — un único
// camino principal, sin red de rutas redundante) — capital/capital_jarl/
// gran_capital, con más puertas y una malla mucho más densa, no dieron
// NINGÚN fallo en un barrido de 40 semillas antes del fix. Se pide más
// muestra donde de verdad hacía falta (34, "deja de depender de la
// suerte") y se sube una cantidad razonable en el resto (10, x5 sobre las
// 2 de antes) — 34 semillas en los 3 tiers grandes habría costado varios
// minutos solo en este test (generarCiudad ahí es O(edificios²) en la capa
// de decoración, ya documentado en la auditoría de rendimiento de
// 2026-09-02) sin cubrir un caso que nunca se vio fallar.
const SEMILLAS_POR_TIER = {
  aldea_pequena: 34, aldea: 34, pueblo: 34, castillo: 34, asentamiento_hostil: 34,
  capital: 10, capital_jarl: 10, gran_capital: 10,
};
const semillasDeTier = (tier) =>
  Array.from({ length: SEMILLAS_POR_TIER[tier] ?? 10 }, (_, i) => `barrido-${i + 1}`);

// Mismo chequeo que el fixer estructural de generar.js (repararCosturaDiagonal):
// un camino/adoquín/puente sin NINGÚN vecino ORTOGONAL de calle pero con un
// vecino DIAGONAL que sí lo es es un muro real para el movimiento en vivo
// (server/src/mundo/colisiones.ts::moverAABB mueve X e Y por separado) —
// generarCiudad debe entregar SIEMPRE un mapa sin ninguna de estas costuras
// que el fixer PUDIERA haber cerrado, nunca solo "validarCiudad no se
// queja" (validarCiudad usa el mismo criterio 4-direccional para la
// conectividad puerta-por-puerta, pero esto lo comprueba en TODA casilla de
// calle del mapa, no solo en las puertas). Devuelve, por cada costura, las
// direcciones diagonales que la causan (para que el llamador pueda decidir
// si era reparable de verdad, ver `esCosturaEvitable` más abajo).
const ES_CALLE_SEAM = new Set(["camino", "adoquin", "puente"]);
function encontrarCosturasDiagonales(ciudad) {
  const { terreno, ancho, alto } = ciudad;
  const costuras = [];
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (!ES_CALLE_SEAM.has(terreno.get(x, y))) continue;
      const tieneOrtoCalle = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const t = terreno.get(x + dx, y + dy);
        return t !== null && ES_CALLE_SEAM.has(t);
      });
      if (tieneOrtoCalle) continue;
      const diagonalesCalle = [[1, 1], [1, -1], [-1, 1], [-1, -1]].filter(([dx, dy]) => {
        const t = terreno.get(x + dx, y + dy);
        return t !== null && ES_CALLE_SEAM.has(t);
      });
      if (diagonalesCalle.length > 0) costuras.push({ x, y, diagonales: diagonalesCalle });
    }
  }
  return costuras;
}

// Una costura es EVITABLE (el fixer debería haberla cerrado) si, para
// ALGUNA de sus direcciones diagonales, AL MENOS uno de los dos codos
// ortogonales es convertible de verdad (no muro/solar_edificio real, no
// árbol/decoración colisionable — mismo criterio EXACTO que usa
// repararCosturaDiagonal en generar.js). Si TODAS sus direcciones tienen
// los DOS codos bloqueados por geometría sólida real, no hay ninguna
// casilla que convertir sin corromper un solar/muro de verdad — un
// residual estructural aceptado (visto de verdad en `capital_jarl`, casco
// apretado con colchón mínimo bajo por diseño: una calle puede quedar
// encajonada entre dos solares reales sin que sobre ni una casilla).
function esCosturaEvitable(ciudad, costura, catDeco) {
  const { terreno } = ciudad;
  const idMuro = terreno.datos.includes("empalizada") ? "empalizada" : "muralla_piedra";
  const bloqueado = (cx, cy) => {
    const t = terreno.get(cx, cy);
    if (t === null || t === idMuro || t === "solar_edificio") return true;
    if ((ciudad.arboles || []).some((a) => a.x === cx && a.y === cy && a.colisiona !== false)) return true;
    return (ciudad.deco || []).some((d) => d.x === cx && d.y === cy && catDeco[d.i]?.colision);
  };
  return costura.diagonales.some(([dx, dy]) => !bloqueado(costura.x + dx, costura.y) || !bloqueado(costura.x, costura.y + dy));
}

test("todos los tiers generan ciudades VÁLIDAS (estancas, conectadas, sin solapes) con muchas semillas", () => {
  for (const tier of tiers) {
    for (const semilla of semillasDeTier(tier)) {
      const ciudad = generarCiudad({ tier, semilla, catalogos });
      const errores = validarCiudad(ciudad);
      assert.deepStrictEqual(errores, [], `${tier}/${semilla}: ${errores.join(" | ")}`);
      assert.ok(ciudad.puertas.length >= 1, `${tier}: sin puertas de muralla`);
      assert.ok(ciudad.modulosMuralla.some((m) => m.tipo === "torre"), `${tier}: sin torres`);
      assert.ok(ciudad.modulosMuralla.some((m) => m.tipo === "puerta"), `${tier}: sin módulo puerta`);
    }
  }
});

test("regresión DIRECTA: aldea_pequena/rio con las semillas 's1' y 's13' (el bug real reportado — camino principal cruzando el río en un paso puramente diagonal, con los dos codos ortogonales de agua) ya valida limpio", () => {
  const catDeco = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "decoracion.json"), "utf8"));
  for (const semilla of ["s1", "s13"]) {
    const ciudad = generarCiudad({ tier: "aldea_pequena", semilla, catalogos });
    assert.strictEqual(ciudad.variante, "rio", `${semilla}: se esperaba variante río (si el PRNG cambiara de resultado, esta regresión dejaría de probar lo que reportaba el bug)`);
    const errores = validarCiudad(ciudad);
    assert.deepStrictEqual(errores, [], `aldea_pequena/${semilla}: ${errores.join(" | ")}`);
    const costuras = encontrarCosturasDiagonales(ciudad).filter((c) => esCosturaEvitable(ciudad, c, catDeco));
    assert.deepStrictEqual(costuras, [], `aldea_pequena/${semilla}: quedó alguna costura diagonal EVITABLE sin conexión ortogonal`);
  }
});

test("anchura: ninguna casilla de calle depende ÚNICAMENTE de un vecino diagonal, salvo que los dos codos posibles estén bloqueados por geometría real (muro/solar/decoración) y no haya nada seguro que convertir", () => {
  const catDeco = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "decoracion.json"), "utf8"));
  for (const tier of tiers) {
    for (const semilla of ["anchura-1", "anchura-2", "anchura-3"]) {
      const ciudad = generarCiudad({ tier, semilla, catalogos });
      const evitables = encontrarCosturasDiagonales(ciudad).filter((c) => esCosturaEvitable(ciudad, c, catDeco));
      assert.deepStrictEqual(evitables, [], `${tier}/${semilla}: ${evitables.length} costura(s) diagonal(es) EVITABLE(S) sin reparar, p.ej. ${JSON.stringify(evitables[0])}`);
    }
  }
});

test("los edificios OBLIGATORIOS del tier siempre encuentran sitio", () => {
  for (const tier of tiers) {
    const ciudad = generarCiudad({ tier, semilla: "test-1", catalogos });
    const puestos = new Set(ciudad.edificios.map((e) => e.tipoEdificioId));
    for (const ob of asentamientos[tier].edificios.obligatorios || []) {
      assert.ok(puestos.has(ob), `${tier}: falta el obligatorio ${ob}`);
    }
  }
});

test("determinismo: mismo tier+semilla = misma ciudad; semillas distintas difieren", () => {
  const a = generarCiudad({ tier: "aldea", semilla: "s1", catalogos });
  const b = generarCiudad({ tier: "aldea", semilla: "s1", catalogos });
  assert.deepStrictEqual(a.terreno.datos, b.terreno.datos);
  assert.deepStrictEqual(a.portales, b.portales);
  assert.deepStrictEqual(a.modulosMuralla, b.modulosMuralla);
  const c = generarCiudad({ tier: "aldea", semilla: "s2", catalogos });
  assert.notDeepStrictEqual(a.terreno.datos, c.terreno.datos);
});

test("cada edificio va ROTADO hacia una calle y su huella sale de huellas.json", () => {
  const huellas = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "huellas.json"), "utf8"));
  const ciudad = generarCiudad({ tier: "pueblo", semilla: "test-1", catalogos });
  assert.ok(ciudad.edificios.length >= 8, `pocos edificios: ${ciudad.edificios.length}`);
  let rotados = 0;
  for (const ed of ciudad.edificios) {
    const esperada = huellas.porTipo[ed.tipoEdificioId] ||
      huellas.porRiqueza[catalogos.tiposEdificio[ed.tipoEdificioId]?.riqueza || "modesta"];
    // el jitter de variedad mueve la huella ±1 por instancia
    assert.ok(Math.abs(ed.w - esperada[0]) <= 1 && Math.abs(ed.h - esperada[1]) <= 1,
      `${ed.tipoEdificioId}: huella ${ed.w}x${ed.h} vs base ${esperada}`);
    assert.ok(ed.casillas.length > 0, "huella rasterizada");
    assert.ok(ed.interior.plantas.length > 0, "interior anidado generado");
    if (ed.rot % 90 !== 0) rotados++;
  }
  assert.ok(rotados > 0, "ningún edificio con rotación orgánica (todos alineados a los ejes)");
});

test("la muralla es un polígono IRREGULAR (no un círculo perfecto ni un rectángulo)", () => {
  const ciudad = generarCiudad({ tier: "capital", semilla: "test-1", catalogos });
  const radios = ciudad.poligonoMuralla.map((p) => Math.hypot(p.x - ciudad.focal.x, p.y - ciudad.focal.y));
  const min = Math.min(...radios), max = Math.max(...radios);
  assert.ok(max / min > 1.08, `polígono demasiado regular (max/min=${(max / min).toFixed(3)})`);
});

test("el export completo cuadra con el formato de sectores + capa vectorial", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-test-"));
  const ciudad = hornearCiudad("aldea_pequena", "test-export", carpeta);
  const indice = JSON.parse(fs.readFileSync(path.join(carpeta, "indice.json"), "utf8"));
  assert.strictEqual(indice.tamanoChunk, TAMANO_CHUNK);
  assert.ok(indice.portales.some((p) => p.tipo === "exterior"));
  assert.strictEqual(indice.portales.filter((p) => p.tipo === "interior").length, ciudad.edificios.length);
  assert.ok(indice.muralla.modulos.length > 0, "módulos de muralla en la capa vectorial");
  assert.ok(indice.caminos.length >= 1, "polilíneas de caminos");
  assert.ok(Array.isArray(indice.zonasVerdes), "zonas verdes en el índice");
  // el spawn cae en casilla transitable
  const cx = Math.floor(indice.ciudad.x / TAMANO_CHUNK), cy = Math.floor(indice.ciudad.y / TAMANO_CHUNK);
  const sx = Math.floor(cx / indice.tamanoSectorChunks), sy = Math.floor(cy / indice.tamanoSectorChunks);
  const sector = JSON.parse(fs.readFileSync(path.join(carpeta, `sector_${String(sx).padStart(3, "0")}_${String(sy).padStart(3, "0")}.json`), "utf8"));
  const chunk = sector.chunks[`${cx}_${cy}`];
  const lx = indice.ciudad.x - cx * TAMANO_CHUNK, ly = indice.ciudad.y - cy * TAMANO_CHUNK;
  const id = indice.leyendaTerreno[parseInt(chunk.terreno[ly * TAMANO_CHUNK + lx], 36)];
  assert.ok(["camino", "adoquin", "cesped", "tierra"].includes(id), `spawn sobre ${id}`);
  assert.strictEqual(chunk.elevacion.length, TAMANO_CHUNK * TAMANO_CHUNK, "elevación por casilla");
  assert.strictEqual(fs.readdirSync(path.join(carpeta, "interiores")).length, ciudad.edificios.length);
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test("determinismo del export completo: dos bakes de la misma semilla dan los MISMOS sector_*.json byte a byte (incluida `va` de cada edificio)", () => {
  // Regresión de un bug reportado por el usuario: al rebakear dos veces la
  // misma ciudad, la `va` (variante de placeholder) de algunos edificios
  // cambiaba entre bake y bake pese a que el resto de campos (w,h,dx,dy,x,y,ro)
  // eran idénticos. La causa real resultó ser dos bakes corridos a caballo de
  // un commit que cambió cómo se calcula `va` (de fijo 0 a hash de semilla),
  // no una fuente de aleatoriedad no determinista en el código actual — pero
  // el caso merece guardia permanente: mismo tier+semilla SIEMPRE debe
  // exportar los mismos ficheros, sin importar cuántas veces se hornee.
  const carpetaA = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-det-a-"));
  const carpetaB = fs.mkdtempSync(path.join(os.tmpdir(), "ciudad-det-b-"));
  hornearCiudad("pueblo", "det-repro", carpetaA);
  hornearCiudad("pueblo", "det-repro", carpetaB);

  const archivosSector = fs.readdirSync(carpetaA).filter((f) => f.startsWith("sector_") && f.endsWith(".json"));
  assert.ok(archivosSector.length > 0, "el bake no exportó ningún sector");

  const vasDe = (carpeta) => {
    const vas = [];
    for (const archivo of archivosSector.sort()) {
      const sector = JSON.parse(fs.readFileSync(path.join(carpeta, archivo), "utf8"));
      for (const clave of Object.keys(sector.chunks).sort()) {
        for (const obj of sector.chunks[clave].objetos || [])
          if (obj.t === "e") vas.push(`${archivo}:${clave}:${obj.i}@${obj.x},${obj.y} -> va:${obj.va}`);
      }
    }
    return vas;
  };
  assert.deepStrictEqual(vasDe(carpetaA), vasDe(carpetaB), "la variante `va` de algún edificio cambió entre dos bakes idénticos");

  // guardia más amplia: el export entero (sectores + indice) es idéntico byte a byte
  for (const archivo of [...archivosSector, "indice.json"]) {
    const a = fs.readFileSync(path.join(carpetaA, archivo), "utf8");
    const b = fs.readFileSync(path.join(carpetaB, archivo), "utf8");
    assert.strictEqual(a, b, `${archivo} difiere entre dos bakes de la misma semilla`);
  }

  fs.rmSync(carpetaA, { recursive: true, force: true });
  fs.rmSync(carpetaB, { recursive: true, force: true });
});

test("capas de vegetación, decoración e iluminación: presentes y con catálogo coherente", () => {
  const catDeco = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "decoracion.json"), "utf8"));
  const ciudad = generarCiudad({ tier: "capital", semilla: "test-capas", catalogos });
  assert.ok(ciudad.arboles.length > 0, "capa de vegetación vacía");
  assert.ok(ciudad.deco.length > 0, "capa de decoración vacía");
  assert.ok(ciudad.luces.length >= 4, `pocas luces: ${ciudad.luces.length}`);
  for (const d of ciudad.deco) assert.ok(catDeco[d.i], `pieza de deco sin entrada de catálogo: ${d.i}`);
  for (const l of ciudad.luces) assert.ok(catDeco[l.id]?.luz, `luz sin datos de luz en catálogo: ${l.id}`);
  // la deco que colisiona nunca pisa un camino (no encierra a nadie)
  for (const d of ciudad.deco) {
    if (!catDeco[d.i].colision) continue;
    const t = ciudad.terreno.get(d.x, d.y);
    assert.ok(t !== "camino" && t !== "puente", `${d.i} bloquea un camino en ${d.x},${d.y}`);
  }
  // el tier más grande dobla el radio de la capital
  assert.strictEqual(asentamientos.gran_capital.organico.radio, asentamientos.capital.organico.radio * 2);
});

test("los terrenos urbanos existen en el catálogo del baker con su transitabilidad", () => {
  const terrenos = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "baker", "catalogo", "terrenos.json"), "utf8"));
  assert.strictEqual(terrenos.adoquin.transitable, true);
  assert.strictEqual(terrenos.muralla_piedra.transitable, false);
  assert.strictEqual(terrenos.empalizada.transitable, false);
  assert.strictEqual(terrenos.solar_edificio.transitable, false);
});

// === Ciudad capital del jarl (docs/GDD_Ciudad_Capital.md) ===================
// La capital final de PRODUCCIÓN (radio 96, ~90 edificios) la hornea el
// streamer — aquí solo se valida el MOTOR con una variante de PRUEBA
// reducida (mismo patrón que el resto de este archivo: radio/cantidad
// pequeños para que el test sea rápido, catalogoAsentamientos inyectado en
// vez de tocar el fichero real).
function variantePruebaCapitalJarl() {
  const asentamientos = cargarAsentamientos();
  const variante = JSON.parse(JSON.stringify(asentamientos));
  Object.assign(variante.capital_jarl.organico, { radio: 42 });
  variante.capital_jarl.plaza = 5;
  variante.capital_jarl.zonasVerdes = 4;
  variante.capital_jarl.camposCultivo = 5;
  variante.capital_jarl.edificios.cantidad = [26, 32];
  variante.capital_jarl.parcelasReservadas = { normales: 8, especiales: 6 };
  return variante;
}

test("capital_jarl: muralla de empalizada, casco apretado (colchón bajo) y determinismo", () => {
  const variante = variantePruebaCapitalJarl();
  const a = generarCiudad({ tier: "capital_jarl", semilla: "cap-1", catalogos, catalogoAsentamientos: variante });
  const errores = validarCiudad(a);
  assert.deepStrictEqual(errores, [], `capital_jarl inválida: ${errores.join(" | ")}`);
  assert.strictEqual(asentamientos.capital_jarl.muralla.material, "empalizada", "la capital del jarl empieza con muralla de MADERA (mejorable luego)");
  assert.ok(asentamientos.capital_jarl.edificios.colchonMinimo < 1, "colchón por defecto (1) sin apretar para el casco viejo");

  const b = generarCiudad({ tier: "capital_jarl", semilla: "cap-1", catalogos, catalogoAsentamientos: variante });
  assert.deepStrictEqual(a.terreno.datos, b.terreno.datos, "determinismo: misma semilla = mismo resultado");
  assert.deepStrictEqual(a.parcelasReservadas, b.parcelasReservadas, "determinismo de las parcelas reservadas");

  const c = generarCiudad({ tier: "capital_jarl", semilla: "cap-2", catalogos, catalogoAsentamientos: variante });
  assert.notDeepStrictEqual(a.terreno.datos, c.terreno.datos, "semillas distintas dan ciudades distintas");
});

test("capital_jarl: las parcelas reservadas (normales + especiales) salen sin edificio real ni solape", () => {
  // Tamaño REAL del tier aquí (no una variante encogida): a radio/densidad
  // reducidos el ratio 12 obligatorios/radio se dispara y deja de haber
  // hueco para reservar nada (probado). El tamaño real, en cambio, se
  // demostró robusto en un barrido de 11 semillas (0 errores de validación)
  // — "s2" en concreto encuentra hueco para las 20 normales + 16 especiales
  // completas, así que sirve para comprobar también el recuento exacto.
  const ciudad = generarCiudad({ tier: "capital_jarl", semilla: "s2", catalogos });
  const errores = validarCiudad(ciudad);
  assert.deepStrictEqual(errores, [], `capital_jarl inválida: ${errores.join(" | ")}`);

  const { parcelasReservadas } = ciudad;
  const normales = parcelasReservadas.filter((p) => p.tipo === "normal");
  const especiales = parcelasReservadas.filter((p) => p.tipo === "especial");
  assert.strictEqual(especiales.length, asentamientos.capital_jarl.parcelasReservadas.especiales, "parcelas ESPECIALES reservadas (proyectos del jarl)");
  assert.strictEqual(normales.length, asentamientos.capital_jarl.parcelasReservadas.normales, "parcelas NORMALES reservadas (vivienda futura)");

  // las especiales llevan huella mayor que las normales (proyectos del jarl)
  for (const p of especiales) assert.ok(p.ancho * p.largo > normales[0].ancho * normales[0].largo, "una parcela especial debe ser mayor que una normal");

  // ninguna reservada quedó marcada como "solar_edificio" (terreno intacto,
  // hueco caminable real) ni se solapa con un edificio real
  const idsEdificio = new Set();
  for (const ed of ciudad.edificios) for (const [x, y] of ed.casillas) idsEdificio.add(`${x},${y}`);
  // mismo rasterizado EXACTO que usa el generador para pintar cada pieza
  // (rasterizarRectRotado con extra=0) — reimplementar la rotación a mano
  // daba falsos positivos por redondeo en los bordes.
  for (const p of parcelasReservadas) {
    const angulo = (p.rot * Math.PI) / 180;
    rasterizarRectRotado(p.x, p.y, p.ancho / 2, p.largo / 2, angulo, ciudad.ancho, ciudad.alto, (x, y) => {
      const t = ciudad.terreno.get(x, y);
      assert.notStrictEqual(t, "solar_edificio", `parcela reservada ${p.tipo} en ${p.x},${p.y} pisa un solar de edificio en ${x},${y}`);
      assert.ok(!idsEdificio.has(`${x},${y}`), `parcela reservada ${p.tipo} se solapa con un edificio real en ${x},${y}`);
    });
  }
});

test("capital_jarl: las parcelas reservadas nunca exceden lo pedido en el tier, sea cual sea la semilla (mejor esfuerzo)", () => {
  // El hueco disponible varía con la semilla (geografía/caminos distintos):
  // no siempre caben las 20+16 completas, es "mejor esfuerzo" documentado
  // (GDD_Ciudad_Capital.md) — pero JAMÁS debe reservarse de más, ni salir
  // inválida.
  for (const semilla of ["s1", "s3", "cap-x"]) {
    const ciudad = generarCiudad({ tier: "capital_jarl", semilla, catalogos });
    assert.deepStrictEqual(validarCiudad(ciudad), [], `${semilla}: ciudad inválida`);
    const normales = ciudad.parcelasReservadas.filter((p) => p.tipo === "normal").length;
    const especiales = ciudad.parcelasReservadas.filter((p) => p.tipo === "especial").length;
    assert.ok(normales <= asentamientos.capital_jarl.parcelasReservadas.normales, `${semilla}: más normales de las pedidas`);
    assert.ok(especiales <= asentamientos.capital_jarl.parcelasReservadas.especiales, `${semilla}: más especiales de las pedidas`);
  }
});

test("capital_jarl: los campos de cultivo caen en zona PISABLE, pegados a la cara interior de la muralla", () => {
  const ciudad = generarCiudad({ tier: "capital_jarl", semilla: "s1", catalogos });
  const errores = validarCiudad(ciudad);
  assert.deepStrictEqual(errores, []);

  const campos = ciudad.zonasVerdes.filter((z) => z.tipo === "campo_cultivo");
  assert.ok(campos.length > 0, "no se generó ningún campo de cultivo");
  assert.ok(campos.length <= asentamientos.capital_jarl.camposCultivo, "no puede haber más campos que los pedidos por el tier");

  const grosor = asentamientos.capital_jarl.muralla.grosor;
  const radioBanda = asentamientos.capital_jarl.organico.radio - grosor;
  for (const campo of campos) {
    // pisable de verdad: nunca "extramuros" (el anillo de fuera nunca se pisa)
    assert.strictEqual(
      ciudad.terreno.get(campo.x, campo.y), "tierra_labrada",
      `campo de cultivo en ${campo.x},${campo.y} no quedó como tierra_labrada pisable`,
    );
    const d = Math.hypot(campo.x - ciudad.focal.x, campo.y - ciudad.focal.y);
    assert.ok(d <= radioBanda + 1, `campo de cultivo demasiado lejos de la muralla (d=${d.toFixed(1)}, radio útil ${radioBanda.toFixed(1)})`);
  }
});
