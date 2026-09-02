"use strict";
// Generador de vóxeles de HERRAMIENTAS (items/catalogo/items.json,
// tipo:"herramienta", 71 ids) — HERRAMIENTA reutilizable, mismo patrón que
// generar_armas.js: arquetipos por silueta (mango+cabeza) + partes reales,
// exportación a .glb vía exportar_glb.js. Ver la cabecera de generar_armas.js
// para el pacto de alcance (esto es la herramienta; el bakeo de producción
// de los 71 ids lo lanza el streamer cuando decida).
//
// Las 71 herramientas reales del catálogo son sobre todo variaciones de
// "mango + cabeza de trabajo" (hacha/pico/martillo/cuchillo/tenazas...) —
// muchas comparten familia con las armas por el mismo motivo real: son la
// misma silueta de herramienta de mano de toda la vida. `familiaMaterial`
// aquí es el OFICIO ("herramienta_carpintero"...), no un material, así que
// la silueta se elige por palabra clave del id (agrupado en pocos arquetipos,
// regla 7 del CLAUDE.md — "las listas crecen, el código no") y el color por
// `colorDebug` como siempre.

const fs = require("fs");
const path = require("path");
const items = require("../items/catalogo/items.json");
const { sombrear, Builder, U, MADERA_MANGO, METAL_CLARO, METAL_OSCURO } = require("./itemsComun");

const IDS_HERRAMIENTA = Object.keys(items).filter((id) => items[id] && items[id].tipo === "herramienta");

function largoDe(v, factor = 0.9) {
  return Math.max(4, Math.round((v.huella[1] || 1) * U * factor));
}

/** Hacha/pico de mano: mismo esqueleto que generarHacha() de armas (mango +
 * cuña de cabeza), pero la cabeza es más pequeña y funcional, sin filo
 * "de guerra" resaltado — herramienta de trabajo, no de combate. */
function generarHachaHerramienta(v) {
  const largo = largoDe(v, 0.85);
  const gx = Math.max(3, Math.round(U * 0.4)), gz = Math.max(2, Math.round(U * 0.16));
  const b = Builder();
  const mangoW = Math.max(1, Math.round(gz * 0.7));
  b.caja(0, 0, 0, mangoW - 1, largo - 1, mangoW - 1, MADERA_MANGO);
  const cabezaY0 = Math.round(largo * 0.75), cabezaY1 = largo - 1;
  b.caja(mangoW - 1, cabezaY0, 0, gx - 1, cabezaY1, mangoW - 1, v.colorDebug);
  b.caja(mangoW - 1, Math.round((cabezaY0 + cabezaY1) / 2) - 1, 0, mangoW, Math.round((cabezaY0 + cabezaY1) / 2), mangoW - 1, sombrear(v.colorDebug, 0.6)); // ojo del hacha (donde encaja el mango)
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Pico de dos puntas: mango + cabeza alargada con dos puntas opuestas. */
function generarPico(v) {
  const largo = largoDe(v, 0.9);
  const gx = Math.max(6, Math.round(U * 0.9)), gz = Math.max(2, Math.round(U * 0.14));
  const b = Builder();
  const mangoW = Math.max(1, Math.round(gz * 0.7));
  const cx = Math.round(gx / 2);
  b.caja(cx - Math.round(mangoW / 2), 0, 0, cx + Math.round(mangoW / 2) - 1, Math.round(largo * 0.78) - 1, mangoW - 1, MADERA_MANGO);
  const cabezaY0 = Math.round(largo * 0.76), cabezaY1 = largo - 1;
  b.caja(0, cabezaY0, 0, Math.round(gx * 0.35), cabezaY1, mangoW - 1, v.colorDebug); // punta izquierda
  b.caja(gx - Math.round(gx * 0.35), cabezaY0, 0, gx - 1, cabezaY1, mangoW - 1, v.colorDebug); // punta derecha
  b.caja(Math.round(gx * 0.35), cabezaY0, 0, gx - Math.round(gx * 0.35) - 1, cabezaY1, mangoW - 1, sombrear(v.colorDebug, 0.85)); // cuerpo central
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Martillo/mazo: mango + cabeza rectangular perpendicular (cabeza plana a
 * un lado, contrapeso al otro — martillo de herrero/carpintero clásico). */
function generarMartillo(v) {
  const largo = largoDe(v, 1.0);
  const gx = Math.max(4, Math.round(U * 0.7)), gz = Math.max(2, Math.round(U * 0.18));
  const b = Builder();
  const mangoW = Math.max(1, Math.round(gz * 0.6));
  const cx = Math.round(gx / 2);
  b.caja(cx - Math.round(mangoW / 2), 0, 0, cx + Math.round(mangoW / 2) - 1, Math.round(largo * 0.7) - 1, mangoW - 1, MADERA_MANGO);
  const cabezaY0 = Math.round(largo * 0.68), cabezaY1 = largo - 1;
  b.caja(0, cabezaY0, 0, gx - 1, cabezaY1, gz - 1, v.colorDebug);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Cuchillo/hoz/podadera: mango corto + hoja curva o recta corta. Sirve
 * también para tijeras de una sola hoja aproximada (guadaña, hoz). */
function generarCuchillo(v, curvo) {
  const largo = Math.max(3, Math.round(U * 0.7));
  const gx = Math.max(2, Math.round(U * 0.22)), gz = Math.max(1, Math.round(U * 0.1));
  const b = Builder();
  const mangoH = Math.round(largo * 0.4);
  b.caja(0, 0, 0, gx - 1, mangoH - 1, gz - 1, MADERA_MANGO);
  const escalones = 4;
  for (let i = 0; i < escalones; i++) {
    const t = i / (escalones - 1);
    const inset = curvo ? Math.round(gx * 0.3 * Math.sin(t * Math.PI)) : 0;
    const y0 = mangoH + Math.round(((largo - mangoH) * i) / escalones);
    const y1 = mangoH + Math.round(((largo - mangoH) * (i + 1)) / escalones) - 1;
    b.caja(inset, y0, 0, gx - 1, Math.max(y0, y1), 0, v.colorDebug);
  }
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Tenazas: dos brazos articulados en un pivote — igual de reconocible
 * abiertas en V que cerradas, así que se modelan abiertas. */
function generarTenazas(v) {
  const largo = Math.max(4, Math.round(U * 0.8));
  const gx = Math.max(4, Math.round(U * 0.5)), gz = Math.max(1, Math.round(U * 0.1));
  const b = Builder();
  const pivoteY = Math.round(largo * 0.42);
  const cx = Math.round(gx / 2);
  b.caja(cx - 1, pivoteY, 0, cx, pivoteY + 1, gz - 1, METAL_OSCURO); // remache/pivote
  const escalones = 6;
  for (let i = 0; i < escalones; i++) {
    const t = i / (escalones - 1);
    const dx = Math.round(t * (cx - 1));
    // mangos (por debajo del pivote, hacia dentro) y mordazas (por encima, hacia fuera)
    const yMango = Math.round((pivoteY * i) / escalones);
    b.caja(cx - 1 - Math.round(dx * 0.4), yMango, 0, cx - Math.round(dx * 0.4), yMango + Math.max(1, Math.round(largo * 0.08)), gz - 1, v.colorDebug);
    b.caja(cx + Math.round(dx * 0.4) - 1, yMango, 0, cx + Math.round(dx * 0.4), yMango + Math.max(1, Math.round(largo * 0.08)), gz - 1, v.colorDebug);
    const yMord = largo - 1 - Math.round(((largo - pivoteY) * i) / escalones);
    b.caja(cx - 1 - dx, yMord - Math.max(1, Math.round(largo * 0.06)), 0, cx - dx, yMord, gz - 1, sombrear(v.colorDebug, 1.1));
    b.caja(cx + dx - 1, yMord - Math.max(1, Math.round(largo * 0.06)), 0, cx + dx, yMord, gz - 1, sombrear(v.colorDebug, 1.1));
  }
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Tijeras: variante cerrada de generarTenazas, con hojas más finas y punta. */
function generarTijeras(v) {
  const m = generarTenazas(v);
  return m;
}

/** Vara larga y delgada — caña de pescar y similares (fibra de vidrio/metal
 * flexible aproximada por un simple ahusado hacia la punta). */
function generarVara(v) {
  const largo = largoDe(v, 0.95);
  const gx = Math.max(1, Math.round(U * 0.1)), gz = gx;
  const b = Builder();
  const tramos = 3;
  for (let i = 0; i < tramos; i++) {
    const y0 = Math.round((largo * i) / tramos), y1 = Math.round((largo * (i + 1)) / tramos) - 1;
    const w = Math.max(1, gx - i);
    b.caja(0, y0, 0, w - 1, y1, w - 1, i === 0 ? MADERA_MANGO : v.colorDebug);
  }
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Herramienta de precisión pequeña (formón, compás, calibrador, cincel,
 * cepillo de carpintero...): mango corto + punta/hoja fina — la misma
 * silueta de "lápiz grueso con punta metálica" cubre a todas con calidad
 * suficiente sin necesitar un arquetipo por herramienta. */
function generarPrecision(v) {
  const largo = Math.max(3, Math.round(U * 0.55));
  const gx = Math.max(1, Math.round(U * 0.13)), gz = gx;
  const b = Builder();
  const mangoH = Math.round(largo * 0.6);
  b.caja(0, 0, 0, gx - 1, mangoH - 1, gz - 1, MADERA_MANGO);
  b.caja(Math.round(gx * 0.2), mangoH, Math.round(gz * 0.2), gx - 1 - Math.round(gx * 0.2), largo - 1, gz - 1 - Math.round(gz * 0.2), v.colorDebug);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Aguja/lezna/punzón: vara muy fina, casi un alambre. */
function generarAguja(v) {
  const largo = Math.max(3, Math.round(U * 0.45));
  const gx = Math.max(1, Math.round(U * 0.06)), gz = gx;
  const b = Builder();
  b.caja(0, 0, 0, gx - 1, Math.round(largo * 0.35) - 1, gz - 1, MADERA_MANGO);
  b.caja(0, Math.round(largo * 0.35), 0, gx - 1, largo - 1, gz - 1, v.colorDebug);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Antorcha portátil: asta + cabeza de llama (mismo espíritu que el
 * generarFuegoPared de generar_modelos.js, pero de mano y sin escuadra de
 * pared). */
function generarAntorcha() {
  const largo = Math.max(6, Math.round(U * 1.0));
  const gx = Math.max(2, Math.round(U * 0.16)), gz = gx;
  const b = Builder();
  b.caja(0, 0, 0, gx - 1, Math.round(largo * 0.75) - 1, gz - 1, MADERA_MANGO);
  const capY0 = Math.round(largo * 0.7);
  b.caja(0, capY0, 0, gx - 1, capY0 + Math.max(1, Math.round(largo * 0.06)), gz - 1, "#8a4a2a"); // trapo empapado
  b.caja(0, capY0 + Math.max(1, Math.round(largo * 0.07)), 0, gx - 1, largo - Math.round(largo * 0.35), gz - 1, "#ffb545"); // llama
  b.caja(Math.round(gx * 0.2), largo - Math.round(largo * 0.35) + 1, Math.round(gz * 0.2), gx - 1 - Math.round(gx * 0.2), largo - 1, gz - 1 - Math.round(gz * 0.2), "#fff4c2"); // núcleo
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Recipiente pequeño con asa/mango — cubo de ordeño, balanza, mortero. */
function generarRecipientePequeno(v) {
  const gx = Math.max(4, Math.round(U * 0.6)), gz = gx, gy = Math.max(3, Math.round(U * 0.5));
  const b = Builder();
  b.caja(0, 0, 0, gx - 1, gy - 1, gz - 1, v.colorDebug);
  const rim = Math.max(1, Math.round(U * 0.06));
  b.caja(rim, Math.round(gy * 0.3), rim, gx - 1 - rim, gy - 1, gz - 1 - rim, sombrear(v.colorDebug, 0.7));
  b.caja(-1, gy, Math.round(gz / 2) - 1, gx, gy + Math.max(1, Math.round(U * 0.18)), Math.round(gz / 2), METAL_OSCURO); // asa en arco
  return { grid: [gx, gy + Math.max(1, Math.round(U * 0.18)) + 1, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Fallback genérico — mango + cabeza en bloque: mecanismos complejos
 * (horca trilladora, tensor de cepos, despalilladora, instrumental de
 * cirugía en su estuche...) que no encajan en una silueta más específica
 * sin inventar detalle no pedido; sigue siendo mango+cabeza real, no una
 * caja única sin forma. */
function generarGenerico(v) {
  const largo = largoDe(v, 0.8);
  const gx = Math.max(3, Math.round(U * 0.4)), gz = Math.max(2, Math.round(U * 0.3));
  const b = Builder();
  const mangoH = Math.round(largo * 0.6);
  b.caja(Math.round(gx * 0.3), 0, Math.round(gz * 0.3), gx - 1 - Math.round(gx * 0.3), mangoH - 1, gz - 1 - Math.round(gz * 0.3), MADERA_MANGO);
  b.caja(0, mangoH, 0, gx - 1, largo - 1, gz - 1, v.colorDebug);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

// --- clasificador (vocabulario de sufijo del id, agrupado en pocos arquetipos) ---

const REGLAS = [
  [/^hacha_|^azada_/, "HACHA"], // azada: mismo mango+cabeza plana en ángulo que un hacha de mano.
  [/^pico_/, "PICO"],
  [/^martillo_|^maceta_/, "MARTILLO"],
  [/^tenazas_/, "TENAZAS"],
  [/^tijera/, "TIJERAS"],
  [/^cana_/, "VARA"],
  [/^antorcha_portatil$/, "ANTORCHA"],
  [/^cubo_ordeno$|^balanza_botica$|^mortero_piedra_herbolario$|^kit_ordeno_cepillo$/, "RECIPIENTE"],
  [/^cuchillo|^cuchilla|^daga_despiece|^podadera|^hoz_|^guadana_|^lezna$/, "CUCHILLO"],
  [/^aguja_|^punzon_/, "AGUJA"],
  [/^cepillo_carpintero$|^formon_|^tronzador_|^compas_|^escuadra_|^taladro_|^calibrador_|^juego_tallas|^cincel_|^engastador_|^puntero_lapidaria$|^microcincel_|^lente_|^pluma_/, "PRECISION"],
];

function clasificarHerramienta(id) {
  for (const [re, arq] of REGLAS) if (re.test(id)) return arq;
  return "GENERICO";
}

const ARQUETIPO_FN = {
  HACHA: generarHachaHerramienta,
  PICO: generarPico,
  MARTILLO: generarMartillo,
  TENAZAS: generarTenazas,
  TIJERAS: generarTijeras,
  VARA: generarVara,
  ANTORCHA: generarAntorcha,
  RECIPIENTE: generarRecipientePequeno,
  CUCHILLO: (v, id) => generarCuchillo(v, /hoz_|guadana_|podadera/.test(id)),
  AGUJA: generarAguja,
  PRECISION: generarPrecision,
  GENERICO: generarGenerico,
};

function generarHerramienta(id) {
  const v = items[id];
  if (!v) throw new Error(`herramienta desconocida en catálogo: ${id}`);
  const arq = clasificarHerramienta(id);
  const modelo = ARQUETIPO_FN[arq](v, id);
  return { nombre: v.nombre || id, arquetipo: arq, resolucion: U, familiaMaterial: v.familiaMaterial, ...modelo };
}

module.exports = { IDS_HERRAMIENTA, clasificarHerramienta, generarHerramienta, ARQUETIPO_FN, U };

if (require.main === module) {
  const muestra = process.argv.includes("--muestra");
  const ids = muestra
    ? ["hacha_talar", "pico_minero", "martillo_forja_hierro", "cuchillo_desollar", "tenazas_cuello_largo", "cana_pesca", "pluma_tintero"]
    : IDS_HERRAMIENTA;
  const resultado = {};
  for (const id of ids) resultado[id] = generarHerramienta(id);
  const salida = path.join(__dirname, muestra ? "output/herramientas_muestra.json" : "herramientas_generadas.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify(resultado));
  console.log(`Generadas ${ids.length} herramientas -> ${salida}`);
}
