"use strict";

// Generador procedural de ropa en vóxeles — mismo espíritu que el
// bakeador de exteriores/interiores: "generar UNA vez, nunca en directo"
// (CLAUDE.md punto 1) y determinismo por semilla (punto 3). Una prenda
// generada es una lista plana de vóxeles {x,y,z,color,zona,parte} en el
// espacio LOCAL del pivote del rig al que se cuelga (torso/piernas/
// cabeza/brazoIzq/brazoDer — ver client/src/render3d/rigHumanoide.ts).
// El cliente solo tiene que fusionar esos vóxeles en una única geometría
// por prenda y colgarla del pivote correspondiente: hereda la animación
// gratis, no lleva física propia y es "una sola pieza" pegada a la piel,
// tal y como pide el diseño (nunca una prenda con huesos propios).

const { crearPRNG } = require("../../interiores/src/azar");
const { aplicarMorfologia } = require("./morfologia");

// La ropa se genera un pelín más ancha que el cuerpo desnudo para que se
// vea como una capa sobre la piel sin fundirse con ella — no es físico
// (no hay tela que cuelgue), es solo el margen visual de "prenda puesta".
const MARGEN_CAPA = 1.08;

function ajustarColor(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  const r = ajustar((n >> 16) & 255);
  const g = ajustar((n >> 8) & 255);
  const b = ajustar(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Color final por zona: el tinte que elige el jugador (si la zona es
// tintable) o el color base del material; zonasFijas ignoran SIEMPRE el
// tinte del jugador. Pequeña variación determinista por vóxel (misma
// idea que la veta de madera de los muebles) para que no quede un bloque
// de color plano.
function resolverColoresPorZona(prenda, material, tintes, rnd) {
  const colores = {};
  for (const zona of prenda.zonasColor || []) {
    const base = (tintes && tintes[zona]) || material.colorDebug;
    colores[zona] = base;
  }
  for (const zona of prenda.zonasFijas || []) {
    // Acentos fijos conocidos; si no hay uno especial, es el material
    // sin tintar, un poco más oscuro (costuras/ribetes).
    colores[zona] = zona === "remiendos" || zona === "cordon"
      ? ajustarColor(material.colorDebug, -0.22)
      : ajustarColor(material.colorDebug, -0.12);
  }
  return colores;
}

function variarColor(hex, rnd, amplitud = 0.05) {
  return ajustarColor(hex, (rnd() - 0.5) * amplitud);
}

// Rellena una "parte" (torso, una pierna, una manga, la cabeza...) como
// una pila de capas horizontales; cada capa tiene una escala en X/Z que
// da la silueta (formaFn) y una zona (para el color) — el resultado es
// deliberadamente "de bloques" (estilo vóxel), no una malla suave.
function voxelizarParte({ w, h, d, resolucion, formaFn, zonaBase, pivoteX = 0, pivoteYBase = 0 }, colores, rnd, parteId) {
  const voxeles = [];
  const { x: nx, y: ny, z: nz } = resolucion;
  const cw = w / nx;
  const ch = h / ny;
  const cd = d / nz;
  for (let iy = 0; iy < ny; iy++) {
    const t = ny <= 1 ? 0 : iy / (ny - 1); // 0 = capa base, 1 = capa final
    const { escalaX = 1, escalaZ = escalaX, zona = zonaBase } = formaFn(t, iy, ny) || {};
    const anchoCapa = w * escalaX;
    const fondoCapa = d * escalaZ;
    const nxCapa = Math.max(1, Math.round(nx * escalaX));
    const nzCapa = Math.max(1, Math.round(nz * escalaZ));
    for (let ix = 0; ix < nxCapa; ix++) {
      for (let iz = 0; iz < nzCapa; iz++) {
        const x = pivoteX - anchoCapa / 2 + (ix + 0.5) * (anchoCapa / nxCapa);
        const z = -fondoCapa / 2 + (iz + 0.5) * (fondoCapa / nzCapa);
        const y = pivoteYBase + iy * ch;
        const colorZona = colores[zona] || colores[zonaBase];
        voxeles.push({ x, y, z, color: variarColor(colorZona, rnd), zona, parte: parteId });
      }
    }
  }
  return voxeles;
}

// --- Siluetas por tipo de prenda (t=0 capa inicial, t=1 capa final) ---
// Basadas en referencia real (túnica altomedieval de corte suelto pero NO
// bombacho, con mangas hasta la muñeca; calza/pantalón ancho de cadera y
// entallado en el tobillo; coif de lino ajustado con el borde vuelto —
// ver docs/GDD_Ropa_Procedural.md para las fuentes).

function formaCamisaCuerpo(detalle) {
  return (t) => {
    if (t > 0.93) return { escalaX: 1, zona: "cuello" };
    if (detalle.bajo === "recto" && t < 0.1) return { escalaX: 1.12, zona: "cuerpo" }; // vuelo del bajo
    return { escalaX: 1, zona: "cuerpo" };
  };
}

function formaManga(detalle) {
  return (t) => {
    // t=0 es el extremo de la manga (muñeca), t=1 el hombro (pivote).
    if (t < 0.12) return { escalaX: 0.95, zona: "puños" }; // puño ajustado
    return { escalaX: 1, zona: "cuerpo" };
  };
}

function formaPierna(detalle) {
  return (t) => {
    // t=0 es el tobillo (abajo), t=1 la cadera (arriba, pivote del rig).
    if (detalle.cinturon && t > 0.92) return { escalaX: 1.18, zona: "cinturon" };
    let escala = detalle.corte === "holgado" ? 1.0 + 0.15 * t : 1.0; // más ancho arriba, en la cadera
    if (detalle.bajo === "estrecho" && t < 0.15) escala *= 0.8;
    return { escalaX: escala, zona: "cuerpo" };
  };
}

function formaGorro(detalle) {
  return (t) => {
    if (detalle.borde === "vuelto" && t < 0.14) return { escalaX: 1.2, zona: "cuerpo" }; // borde vuelto hacia fuera
    // se ciñe al cráneo y se estrecha hacia la coronilla
    return { escalaX: 1.05 - 0.35 * t, zona: "cuerpo" };
  };
}

// Remiendos: un puñado de vóxeles con color fijo, insertados a mano sobre
// una parte ya generada (no cambian la silueta, solo el color de unas
// pocas celdas — como un parche de tela cosido encima).
function aplicarRemiendos(voxeles, colorRemiendo, rnd, cantidad = 4) {
  if (!voxeles.length) return;
  for (let i = 0; i < cantidad; i++) {
    const idx = Math.floor(rnd() * voxeles.length);
    voxeles[idx] = { ...voxeles[idx], color: colorRemiendo, zona: "remiendos" };
  }
}

// Cordón del gorro: un par de tiras cortas colgando a ambos lados de la
// barbilla, ancladas al borde inferior de la cabeza.
function generarCordon(bboxCabeza, colorCordon, rnd, parteId) {
  const voxeles = [];
  for (const lado of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      voxeles.push({
        x: lado * bboxCabeza.w * 0.42,
        y: -0.02 - i * 0.03,
        z: bboxCabeza.d * 0.3,
        color: colorCordon,
        zona: "cordon",
        parte: parteId,
      });
    }
  }
  return voxeles;
}

function generarPrendaTorso(prenda, material, colores, rnd, proporcionesRig) {
  const { torso, brazo, altoTorso } = proporcionesRig;
  const w = torso.w * MARGEN_CAPA;
  const d = torso.d * MARGEN_CAPA;
  let voxeles = voxelizarParte(
    { w, h: altoTorso, d, resolucion: prenda.voxelResolucion, formaFn: formaCamisaCuerpo(prenda.detalle), zonaBase: "cuerpo", pivoteYBase: 0 },
    colores, rnd, "torso",
  );

  if (prenda.detalle.mangas) {
    const largo = prenda.detalle.mangas === "largas" ? brazo.mangaH * 0.95 : brazo.mangaH * 0.55;
    const resManga = { x: Math.max(2, Math.round(prenda.voxelResolucion.x * 0.55)), y: Math.max(3, Math.round(prenda.voxelResolucion.y * 0.5)), z: Math.max(2, Math.round(prenda.voxelResolucion.z * 0.7)) };
    for (const [lado, parteId] of [[-1, "mangaIzq"], [1, "mangaDer"]]) {
      const manga = voxelizarParte(
        {
          w: brazo.mangaW * MARGEN_CAPA, h: largo, d: brazo.mangaD * MARGEN_CAPA,
          resolucion: resManga, formaFn: formaManga(prenda.detalle), zonaBase: "cuerpo",
          pivoteX: 0, pivoteYBase: -largo,
        },
        colores, rnd, parteId,
      );
      // Se ancla al pivote brazoIzq/brazoDer del rig, no al de torso — el
      // llamador (assetsRopa/entityLoader del cliente) decide el pivote
      // por el campo `parte`; aquí solo importa que y=0 caiga en el
      // hombro de esa manga.
      voxeles = voxeles.concat(manga.map((v) => ({ ...v, x: v.x, pivote: lado < 0 ? "brazoIzq" : "brazoDer" })));
    }
  }
  return voxeles;
}

function generarPrendaPiernas(prenda, material, colores, rnd, proporcionesRig) {
  const { pierna, altoPierna } = proporcionesRig;
  const w = pierna.w * MARGEN_CAPA;
  const d = pierna.d * MARGEN_CAPA;
  let voxeles = [];
  for (const [lado, parteId] of [[-1, "piernaIzq"], [1, "piernaDer"]]) {
    const pata = voxelizarParte(
      { w, h: altoPierna, d, resolucion: prenda.voxelResolucion, formaFn: formaPierna(prenda.detalle), zonaBase: "cuerpo", pivoteYBase: -altoPierna },
      colores, rnd, parteId,
    );
    voxeles = voxeles.concat(pata.map((v) => ({ ...v, pivote: lado < 0 ? "piernaIzq" : "piernaDer" })));
  }
  if (prenda.zonasFijas && prenda.zonasFijas.includes("remiendos")) {
    aplicarRemiendos(voxeles, colores.remiendos, rnd);
  }
  return voxeles;
}

function generarPrendaCabeza(prenda, material, colores, rnd, proporcionesRig) {
  const { ladoCabeza } = proporcionesRig;
  const bbox = { w: ladoCabeza * 1.18, h: ladoCabeza * 0.75, d: ladoCabeza * 1.18 };
  let voxeles = voxelizarParte(
    { ...bbox, resolucion: prenda.voxelResolucion, formaFn: formaGorro(prenda.detalle), zonaBase: "cuerpo", pivoteYBase: ladoCabeza * 0.55 },
    colores, rnd, "cabeza",
  );
  if (prenda.zonasFijas && prenda.zonasFijas.includes("cordon")) {
    voxeles = voxeles.concat(generarCordon(bbox, colores.cordon, rnd, "cabeza"));
  }
  return voxeles.map((v) => ({ ...v, pivote: "cabeza" }));
}

const GENERADORES_POR_TIPO = {
  camisa: generarPrendaTorso,
  pantalon: generarPrendaPiernas,
  gorro: generarPrendaCabeza,
};

/**
 * Genera una prenda concreta en vóxeles.
 * @param {string} prendaId - clave en ropa/catalogo/prendas.json
 * @param {object} opciones - { semilla, materialId, tintes, catalogos, morfologia }
 *   tintes: { [zona]: "#rrggbb" } — override del jugador para zonas tintables.
 *   morfologia: { altura?, corpulencia?, sexo? } — la MISMA morfología del
 *     personaje que recibe el rig del cliente. La prenda no tiene medidas
 *     propias: se genera sobre el cuerpo ya morfado + MARGEN_CAPA, por eso
 *     acopla igual en un personaje alto, bajo, ancho o estrecho. Omitida =
 *     talla base (factores neutros).
 */
function generarPrenda(prendaId, opciones) {
  const { catalogos, semilla, materialId, tintes, morfologia } = opciones;
  const prenda = catalogos.prendas[prendaId];
  if (!prenda) throw new Error(`Prenda desconocida: ${prendaId}`);
  const material = catalogos.materiales[materialId];
  if (!material) throw new Error(`Material desconocido: ${materialId}`);
  if (!prenda.materialesCompatibles.includes(materialId)) {
    throw new Error(`${materialId} no es compatible con ${prendaId} (admite: ${prenda.materialesCompatibles.join(", ")})`);
  }

  const rnd = crearPRNG(`${semilla}|${prendaId}|${materialId}`);
  const colores = resolverColoresPorZona(prenda, material, tintes, rnd);
  const generador = GENERADORES_POR_TIPO[prenda.tipoPrenda];
  if (!generador) throw new Error(`Sin generador para tipoPrenda: ${prenda.tipoPrenda}`);

  // El cuerpo primero, la ropa después: mismas medidas morfadas que usa el
  // rig para dibujar este personaje concreto — la prenda solo añade su
  // margen de capa encima, nunca decide tamaños por su cuenta.
  const cuerpo = aplicarMorfologia(catalogos.proporcionesRig, morfologia);

  const voxeles = generador(prenda, material, colores, rnd, cuerpo).map((v) => ({
    ...v,
    // slotCuerpo por defecto si el generador no fijó un pivote propio
    // (mangas/piernas/cabeza sí lo fijan; el resto cuelga del slot base).
    pivote: v.pivote || prenda.slotCuerpo,
  }));

  return {
    prendaId,
    materialId,
    slotCuerpo: prenda.slotCuerpo,
    colores,
    voxeles,
  };
}

module.exports = { generarPrenda, ajustarColor };
