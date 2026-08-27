"use strict";
// Bakeador de CIUDADES/ALDEAS — el tercer tipo de mapa (GDD_Bakeador_POIs).
// Genera el "cubo sin techo": un recinto SIEMPRE acotado por su muralla
// (empalizada pobre / piedra rica según tier), con plaza central, calle
// principal puerta→plaza, calle de ronda junto a la muralla, y parcelas de
// edificios cuya huella sale del INTERIOR REAL generado (bake anidado con
// el motor de interiores): el mismo tipoEdificio coloca fuera y genera
// dentro — un solo vocabulario, cero catálogos paralelos.
//
// Determinismo total: mismo tier + misma semilla = misma ciudad, interiores
// incluidos (PRNG mulberry32 compartido con interiores/azar.js).

const path = require("path");
const fs = require("fs");
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");
const { cargarCatalogos } = require("../../interiores/src/catalogo");
const { generarEdificio } = require("../../interiores/src/edificio");

const RAIZ = path.join(__dirname, "..", "..");
const MARGEN_EXTERIOR = 4; // césped alrededor de la muralla, solo estético
const ANCHO_PUERTA = 2;
const ANCHO_CALLE = 2;

function cargarAsentamientos() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "asentamientos.json"), "utf8"));
}

// ---------------------------------------------------------------------------
// Rejilla de terreno: strings de id de terreno (la exportación los convierte
// a índices de leyenda). Los mapas de ciudad son pequeños (<150x100), así
// que la claridad gana a la micro-optimización aquí (el bake es offline).
class Rejilla {
  constructor(ancho, alto, relleno) {
    this.ancho = ancho;
    this.alto = alto;
    this.datos = new Array(ancho * alto).fill(relleno);
  }
  dentro(x, y) {
    return x >= 0 && y >= 0 && x < this.ancho && y < this.alto;
  }
  get(x, y) {
    return this.dentro(x, y) ? this.datos[y * this.ancho + x] : null;
  }
  set(x, y, v) {
    if (this.dentro(x, y)) this.datos[y * this.ancho + x] = v;
  }
  rect(x0, y0, x1, y1, v) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, v);
  }
}

// ---------------------------------------------------------------------------
function generarCiudad({ tier, semilla, catalogos, catalogoAsentamientos }) {
  const asentamientos = catalogoAsentamientos || cargarAsentamientos();
  const def = asentamientos[tier];
  if (!def || tier.startsWith("_")) throw new Error(`tier de asentamiento desconocido: ${tier}`);
  catalogos = catalogos || cargarCatalogos();
  const rnd = crearPRNG(`ciudad:${tier}:${semilla}`);

  const [W, H] = def.recinto;
  const M = MARGEN_EXTERIOR;
  const ancho = W + M * 2;
  const alto = H + M * 2;
  const g = def.muralla.grosor;
  const terreno = new Rejilla(ancho, alto, "cesped");

  // --- muralla: anillo perimetral del recinto -----------------------------
  const rx0 = M, ry0 = M, rx1 = M + W - 1, ry1 = M + H - 1;
  const mat = def.muralla.material;
  for (let y = ry0; y <= ry1; y++)
    for (let x = rx0; x <= rx1; x++) {
      const d = Math.min(x - rx0, y - ry0, rx1 - x, ry1 - y);
      if (d < g) terreno.set(x, y, mat);
    }

  // --- puertas de muralla (sur siempre; norte y este si el tier tiene más)
  const cx = Math.floor((rx0 + rx1) / 2);
  const cy = Math.floor((ry0 + ry1) / 2);
  const puertas = [];
  const ladosPuerta = ["sur", "norte", "este"].slice(0, def.muralla.puertas);
  for (const lado of ladosPuerta) {
    for (let i = 0; i < ANCHO_PUERTA; i++) {
      if (lado === "sur") for (let k = 0; k < g; k++) terreno.set(cx + i, ry1 - k, "adoquin");
      if (lado === "norte") for (let k = 0; k < g; k++) terreno.set(cx + i, ry0 + k, "adoquin");
      if (lado === "este") for (let k = 0; k < g; k++) terreno.set(rx1 - k, cy + i, "adoquin");
    }
    // la casilla portal (salida al exterior) es la del borde exterior del hueco
    if (lado === "sur") puertas.push({ lado, x: cx, y: ry1 });
    if (lado === "norte") puertas.push({ lado, x: cx, y: ry0 });
    if (lado === "este") puertas.push({ lado, x: rx1, y: cy });
  }

  // --- calle de ronda pegada a la muralla (conecta todo el perímetro) -----
  const ix0 = rx0 + g, iy0 = ry0 + g, ix1 = rx1 - g, iy1 = ry1 - g; // interior útil
  for (let y = iy0; y <= iy1; y++)
    for (let x = ix0; x <= ix1; x++) {
      const d = Math.min(x - ix0, y - iy0, ix1 - x, iy1 - y);
      if (d < ANCHO_CALLE) terreno.set(x, y, "camino");
    }

  // --- plaza central ------------------------------------------------------
  const [pw, ph] = def.plaza;
  const plaza = {
    x0: cx - Math.floor(pw / 2),
    y0: cy - Math.floor(ph / 2),
    x1: cx - Math.floor(pw / 2) + pw - 1,
    y1: cy - Math.floor(ph / 2) + ph - 1,
  };
  terreno.rect(plaza.x0, plaza.y0, plaza.x1, plaza.y1, "adoquin");

  // --- calle principal: cada puerta → plaza (recta, ancho 2) --------------
  for (const p of puertas) {
    if (p.lado === "sur") terreno.rect(cx, plaza.y1 + 1, cx + ANCHO_CALLE - 1, ry1 - g, "adoquin");
    if (p.lado === "norte") terreno.rect(cx, ry0 + g, cx + ANCHO_CALLE - 1, plaza.y0 - 1, "adoquin");
    if (p.lado === "este") terreno.rect(plaza.x1 + 1, cy, rx1 - g, cy + ANCHO_CALLE - 1, "adoquin");
  }

  // --- elegir edificios: obligatorios + ponderados hasta la cantidad ------
  const [minEd, maxEd] = def.edificios.cantidad;
  const cantidad = minEd + Math.floor(rnd() * (maxEd - minEd + 1));
  const tiposElegidos = [...(def.edificios.obligatorios || [])];
  const ponderados = def.edificios.ponderados || [];
  while (tiposElegidos.length < cantidad && ponderados.length > 0) {
    tiposElegidos.push(elegirPonderado(ponderados, rnd));
  }

  // --- bake anidado: el interior REAL decide la huella --------------------
  // huella = planta baja + 1 casilla de muro perimetral por lado.
  const edificios = [];
  for (let n = 0; n < tiposElegidos.length; n++) {
    const tipoEdificioId = tiposElegidos[n];
    const semillaInterior = `${semilla}:${tipoEdificioId}:${n}`;
    const interior = generarEdificio({ tipoEdificioId, catalogos, semilla: semillaInterior });
    const baja = interior.plantas.find((p) => p.nivel === 0) || interior.plantas[0];
    edificios.push({
      tipoEdificioId,
      semillaInterior,
      interior,
      w: baja.ancho + 2,
      h: baja.alto + 2,
      obligatorio: n < (def.edificios.obligatorios || []).length,
    });
  }
  // los grandes primero: si algo no cabe, que sea un opcional pequeño
  edificios.sort((a, b) => b.w * b.h - a.w * a.h || a.tipoEdificioId.localeCompare(b.tipoEdificioId));

  // --- colocación por filas con callejón-calle bajo cada fila -------------
  // ocupación: casillas donde NO se puede edificar (muralla+ronda, plaza con
  // 1 de respiro, calles principales con 1 de respiro)
  const libre = new Rejilla(ancho, alto, false);
  for (let y = iy0 + ANCHO_CALLE; y <= iy1 - ANCHO_CALLE; y++)
    for (let x = ix0 + ANCHO_CALLE; x <= ix1 - ANCHO_CALLE; x++) libre.set(x, y, true);
  const vetar = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) libre.set(x, y, false);
  };
  vetar(plaza.x0 - 1, plaza.y0 - 1, plaza.x1 + 1, plaza.y1 + 1);
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++)
      if (terreno.get(x, y) === "adoquin") vetar(x - 1, y - 1, x + 1, y + 1);

  const cabe = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!libre.get(xx, yy)) return false;
    return true;
  };

  const colocados = [];
  const pendientes = [...edificios];
  let cursorY = iy0 + ANCHO_CALLE;
  while (cursorY <= iy1 - ANCHO_CALLE && pendientes.length) {
    let alturaFila = 0;
    let colocoAlguno = false;
    for (let i = 0; i < pendientes.length; ) {
      const ed = pendientes[i];
      let puesto = false;
      for (let x = ix0 + ANCHO_CALLE; x + ed.w - 1 <= ix1 - ANCHO_CALLE; x++) {
        if (!cabe(x, cursorY, ed.w, ed.h)) continue;
        ed.x = x;
        ed.y = cursorY;
        vetar(x - 1, cursorY - 1, x + ed.w, cursorY + ed.h); // +1 de callejón alrededor
        colocados.push(ed);
        pendientes.splice(i, 1);
        alturaFila = Math.max(alturaFila, ed.h);
        puesto = true;
        colocoAlguno = true;
        break;
      }
      if (!puesto) i++;
    }
    if (!colocoAlguno) {
      cursorY += 1; // fila imposible: probar una casilla más abajo
      continue;
    }
    // calle bajo la fila (conecta las fachadas) — cruza toda la banda útil,
    // así que corta con la calle principal/ronda sí o sí
    const yCalle = cursorY + alturaFila;
    terreno.rect(ix0, yCalle, ix1, Math.min(yCalle + ANCHO_CALLE - 1, iy1), "camino");
    cursorY = yCalle + ANCHO_CALLE + 1;
  }

  // --- pintar huellas + puerta de cada edificio ---------------------------
  const portales = puertas.map((p) => ({ tipo: "exterior", x: p.x, y: p.y, lado: p.lado }));
  for (const ed of colocados) {
    terreno.rect(ed.x, ed.y, ed.x + ed.w - 1, ed.y + ed.h - 1, "solar_edificio");
    // puerta al sur, centrada; camino de 1 de ancho hasta la primera calle
    const px = ed.x + Math.floor(ed.w / 2);
    let py = ed.y + ed.h;
    ed.puerta = { x: px, y: py };
    while (terreno.dentro(px, py) && terreno.get(px, py) !== "camino" && terreno.get(px, py) !== "adoquin") {
      terreno.set(px, py, "camino");
      py++;
    }
    portales.push({ tipo: "interior", x: ed.puerta.x, y: ed.puerta.y, edificio: ed.interior.id, tipoEdificioId: ed.tipoEdificioId });
  }

  // spawn: justo por dentro de la primera puerta (sur), sobre la calle
  const spawn = { x: puertas[0].x, y: puertas[0].lado === "sur" ? ry1 - g - 1 : ry0 + g + 1 };

  return {
    tier,
    semilla,
    ancho,
    alto,
    terreno,
    plaza,
    puertas,
    portales,
    spawn,
    edificios: colocados,
    descartados: pendientes.map((e) => e.tipoEdificioId),
  };
}

// ---------------------------------------------------------------------------
// Validaciones de ciudad (las usan los tests y el CLI): la muralla es
// estanca salvo por sus puertas, y todas las puertas de edificio se
// alcanzan andando desde las puertas de muralla.
const TRANSITABLES = new Set(["cesped", "camino", "adoquin", "tierra"]);

function floodTransitable(ciudad, inicios) {
  const { terreno } = ciudad;
  const visitado = new Set();
  const cola = [];
  for (const { x, y } of inicios) {
    cola.push([x, y]);
    visitado.add(y * terreno.ancho + x);
  }
  while (cola.length) {
    const [x, y] = cola.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      const clave = ny * terreno.ancho + nx;
      if (!terreno.dentro(nx, ny) || visitado.has(clave)) continue;
      if (!TRANSITABLES.has(terreno.get(nx, ny))) continue;
      visitado.add(clave);
      cola.push([nx, ny]);
    }
  }
  return visitado;
}

function validarCiudad(ciudad) {
  const errores = [];
  const { terreno } = ciudad;
  // 1) estanqueidad: desde fuera, tapando las puertas, no se entra
  const tapado = ciudad.puertas.map((p) => {
    const antes = [];
    // tapa el hueco entero de la puerta (ANCHO_PUERTA x grosor)
    for (let y = 0; y < terreno.alto; y++)
      for (let x = 0; x < terreno.ancho; x++) {
        if (Math.abs(x - p.x) <= ANCHO_PUERTA && Math.abs(y - p.y) <= ANCHO_PUERTA && terreno.get(x, y) === "adoquin") {
          antes.push([x, y]);
          terreno.set(x, y, "muralla_piedra");
        }
      }
    return antes;
  });
  const desdeFuera = floodTransitable(ciudad, [{ x: 0, y: 0 }]);
  const interiorAlcanzado = [...desdeFuera].some((clave) => {
    const x = clave % terreno.ancho, y = Math.floor(clave / terreno.ancho);
    return x > MARGEN_EXTERIOR + 2 && y > MARGEN_EXTERIOR + 2 &&
      x < terreno.ancho - MARGEN_EXTERIOR - 3 && y < terreno.alto - MARGEN_EXTERIOR - 3 &&
      terreno.get(x, y) !== "cesped";
  });
  if (interiorAlcanzado) errores.push("la muralla NO es estanca: se entra sin pasar por una puerta");
  for (const lista of tapado) for (const [x, y] of lista) terreno.set(x, y, "adoquin");

  // 2) conectividad: desde el spawn se llega a la puerta de cada edificio
  const alcanzable = floodTransitable(ciudad, [ciudad.spawn]);
  for (const ed of ciudad.edificios) {
    if (!alcanzable.has(ed.puerta.y * terreno.ancho + ed.puerta.x)) {
      errores.push(`puerta inalcanzable: ${ed.tipoEdificioId} en ${ed.puerta.x},${ed.puerta.y}`);
    }
  }
  // 3) las huellas no se pisan (el vetado ya lo impide; se re-comprueba)
  const ocupadas = new Set();
  for (const ed of ciudad.edificios) {
    for (let y = ed.y; y < ed.y + ed.h; y++)
      for (let x = ed.x; x < ed.x + ed.w; x++) {
        const clave = y * terreno.ancho + x;
        if (ocupadas.has(clave)) errores.push(`solape de huellas en ${x},${y}`);
        ocupadas.add(clave);
      }
  }
  return errores;
}

module.exports = { generarCiudad, validarCiudad, cargarAsentamientos, floodTransitable, TRANSITABLES, MARGEN_EXTERIOR };
