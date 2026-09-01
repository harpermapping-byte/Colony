"use strict";
// Generador de vóxeles de ARMAS (items/catalogo/items.json, tipo:"arma",
// 19 ids) — HERRAMIENTA reutilizable, mismo patrón que generar_modelos.js
// (mobiliario) y generar_edificio.js (edificios): arquetipos por silueta +
// partes reales (mango/guarda/hoja o mango/cabeza, no una caja única) +
// exportación a .glb vía exportar_glb.js.
//
// IMPORTANTE (pedido 2026-09-01): este archivo es LA HERRAMIENTA, no un
// bakeo de producción. El bakeo real (generar+aprobar los 19 .glb finales
// y subirlos a assets/armas/) lo lanza el streamer cuando decida — aquí
// solo se demuestra con una muestra pequeña (ver bloque `if (require.main)`
// al final) que el generador funciona para el catálogo completo.
//
// Mecanismo de variación (igual criterio que resolverVariante() en
// generar_modelos.js): el color/material sale de `colorDebug` — el campo
// YA estructurado del catálogo, nunca inventado — y la longitud/silueta de
// `huella` (huella[1] = "alto" en la rejilla de inventario correlaciona ya
// con el tamaño real del arma: daga 1x1 corta, espada_larga 1x2 media,
// lanza 1x3 larga). Las variantes "_bonificada"/"_bonificado" comparten
// colorDebug/huella EXACTOS con su base en el catálogo (nota explícita:
// "mismo aspecto") — este generador no necesita ningún caso especial para
// que salgan idénticas: es una consecuencia natural de leer esos campos.

const fs = require("fs");
const path = require("path");
const items = require("../items/catalogo/items.json");
const { sombrear, Builder, U, MADERA_MANGO, CUERO_MANGO, METAL_OSCURO, METAL_CLARO } = require("./itemsComun");

const IDS_ARMA = Object.keys(items).filter((id) => items[id] && items[id].tipo === "arma");

// --- arquetipos -------------------------------------------------------------

/** Espada/daga: pomo + mango + guarda travesaña + hoja ahusada en 2 escalones. */
function generarFilo(v) {
  const largo = Math.max(3, Math.round(v.huella[1] * U * 0.85));
  const gx = Math.max(3, Math.round(U * 0.28)), gz = Math.max(2, Math.round(U * 0.16));
  const b = Builder();
  const hoja = v.colorDebug, metal = sombrear(hoja, 0.7), mango = MADERA_MANGO;
  const cx = Math.round(gx / 2);
  const pomoH = Math.max(1, Math.round(largo * 0.08));
  const mangoH = Math.max(2, Math.round(largo * 0.22));
  const guardaH = Math.max(1, Math.round(largo * 0.04));
  const hojaY0 = pomoH + mangoH + guardaH;
  // pomo (remate esférico aprox.)
  b.caja(cx - 1, 0, 0, cx, pomoH - 1, gz - 1, metal);
  // mango envuelto en cuero
  b.caja(cx - 1, pomoH, 0, cx, pomoH + mangoH - 1, gz - 1, mango);
  // guarda: travesaño que sobresale a ambos lados del mango
  b.caja(0, pomoH + mangoH, 0, gx - 1, pomoH + mangoH + guardaH - 1, gz - 1, metal);
  // hoja: dos escalones que se estrechan hacia la punta
  const hojaLargo = largo - hojaY0;
  const anchoBase = Math.max(2, Math.round(gx * 0.7));
  const y1 = hojaY0 + Math.round(hojaLargo * 0.7);
  b.caja(cx - Math.round(anchoBase / 2), hojaY0, Math.round(gz * 0.3), cx - Math.round(anchoBase / 2) + anchoBase - 1, y1, Math.round(gz * 0.3) + Math.max(1, Math.round(gz * 0.4)), hoja);
  b.caja(cx - Math.round(anchoBase / 4), y1 + 1, Math.round(gz * 0.35), cx - Math.round(anchoBase / 4) + Math.max(1, Math.round(anchoBase / 2)) - 1, largo - 1, Math.round(gz * 0.35) + Math.max(1, Math.round(gz * 0.3)), hoja);
  // filo más claro en un canto de la hoja
  b.caja(cx - Math.round(anchoBase / 2), hojaY0, Math.round(gz * 0.3), cx - Math.round(anchoBase / 2), largo - 1, Math.round(gz * 0.3), sombrear(hoja, 1.25));
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Hacha/pico de combate: mango largo + cabeza (cuña) a un lado cerca de la punta. */
function generarHacha(v) {
  const largo = Math.max(4, Math.round(v.huella[1] * U * 0.9));
  const gx = Math.max(4, Math.round(U * 0.55)), gz = Math.max(2, Math.round(U * 0.16));
  const b = Builder();
  const cabeza = v.colorDebug, mango = MADERA_MANGO;
  const ejeX = Math.round(gz / 2); // el mango va centrado en z, cerca de x=0
  const mangoW = Math.max(1, Math.round(gz * 0.7));
  b.caja(0, 0, 0, mangoW - 1, largo - 1, mangoW - 1, mango);
  // cabeza de hacha: cuña que crece hacia +x cerca de la punta superior
  const cabezaY0 = Math.round(largo * 0.72), cabezaY1 = largo - 1;
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    const x1 = Math.round(mangoW + t * (gx - mangoW));
    const y0 = cabezaY0 + Math.round((cabezaY1 - cabezaY0) * (i / 3));
    const y1 = cabezaY0 + Math.round((cabezaY1 - cabezaY0) * ((i + 1) / 3));
    b.caja(mangoW - 1, y0, 0, x1, y1, mangoW - 1, i === 2 ? sombrear(cabeza, 1.2) : cabeza);
  }
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Maza de guerra: mango + cabeza cilíndrica con 4 aletas (flanges) radiales. */
function generarMaza(v) {
  const largo = Math.max(4, Math.round(v.huella[1] * U * 0.9));
  const gx = Math.max(4, Math.round(U * 0.4)), gz = Math.max(4, Math.round(U * 0.4));
  const b = Builder();
  const metal = v.colorDebug, mango = MADERA_MANGO;
  const cx = Math.round(gx / 2), cz = Math.round(gz / 2);
  const mangoW = Math.max(1, Math.round(Math.min(gx, gz) * 0.22));
  b.caja(cx - mangoW, 0, cz - mangoW, cx + mangoW - 1, Math.round(largo * 0.68) - 1, cz + mangoW - 1, mango);
  const cabezaY0 = Math.round(largo * 0.66), cabezaY1 = largo - 1;
  const r = Math.max(2, Math.round(Math.min(gx, gz) * 0.32));
  // cuerpo cilíndrico aproximado por un cubo central
  b.caja(cx - r, cabezaY0, cz - r, cx + r - 1, cabezaY1, cz + r - 1, sombrear(metal, 0.85));
  // 4 aletas (flanges) que sobresalen del cuerpo
  b.caja(0, cabezaY0, cz - 1, gx - 1, cabezaY1, cz, metal);
  b.caja(cx - 1, cabezaY0, 0, cx, cabezaY1, gz - 1, metal);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Lanza: asta larga y delgada + punta triangular (2 escalones) en la cabeza. */
function generarLanza(v) {
  const largo = Math.max(6, Math.round(v.huella[1] * U * 0.95));
  const gx = Math.max(2, Math.round(U * 0.16)), gz = Math.max(2, Math.round(U * 0.16));
  const b = Builder();
  const madera = v.colorDebug, metal = METAL_CLARO;
  b.caja(0, 0, 0, gx - 1, Math.round(largo * 0.86) - 1, gz - 1, madera);
  const puntaY0 = Math.round(largo * 0.86);
  const anchoPunta = Math.max(2, Math.round(gx * 2.2));
  const cx = Math.round(gx / 2);
  b.caja(cx - Math.round(anchoPunta / 2), puntaY0, cz0(gz), cx - Math.round(anchoPunta / 2) + anchoPunta - 1, puntaY0 + Math.round((largo - puntaY0) * 0.5), cz0(gz) + Math.max(1, Math.round(gz * 0.6)), metal);
  b.caja(cx - Math.round(anchoPunta / 4), puntaY0 + Math.round((largo - puntaY0) * 0.5), cz0(gz), cx - Math.round(anchoPunta / 4) + Math.max(1, Math.round(anchoPunta / 2)), largo - 1, cz0(gz) + Math.max(1, Math.round(gz * 0.4)), metal);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
  function cz0(gzv) { return Math.round(gzv * 0.2); }
}

/** Arco (corto/largo): vara curva (escalones que se desplazan en z, igual
 * técnica que el atril de generar_modelos.js) + cuerda recta tensada. */
function generarArco(v) {
  const largo = Math.max(6, Math.round(v.huella[1] * U * 0.95));
  const curvatura = Math.max(2, Math.round(U * 0.22));
  const gx = Math.max(3, Math.round(U * 0.14));
  const gz = curvatura * 2 + gx;
  const b = Builder();
  const madera = v.colorDebug, cuerda = "#e8ddc0";
  const escalones = Math.max(8, Math.round(largo * 0.6));
  for (let i = 0; i < escalones; i++) {
    const y0 = Math.round((largo * i) / escalones);
    const y1 = Math.round((largo * (i + 1)) / escalones) - 1;
    // curva simétrica: máxima flexión en el centro (seno), 0 en las puntas
    const t = i / (escalones - 1);
    const bulge = Math.sin(t * Math.PI);
    const z = Math.round(curvatura * (1 - bulge));
    b.caja(0, y0, z, gx - 1, Math.max(y0, y1), z + gx - 1, madera);
  }
  // cuerda: línea recta de punta a punta, por delante de la panza del arco
  b.caja(Math.round(gx * 0.3), 0, curvatura + gx, Math.round(gx * 0.3) + Math.max(1, Math.round(gx * 0.3)), largo - 1, curvatura + gx, cuerda);
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Honda: bolsa de cuero ancha y plana + dos cordones que suben desde ella. */
function generarHonda(v) {
  const largo = Math.max(4, Math.round(U * 0.9));
  const gx = Math.max(3, Math.round(U * 0.5)), gz = Math.max(1, Math.round(U * 0.1));
  const b = Builder();
  const cuero = v.colorDebug;
  const bolsaY0 = Math.round(largo * 0.32), bolsaY1 = Math.round(largo * 0.52);
  b.caja(0, bolsaY0, 0, gx - 1, bolsaY1, gz - 1, cuero);
  b.caja(0, bolsaY0 - Math.round(largo * 0.06), 0, Math.max(0, Math.round(gx * 0.15)), bolsaY0 - 1, gz - 1, sombrear(cuero, 0.8));
  b.caja(gx - 1 - Math.round(gx * 0.15), bolsaY0 - Math.round(largo * 0.06), 0, gx - 1, bolsaY0 - 1, gz - 1, sombrear(cuero, 0.8));
  // cordones: cada uno sube desde una punta de la bolsa hasta el extremo del asta
  b.caja(0, 0, 0, Math.max(0, Math.round(gx * 0.1)), bolsaY0 - Math.round(largo * 0.06) - 1, gz - 1, sombrear(cuero, 0.7));
  b.caja(gx - 1 - Math.round(gx * 0.1), bolsaY1 + 1, 0, gx - 1, largo - 1, gz - 1, sombrear(cuero, 0.7));
  return { grid: [gx, largo, gz], paleta: b.paleta, cajas: b.cajas };
}

/** Ballesta: culata/caña horizontal + arco corto atravesado + gatillo. */
function generarBallesta(v) {
  const largoCana = Math.max(6, Math.round(v.huella[1] * U * 1.1));
  const anchoArco = Math.max(6, Math.round(U * 1.0));
  const gy = Math.max(3, Math.round(U * 0.24));
  const b = Builder();
  const madera = v.colorDebug, metal = METAL_OSCURO;
  const canaZ0 = Math.round(anchoArco / 2) - 1, canaZ1 = canaZ0 + 2;
  // culata/caña, tumbada a lo largo del eje z (perfil visto desde el lateral)
  b.caja(0, 0, canaZ0, gy - 1, gy - 1, canaZ1, madera);
  // arco corto, atravesado en el extremo delantero de la caña
  const arcoX0 = gy - 2, arcoX1 = gy;
  b.caja(arcoX0, 0, 0, arcoX1, gy - 1, Math.round(anchoArco * 0.12), metal);
  b.caja(arcoX0, 0, anchoArco - Math.round(anchoArco * 0.12) - 1, arcoX1, gy - 1, anchoArco - 1, metal);
  b.caja(arcoX0, 0, Math.round(anchoArco * 0.12), arcoX1, 1, anchoArco - Math.round(anchoArco * 0.12) - 1, "#e8ddc0"); // cuerda
  // gatillo/mecanismo bajo la culata, hacia atrás
  b.caja(0, -Math.round(gy * 0.4), canaZ0, 1, -1, canaZ1, sombrear(metal, 1.3));
  return { grid: [gy + 1, gy, anchoArco], paleta: b.paleta, cajas: b.cajas, offsetY: Math.round(gy * 0.4) };
}

// --- clasificador ------------------------------------------------------------

function clasificarArma(id) {
  if (id.startsWith("daga") || id.startsWith("espada")) return "FILO";
  if (id.startsWith("hacha")) return "HACHA";
  if (id.startsWith("maza")) return "MAZA";
  if (id.startsWith("lanza")) return "LANZA";
  if (id.startsWith("arco")) return "ARCO";
  if (id.startsWith("honda")) return "HONDA";
  if (id.startsWith("ballesta")) return "BALLESTA";
  return "FILO"; // fallback razonable: cualquier arma nueva de mano corta
}

const ARQUETIPO_FN = {
  FILO: generarFilo,
  HACHA: generarHacha,
  MAZA: generarMaza,
  LANZA: generarLanza,
  ARCO: generarArco,
  HONDA: generarHonda,
  BALLESTA: generarBallesta,
};

function generarArma(id) {
  const v = items[id];
  if (!v) throw new Error(`arma desconocida en catálogo: ${id}`);
  const arq = clasificarArma(id);
  const modelo = ARQUETIPO_FN[arq](v);
  return { nombre: v.nombre || id, arquetipo: arq, resolucion: U, familiaMaterial: v.familiaMaterial, ...modelo };
}

module.exports = { IDS_ARMA, clasificarArma, generarArma, ARQUETIPO_FN, U };

if (require.main === module) {
  const muestra = process.argv.includes("--muestra");
  const ids = muestra ? ["daga", "espada_larga", "hacha_combate", "maza_guerra", "lanza", "arco_largo", "ballesta"] : IDS_ARMA;
  const resultado = {};
  for (const id of ids) resultado[id] = generarArma(id);
  const salida = path.join(__dirname, muestra ? "output/armas_muestra.json" : "armas_generadas.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify(resultado));
  console.log(`Generadas ${ids.length} armas -> ${salida}`);
}
