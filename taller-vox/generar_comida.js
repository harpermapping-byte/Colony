"use strict";
// Generador de vóxeles de COMIDA/CONSUMIBLES (items/catalogo/items.json,
// tipo:"consumible", 31 ids) — HERRAMIENTA reutilizable, mismo patrón que
// generar_armas.js/generar_herramientas.js/generar_objetos.js. Ver cabecera
// de generar_armas.js para el pacto de alcance (esto es la herramienta; el
// bakeo de producción lo lanza el streamer cuando decida).
//
// Consumibles no necesitan el mismo nivel de detalle que un arma (pedido
// explícito): plato con comida encima, jarra, venda enrollada... arquetipos
// simples pero reales (2+ piezas, no una caja plana única).

const fs = require("fs");
const path = require("path");
const items = require("../items/catalogo/items.json");
const { sombrear, Builder, U } = require("./itemsComun");

const IDS_CONSUMIBLE = Object.keys(items).filter((id) => items[id] && items[id].tipo === "consumible");

/** Plato con comida encima: disco de plato + montículo de color de la comida. */
function generarPlatoComida(v) {
  const gxz = Math.max(3, Math.round(U * 0.75));
  const platoH = Math.max(1, Math.round(U * 0.1));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, platoH - 1, gxz - 1, "#e8e4dc");
  const inset = Math.max(1, Math.round(gxz * 0.18));
  const comidaH = Math.max(1, Math.round(U * 0.22));
  b.caja(inset, platoH, inset, gxz - 1 - inset, platoH + comidaH - 1, gxz - 1 - inset, v.colorDebug);
  b.caja(inset + 1, platoH + comidaH, inset + 1, gxz - 2 - inset, platoH + comidaH, gxz - 2 - inset, sombrear(v.colorDebug, 1.2)); // brillo/glaseado encima
  return { grid: [gxz, platoH + comidaH + 1, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Pan entero: hogaza abombada; rebanada: cuña plana más fina del mismo tono. */
function generarPan(id, v) {
  const rebanada = id === "rebanada_pan";
  const gxz = Math.max(3, Math.round(U * (rebanada ? 0.4 : 0.75)));
  const gy = Math.max(2, Math.round(U * (rebanada ? 0.55 : 0.4)));
  const b = Builder();
  const capas = 3;
  for (let i = 0; i < capas; i++) {
    const t = i / (capas - 1);
    const inset = Math.round((1 - Math.sin(t * Math.PI * 0.5 + Math.PI * 0.5)) * gxz * 0.15);
    const y0 = Math.round((gy * i) / capas), y1 = Math.round((gy * (i + 1)) / capas) - 1;
    b.caja(inset, y0, inset, gxz - 1 - inset, y1, gxz - 1 - inset, i === capas - 1 ? sombrear(v.colorDebug, 1.1) : v.colorDebug);
  }
  return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Bebida (agua/infusión/jarabe): jarra pequeña con asa — mismo esquema que
 * las vasijas de generar_objetos.js pero autocontenido (sin depender de él). */
function generarBebida(v) {
  const gxz = Math.max(3, Math.round(U * 0.5));
  const gy = Math.max(3, Math.round(U * 0.65));
  const b = Builder();
  const capas = 4;
  for (let i = 0; i < capas; i++) {
    const t = i / (capas - 1);
    const inset = Math.round((1 - t) * gxz * 0.12);
    const y0 = Math.round((gy * i) / capas), y1 = Math.round((gy * (i + 1)) / capas) - 1;
    b.caja(inset, y0, inset, gxz - 1 - inset, y1, gxz - 1 - inset, v.colorDebug);
  }
  b.caja(gxz, Math.round(gy * 0.3), Math.round(gxz / 2) - 1, gxz + Math.max(1, Math.round(U * 0.1)), Math.round(gy * 0.7), Math.round(gxz / 2), sombrear(v.colorDebug, 0.6));
  return { grid: [gxz + Math.max(1, Math.round(U * 0.1)) + 1, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Frasco/poción: botella estrecha con tapón y líquido de color. */
function generarFrasco(v) {
  const gxz = Math.max(2, Math.round(U * 0.32));
  const cuelloH = Math.max(1, Math.round(U * 0.18));
  const cuerpoH = Math.max(2, Math.round(U * 0.42));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, cuerpoH - 1, gxz - 1, sombrear(v.colorDebug, 0.55)); // vidrio
  const inset = 1;
  b.caja(inset, 1, inset, gxz - 2 - inset, cuerpoH - 2, gxz - 2 - inset, v.colorDebug); // líquido visible
  const cuelloW = Math.max(1, Math.round(gxz * 0.4));
  const cx = Math.round(gxz / 2);
  b.caja(cx - Math.round(cuelloW / 2), cuerpoH, cx - Math.round(cuelloW / 2), cx - Math.round(cuelloW / 2) + cuelloW - 1, cuerpoH + cuelloH - 1, cx - Math.round(cuelloW / 2) + cuelloW - 1, "#8a5a2a"); // corcho
  return { grid: [gxz, cuerpoH + cuelloH, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Vendaje/entablillado/prótesis: rollo de tela (venda) o listón (tablilla/prótesis). */
function generarVendaje(id, v) {
  const b = Builder();
  if (id === "venda") {
    const largo = Math.max(4, Math.round(U * 0.7));
    const r = Math.max(2, Math.round(U * 0.24));
    b.caja(0, 0, 0, largo - 1, r * 2 - 1, r * 2 - 1, v.colorDebug);
    b.caja(largo, 0, Math.round(r * 0.4), largo, r * 2 - 1, r * 2 - 1 - Math.round(r * 0.4), sombrear(v.colorDebug, 0.6)); // corte visible del rollo en el extremo
    return { grid: [largo + 1, r * 2, r * 2], paleta: b.paleta, cajas: b.cajas };
  }
  // tablilla / prótesis: listón alargado con dos ataduras
  const largo = Math.max(4, Math.round(U * 0.8));
  const ancho = Math.max(1, Math.round(U * 0.22));
  b.caja(0, 0, 0, largo - 1, ancho - 1, Math.max(1, Math.round(U * 0.1)) - 1, v.colorDebug);
  for (const y of [Math.round(largo * 0.25), Math.round(largo * 0.75)]) {
    b.caja(y - 1, -1, 0, y, ancho, Math.max(1, Math.round(U * 0.1)) - 1, "#c9a878"); // atadura
  }
  return { grid: [largo, ancho, Math.max(1, Math.round(U * 0.1))], paleta: b.paleta, cajas: b.cajas };
}

/** Bloque compacto (queso/mantequilla): cuña o pastilla, con una cuña cortada. */
function generarBloque(v) {
  const gxz = Math.max(3, Math.round(U * 0.55));
  const gy = Math.max(2, Math.round(U * 0.4));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, gy - 1, gxz - 1, v.colorDebug);
  b.caja(Math.round(gxz * 0.15), gy, Math.round(gxz * 0.15), gxz - 1 - Math.round(gxz * 0.15), gy, gxz - 1 - Math.round(gxz * 0.15), sombrear(v.colorDebug, 1.15)); // corteza/superficie
  return { grid: [gxz, gy + 1, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Ración envuelta (viaje): paquete atado con cordel en cruz. */
function generarRacion(v) {
  const gxz = Math.max(3, Math.round(U * 0.55));
  const gy = Math.max(2, Math.round(U * 0.35));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, gy - 1, gxz - 1, v.colorDebug);
  const cx = Math.round(gxz / 2);
  b.caja(cx - 1, 0, 0, cx, gy, gxz - 1, sombrear(v.colorDebug, 0.55)); // cordel eje x
  b.caja(0, 0, cx - 1, gxz - 1, gy, cx, sombrear(v.colorDebug, 0.55)); // cordel eje z
  return { grid: [gxz, gy + 1, gxz], paleta: b.paleta, cajas: b.cajas };
}

// --- clasificador ------------------------------------------------------------

const IDS_PLATO = new Set([
  "asado_carne_roja", "asado_carne_blanca", "asado_carne_caza_mayor", "asado_carne_exotica",
  "asado_pescado_rio", "asado_pescado_lago", "asado_pescado_mar", "asado_marisco", "asado_huevo",
  "baya_cocinado", "fruta_cocinado", "fruto_seco_cocinado", "trigo_cocinado", "zanahoria_cocinado",
  "tomate_cocinado", "fresa_cocinado", "miel_cocinado",
]);
const IDS_PAN = new Set(["pan", "rebanada_pan"]);
const IDS_BEBIDA = new Set(["jarra_agua", "infusion_energia", "jarabe_catarro"]);
// docs/GDD_Pociones.md (ampliación 2026-09-01): 5 variantes de color según
// ingredientes (alquimia.ts::colorPocion) — cada una es una entrada real de
// catálogo con su propio colorDebug, así que generarFrasco (que ya pinta el
// líquido directo de v.colorDebug) las diferencia gratis, sin tocar código.
const IDS_FRASCO = new Set([
  "pocion_alquimica_clara", "pocion_alquimica_toxica", "pocion_alquimica_vital",
  "pocion_alquimica_inestable", "pocion_alquimica_radiante", "unguento",
]);
const IDS_VENDAJE = new Set(["venda", "tablilla", "protesis_madera", "protesis_metal"]);
const IDS_BLOQUE = new Set(["queso", "mantequilla"]);
const IDS_RACION = new Set(["racion_viaje"]);

function clasificarComida(id) {
  if (IDS_PLATO.has(id)) return "PLATO";
  if (IDS_PAN.has(id)) return "PAN";
  if (IDS_BEBIDA.has(id)) return "BEBIDA";
  if (IDS_FRASCO.has(id)) return "FRASCO";
  if (IDS_VENDAJE.has(id)) return "VENDAJE";
  if (IDS_BLOQUE.has(id)) return "BLOQUE";
  if (IDS_RACION.has(id)) return "RACION";
  return "PLATO"; // fallback razonable para cualquier comida nueva no clasificada
}

const ARQUETIPO_FN = {
  PLATO: (v) => generarPlatoComida(v),
  PAN: (v, id) => generarPan(id, v),
  BEBIDA: (v) => generarBebida(v),
  FRASCO: (v) => generarFrasco(v),
  VENDAJE: (v, id) => generarVendaje(id, v),
  BLOQUE: (v) => generarBloque(v),
  RACION: (v) => generarRacion(v),
};

function generarComida(id) {
  const v = items[id];
  if (!v) throw new Error(`consumible desconocido en catálogo: ${id}`);
  const arq = clasificarComida(id);
  const modelo = ARQUETIPO_FN[arq](v, id);
  return { nombre: v.nombre || id, arquetipo: arq, resolucion: U, ...modelo };
}

module.exports = { IDS_CONSUMIBLE, clasificarComida, generarComida, ARQUETIPO_FN, U };

if (require.main === module) {
  const muestra = process.argv.includes("--muestra");
  const ids = muestra
    ? ["asado_carne_roja", "pan", "jarra_agua", "pocion_alquimica_clara", "pocion_alquimica_toxica", "pocion_alquimica_radiante", "venda", "queso"]
    : IDS_CONSUMIBLE;
  const resultado = {};
  for (const id of ids) resultado[id] = generarComida(id);
  const salida = path.join(__dirname, muestra ? "output/comida_muestra.json" : "comida_generada.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify(resultado));
  console.log(`Generados ${ids.length} consumibles -> ${salida}`);
}
