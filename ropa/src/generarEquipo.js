"use strict";

// Generador procedural de EQUIPO en vóxeles — armadura/accesorios/mochilas
// que un jugador puede equipar en vivo (docs/GDD_Equipo.md), hermano de
// generarPrenda.js pero deliberadamente más simple: una prenda de ropa
// (camisa/pantalón/gorro) necesita silueta ajustada al cuerpo (mangas,
// perneras, vuelo del bajo); una hombrera, un anillo o una mochila son
// formas de bloque simples a un offset fijo del pivote del rig — no hace
// falta la maquinaria de voxelizarParte/formaFn de generarPrenda.js, así
// que este módulo no la reutiliza a propósito (evita una abstracción que
// no encaja, GDD_Bakeador_Interiores CLAUDE.md: "no diseñar para
// requisitos hipotéticos").
//
// Determinismo idéntico al resto del proyecto: mismo PRNG mulberry32
// (interiores/src/azar.js), misma idea de "variarColor" por vóxel que
// generarPrenda.js para que un bloque no quede plano.
//
// GEOMETRÍA POR SLOT (`POSICION_POR_SLOT`, más abajo) es CÓDIGO, no dato de
// catálogo — es un hecho estructural fijo del rig (a qué pivote(s) cuelga
// cada slot y en qué offset), no algo que crezca con el contenido; el
// catálogo (`ropa/catalogo/equipo.json`) solo declara tamaño/material/
// variantes por PIEZA, nunca su posición — mismo reparto de
// responsabilidades que "el catálogo coloca por id, el algoritmo decide
// cómo" del resto del proyecto (CLAUDE.md punto 2).

const { crearPRNG } = require("../../interiores/src/azar");

function ajustarColor(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const ajustar = (c) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  const r = ajustar((n >> 16) & 255);
  const g = ajustar((n >> 8) & 255);
  const b = ajustar(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function variarColor(hex, rnd, amplitud = 0.06) {
  return ajustarColor(hex, (rnd() - 0.5) * amplitud);
}

// Cada entrada: en qué pivote(s) cuelga el slot y la caja base (w,h,d en
// unidades de mundo) + offset (x,y,z LOCAL al pivote) para UN lado — los
// slots marcados `ambosLados:true` generan la misma caja reflejada en X
// para el pivote de la izquierda (mismo patrón que pantalón/mangas de
// generarPrenda.js: una sola pieza de catálogo, dos mitades del cuerpo).
// `y` sigue el mismo criterio que el resto del rig: 0 = el pivote mismo
// (hombro/cadera/cuello/muñeca), negativo = hacia el suelo.
const POSICION_POR_SLOT = {
  casco: { pivotes: ["cabeza"], caja: { w: 0.36, h: 0.14, d: 0.36 }, offset: { x: 0, y: 0.62, z: 0 } },
  mascara: { pivotes: ["cabeza"], caja: { w: 0.3, h: 0.16, d: 0.06 }, offset: { x: 0, y: 0.2, z: 0.16 } },
  gafas: { pivotes: ["cabeza"], caja: { w: 0.26, h: 0.05, d: 0.03 }, offset: { x: 0, y: 0.19, z: 0.17 } },
  pechera: { pivotes: ["torso"], caja: { w: 0.5, h: 0.5, d: 0.28 }, offset: { x: 0, y: 0.28, z: 0 } },
  brazos: { pivotes: ["brazoDer"], ambosLados: true, caja: { w: 0.16, h: 0.3, d: 0.2 }, offset: { x: 0, y: -0.2, z: 0 } },
  manos: { pivotes: ["manoDer"], ambosLados: true, caja: { w: 0.15, h: 0.18, d: 0.18 }, offset: { x: 0, y: -0.02, z: 0 } },
  piernas: { pivotes: ["piernaDer"], ambosLados: true, caja: { w: 0.19, h: 0.68, d: 0.23 }, offset: { x: 0, y: -0.34, z: 0 } },
  zapatos: { pivotes: ["piernaDer"], ambosLados: true, caja: { w: 0.19, h: 0.12, d: 0.26 }, offset: { x: 0, y: -0.68, z: 0.02 } },
  hombreras: { pivotes: ["brazoDer"], ambosLados: true, caja: { w: 0.24, h: 0.16, d: 0.24 }, offset: { x: 0, y: -0.02, z: 0 } },
  rodilleras: { pivotes: ["piernaDer"], ambosLados: true, caja: { w: 0.21, h: 0.12, d: 0.14 }, offset: { x: 0, y: -0.36, z: 0.1 } },
  coderas: { pivotes: ["brazoDer"], ambosLados: true, caja: { w: 0.16, h: 0.11, d: 0.16 }, offset: { x: 0, y: -0.22, z: 0 } },
  anilloIzquierdo: { pivotes: ["manoIzq"], caja: { w: 0.03, h: 0.03, d: 0.13 }, offset: { x: 0, y: -0.03, z: 0.05 } },
  anilloDerecho: { pivotes: ["manoDer"], caja: { w: 0.03, h: 0.03, d: 0.13 }, offset: { x: 0, y: -0.03, z: 0.05 } },
  brazalete: { pivotes: ["manoDer"], ambosLados: true, caja: { w: 0.15, h: 0.04, d: 0.15 }, offset: { x: 0, y: 0.03, z: 0 } },
  espalda: { pivotes: ["torso"], caja: { w: 0.34, h: 0.4, d: 0.16 }, offset: { x: 0, y: 0.2, z: -0.2 } },
  // Capa/manto (docs/GDD_Ropa_Procedural.md, pedido 2026-09-03: "capas pies
  // manos" como slots nuevos) — mismo pivote/lado que "espalda" (detrás del
  // torso) pero MÁS ALTA y ESTRECHA (cuelga hacia abajo como un manto, no un
  // bulto de mochila) para no confundirse visualmente; slot FÍSICO distinto
  // así que capa y mochila son compatibles a la vez, nunca se pisan.
  capa: { pivotes: ["torso"], caja: { w: 0.42, h: 0.62, d: 0.1 }, offset: { x: 0, y: 0.02, z: -0.22 } },
  cinturon: { pivotes: ["torso"], caja: { w: 0.14, h: 0.12, d: 0.1 }, offset: { x: 0.22, y: -0.02, z: 0.02 } },
  bandolera: { pivotes: ["torso"], caja: { w: 0.12, h: 0.42, d: 0.08 }, offset: { x: 0.16, y: 0, z: 0.14 } },
  manoPrincipal: { pivotes: ["manoDer"], caja: { w: 0.06, h: 0.3, d: 0.06 }, offset: { x: 0, y: -0.18, z: 0.06 } },
  manoSecundaria: { pivotes: ["manoIzq"], caja: { w: 0.06, h: 0.3, d: 0.06 }, offset: { x: 0, y: -0.18, z: 0.06 } },
};

const PIVOTE_ESPEJO = { brazoDer: "brazoIzq", piernaDer: "piernaIzq", manoDer: "manoIzq" };

function generarPieza(piezaId, opciones) {
  const { catalogos, semilla, materialId, slotFisico } = opciones;
  const pieza = catalogos.equipo[piezaId];
  if (!pieza) throw new Error(`Pieza de equipo desconocida: ${piezaId}`);
  const material = catalogos.materiales[materialId];
  if (!material) throw new Error(`Material desconocido: ${materialId}`);
  if (!pieza.materialesCompatibles.includes(materialId)) {
    throw new Error(`${materialId} no es compatible con ${piezaId} (admite: ${pieza.materialesCompatibles.join(", ")})`);
  }
  // slotFisico (opcional): el hueco REAL donde está equipada esta instancia
  // — necesario para slots genéricos como "anillo" (server/src/inventario/
  // inventario.ts: GRUPOS_SLOT), que admiten la MISMA pieza de catálogo en
  // más de un hueco físico (anilloIzquierdo/anilloDerecho); la geometría sí
  // depende de a qué mano va, así que sin esto no sabría qué pivote usar.
  // Ausente = el slot ya es 1:1 con la geometría (todo lo demás del catálogo).
  const posicion = POSICION_POR_SLOT[slotFisico || pieza.slotEquipo];
  if (!posicion) throw new Error(`Sin geometría definida para slot: ${slotFisico || pieza.slotEquipo}`);

  const rnd = crearPRNG(`${semilla}|${piezaId}|${materialId}`);
  const colorBase = ajustarColor(material.colorDebug, (rnd() - 0.5) * 0.1);
  const escala = pieza.tamano ?? 1;

  const voxeles = [];
  for (const pivoteBase of posicion.pivotes) {
    const lados = posicion.ambosLados ? [pivoteBase, PIVOTE_ESPEJO[pivoteBase]] : [pivoteBase];
    for (const pivote of lados) {
      const signoX = pivote === PIVOTE_ESPEJO[pivoteBase] ? -1 : 1;
      voxeles.push({
        x: posicion.offset.x * escala * signoX,
        y: posicion.offset.y,
        z: posicion.offset.z,
        tam: [posicion.caja.w * escala, posicion.caja.h * escala, posicion.caja.d * escala],
        color: variarColor(colorBase, rnd),
        pivote,
      });
    }
  }

  return { piezaId, materialId, slotEquipo: pieza.slotEquipo, voxeles };
}

module.exports = { generarPieza, POSICION_POR_SLOT, ajustarColor };
