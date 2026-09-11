"use strict";

/**
 * Valor base (Farycoins) de TODO ítem del catálogo + XP de oficio de TODA
 * receta — calculado por fórmula, nunca a mano (docs/GDD_Economia.md §12 y
 * docs/GDD_Crafteo.md §11, pedido 2026-09-11: "pon el costo de cada uno
 * con sentido sabiendo la filosofía del proyecto"). Mismo patrón que
 * `nombreBonito.js`: `node items/catalogo/valorBase.js` imprime el informe,
 * `node items/catalogo/valorBase.js --aplicar` escribe `valorBase` en cada
 * entrada de items.json y `xpOtorgada` en cada receta de recetas.json.
 * `server/test/coherenciaCatalogo.test.ts` comprueba que lo guardado
 * coincide con lo calculado — dar de alta un ítem/receta nuevo sin
 * re-ejecutar esto rompe la suite a propósito.
 *
 * REGLAS (una sola fuente de verdad, en este orden):
 *  1. Crudo (sin receta): tabla VALOR_CRUDO por id — refleja el tier de
 *     herramienta que exige recolectarlo (server/src/mundo/
 *     herramientasRecoleccion.ts: tier 1 ≈ 1₣, 2 ≈ 2-3₣, 3 ≈ 4₣, 4 ≈ 7₣),
 *     la rareza real (gemas preciosas por encima del oro) y lo que ya
 *     cobraban los mercaderes de docs/GDD_Economia.md §9 cuando existía
 *     un precio a mano (hierro 3, sal 2, piel_fina 4...).
 *  2. Crafteado (con receta): coste de sus insumos POR UNIDAD producida
 *     + mano de obra = nivel×2 + tiempo/8 — así una receta de nivel alto y
 *     lenta añade valor real, y NUNCA sale más barato que sus insumos
 *     (regla que los precios a mano de los mercaderes violaban: lingote 5
 *     con hierro a 3×2). Si hay varias recetas, manda la más barata.
 *  3. Variante "_bonificad@" (resultado perfecto del minijuego de forja):
 *     ×1.4 sobre su base (stats +25% y mucho más difícil de conseguir).
 *  4. Equipo sin receta (loot temático de enemigo, sets legendarios):
 *     desde sus stats — 4 + ataque×2.5 + ataqueMágico×4 + defensas×10,
 *     ×1.2 (loot de enemigo normal, no craftable) o ×4 (legendario).
 *  5. Cadáver de caza: carne+piel+despojos que rinde (tabla de
 *     server/src/mundo/lootCaza.ts CANTIDADES_POR_TAMANO, replicada aquí
 *     como factor) — nunca vale más que lo que se saca de él.
 *  6. Semilla de cultivo: 60% de lo que rinde una cosecha; semilla de
 *     árbol: fija (no tiene "cosecha" en el sentido de inventario).
 *  7. Resto sin fuente (libros generados, pociones del minijuego de
 *     alquimia, reliquias, monedas...): tabla VALOR_ESPECIAL.
 *
 * XP por receta = 12 + nivel×4 + tiempo/6 (redondeado): una receta de
 * nivel 1 de 12s da 18 XP (≈ el XP_POR_CRAFTEO=20 histórico), una de
 * nivel 10 de 120s da 72 — con la curva de 10 niveles (4050 XP) el tope
 * se alcanza con ~110 crafteos mezclados en vez de ~200 iguales, pero
 * cada crafteo alto tarda 4-10× más, así que el tiempo real de juego se
 * mantiene en el orden de "~2 semanas dedicado" de docs/GDD_Profesiones.md.
 */

const fs = require("fs");
const path = require("path");

const RUTA_ITEMS = path.join(__dirname, "items.json");
const RUTA_RECETAS = path.join(__dirname, "recetas.json");

// ---- 1. Crudos: recolección, caza, granja, cultivo, y sub-productos de proceso sin receta ----
const VALOR_CRUDO = {
  // minerales (picapedrero) — por tier de pico
  piedra_comun: 1, arcilla: 1, turba: 1, carbon: 2,
  cobre: 3, hierro: 3, cuarzo: 3, sal: 2,
  plomo: 4, azufre: 4, plata: 8, estano: 4,
  oro: 12, platino: 18, gema: 8,
  amatista: 12, esmeralda: 16, rubi: 20, zafiro: 18, diamante: 30,
  coral: 3,
  // maderas (carpintero) — por tier de hacha
  madera_blanda: 1, madera_abedul: 2, madera_dura: 2, madera_sauce: 3, madera_carbonizada: 3, madera_palmera: 5,
  // plantas
  baya: 1, fruta: 1, fruto_seco: 2, cereal_silvestre: 1, hierba_comestible: 1, raiz_comestible: 1, hongo_comestible: 1,
  fibra_vegetal: 1, alga: 1, hoja: 1, miel: 3,
  hierba_aromatica: 2, hierba_venenosa: 2, hierba_curativa: 3, flor_medicinal: 4, hongo_medicinal: 5,
  // caza / pesca / despojos (server/src/mundo/lootCaza.ts)
  carne_blanca: 2, carne_roja: 3, carne_caza_mayor: 4, carne_exotica: 5,
  pescado_rio: 2, pescado_lago: 2, pescado_mar: 3, marisco: 3,
  piel_basta: 2, cuero_grueso: 3, piel_fina: 4, piel_invierno: 5, cuero_reptil: 5, piel_exotica: 6,
  tendones: 1, tripas: 1, grasa: 1, cebo_pesca: 1,
  cabeza_trofeo_pequena: 6, cabeza_trofeo_mediana: 12, cabeza_trofeo_grande: 25,
  // granja / cultivo (docs/GDD_Ganaderia.md, docs/GDD_Agricultura.md)
  leche: 2, huevo: 1, lana: 1, trigo: 1, zanahoria: 1, tomate: 1, fresa: 1,
  // sub-productos de proceso sin receta propia (curtido a granel, docs/GDD_Curtido.md)
  curtiente: 2, piel_salada: 3, piel_raspada: 4,
};

// ---- 7. Sin fuente calculable ----
const VALOR_ESPECIAL = {
  moneda_suelta: 1, reliquia: 60, libro: 8,
  camisa_harapienta: 1, pantalon_harapiento: 1,
  // pociones del minijuego de alquimia (docs/GDD_Alquimia.md): ingredientes variables, se fija a mano
  pocion_alquimica_clara: 30, pocion_alquimica_toxica: 30, pocion_alquimica_vital: 30, pocion_alquimica_inestable: 30, pocion_alquimica_radiante: 30,
};
const VALOR_LIBRO_POR_CATEGORIA = { oficio: 20, mecanica: 12, lore: 15 };
const VALOR_SEMILLA_ARBOL = 2;

/** Factor sobre (carne + piel + despojos) por tamaño del cadáver — refleja CANTIDADES_POR_TAMANO de lootCaza.ts (carne 2/4/7/12 unidades). */
const FACTOR_CADAVER = { cria: 1, pequeno: 2, mediano: 4, grande: 7, alfa: 12 };

const MULT_BONIFICADA = 1.4;
const MULT_LOOT_ENEMIGO = 1.2;
const MULT_LEGENDARIO = 4;

function manoDeObra(receta) {
  return receta.nivelMinimo * 2 + receta.tiempoBaseSeg / 8;
}

function xpDeReceta(receta) {
  return Math.round(12 + receta.nivelMinimo * 4 + receta.tiempoBaseSeg / 6);
}

function valorPorStats(it) {
  const base = 4 + (it.ataqueFisico ?? 0) * 2.5 + (it.ataqueMagico ?? 0) * 4 + ((it.defensaFisica ?? 0) + (it.defensaMagica ?? 0)) * 10;
  return base * (it.legendario ? MULT_LEGENDARIO : MULT_LOOT_ENEMIGO);
}

function cargar(ruta) {
  const bruto = JSON.parse(fs.readFileSync(ruta, "utf8"));
  const reales = {};
  for (const [k, v] of Object.entries(bruto)) if (!k.startsWith("_")) reales[k] = v;
  return { bruto, reales };
}

/**
 * Calcula el valor de cada ítem. Devuelve { valores: {id: number}, avisos: string[] }.
 * Determinista: itera hasta punto fijo sobre las recetas (cadenas de varios
 * pasos) y avisa de cualquier ciclo o ítem sin ninguna regla aplicable.
 */
function calcularValores(items, recetas) {
  const valores = {};
  const avisos = [];
  const recetasPorResultado = {};
  for (const [id, r] of Object.entries(recetas)) (recetasPorResultado[r.resultado.itemId] ??= []).push({ id, ...r });
  const bonificadaDe = (id) => {
    const m = id.match(/^(.+)_bonificad[oa]s?$/);
    return m && items[m[1]] ? m[1] : null;
  };

  // Paso 1: todo lo que no depende de recetas.
  for (const [id, it] of Object.entries(items)) {
    if (VALOR_CRUDO[id] != null) { valores[id] = VALOR_CRUDO[id]; continue; }
    if (VALOR_ESPECIAL[id] != null) { valores[id] = VALOR_ESPECIAL[id]; continue; }
    if (it.tipo === "libro" && it.categoriaLibro !== "jugador") { valores[id] = VALOR_LIBRO_POR_CATEGORIA[it.categoriaLibro] ?? 10; continue; }
    if (it.tipo === "semilla" && it.crecimientoArbol) { valores[id] = VALOR_SEMILLA_ARBOL; continue; }
    if (id.startsWith("cadaver_")) {
      // <carne>_<piel|sinpiel>_<tamaño> — la carne puede ser "generico"/"marisco"/"pescado_x" (fauna sin carne catalogada o acuática), sin valor propio.
      const m = id.match(/^cadaver_(.+?)_(cuero_[a-z]+|piel_[a-z]+|sinpiel)_(cria|pequeno|mediano|grande|alfa)$/);
      if (!m) { avisos.push(`cadáver sin patrón reconocible: ${id}`); continue; }
      const carne = VALOR_CRUDO[m[1]] ?? 0;
      const piel = m[2] === "sinpiel" ? 0 : (VALOR_CRUDO[m[2]] ?? 0);
      valores[id] = Math.max(1, Math.round((carne + piel + 1) * FACTOR_CADAVER[m[3]]));
      continue;
    }
  }
  // Paso 2: semillas de cultivo (dependen del valor de la cosecha, siempre cruda).
  for (const [id, it] of Object.entries(items)) {
    if (valores[id] != null || it.tipo !== "semilla" || !it.cultivo) continue;
    const cosecha = valores[it.cultivo.itemIdCosecha];
    if (cosecha == null) { avisos.push(`semilla ${id}: cosecha ${it.cultivo.itemIdCosecha} sin valor`); continue; }
    valores[id] = Math.max(1, Math.round(cosecha * it.cultivo.cantidadPorCosecha * 0.6));
  }
  // Paso 3: recetas hasta punto fijo, luego bonificadas y abreEn.
  for (let vuelta = 0; vuelta < 30; vuelta++) {
    let cambio = false;
    for (const [id, it] of Object.entries(items)) {
      if (valores[id] != null) continue;
      const rs = recetasPorResultado[id];
      if (rs) {
        let mejor = null;
        for (const r of rs) {
          let coste = 0, completa = true;
          for (const i of r.insumos) {
            if (valores[i.itemId] == null) { completa = false; break; }
            coste += valores[i.itemId] * i.cantidad;
          }
          if (!completa) continue;
          const v = (coste + manoDeObra(r)) / r.resultado.cantidad;
          if (mejor == null || v < mejor) mejor = v;
        }
        if (mejor != null) { valores[id] = Math.max(1, Math.round(mejor)); cambio = true; }
        continue;
      }
      const base = bonificadaDe(id);
      if (base) {
        if (valores[base] != null) { valores[id] = Math.max(1, Math.round(valores[base] * MULT_BONIFICADA)); cambio = true; }
        continue;
      }
      if (it.abreEn && valores[it.abreEn.itemId] != null) {
        valores[id] = Math.max(1, Math.round(valores[it.abreEn.itemId] * it.abreEn.cantidad + 1));
        cambio = true;
        continue;
      }
    }
    if (!cambio) break;
  }
  // Paso 4: equipo sin receta (loot) por stats; lo que quede sin regla es un aviso real.
  for (const [id, it] of Object.entries(items)) {
    if (valores[id] != null) continue;
    const esEquipo = ["arma", "armadura", "equipable"].includes(it.tipo);
    if (esEquipo && (it.ataqueFisico != null || it.defensaFisica != null || it.ataqueMagico != null || it.defensaMagica != null)) {
      valores[id] = Math.max(1, Math.round(valorPorStats(it)));
      continue;
    }
    avisos.push(`sin regla de valor: ${id} (tipo ${it.tipo})`);
  }
  return { valores, avisos };
}

function calcularXp(recetas) {
  const xp = {};
  for (const [id, r] of Object.entries(recetas)) xp[id] = xpDeReceta(r);
  return xp;
}

/** Recoloca `valorBase` justo detrás de `nombre` (o al principio) para que el catálogo se lea igual en todas las entradas. */
function conValorBase(entrada, valor) {
  const { nombre, valorBase: _v, ...resto } = entrada;
  return nombre != null ? { nombre, valorBase: valor, ...resto } : { valorBase: valor, ...resto };
}

function aplicar() {
  const items = cargar(RUTA_ITEMS);
  const recetas = cargar(RUTA_RECETAS);
  const { valores, avisos } = calcularValores(items.reales, recetas.reales);
  const xp = calcularXp(recetas.reales);
  for (const [k, v] of Object.entries(items.bruto)) if (!k.startsWith("_")) items.bruto[k] = conValorBase(v, valores[k]);
  for (const [k, r] of Object.entries(recetas.bruto)) {
    if (k.startsWith("_")) continue;
    const { xpOtorgada: _x, _nota, ...resto } = r;
    recetas.bruto[k] = _nota != null ? { ...resto, xpOtorgada: xp[k], _nota } : { ...resto, xpOtorgada: xp[k] };
  }
  fs.writeFileSync(RUTA_ITEMS, JSON.stringify(items.bruto, null, 2) + "\n");
  fs.writeFileSync(RUTA_RECETAS, JSON.stringify(recetas.bruto, null, 2) + "\n");
  return { valores, avisos, xp };
}

module.exports = { calcularValores, calcularXp, xpDeReceta, manoDeObra, valorPorStats, cargar, VALOR_CRUDO, VALOR_ESPECIAL, MULT_BONIFICADA, MULT_LEGENDARIO, RUTA_ITEMS, RUTA_RECETAS };

if (require.main === module) {
  const aplicarDeVerdad = process.argv.includes("--aplicar");
  const items = cargar(RUTA_ITEMS);
  const recetas = cargar(RUTA_RECETAS);
  const { valores, avisos } = aplicarDeVerdad ? aplicar() : calcularValores(items.reales, recetas.reales);
  const ordenados = Object.entries(valores).sort((a, b) => b[1] - a[1]);
  console.log(`${Object.keys(valores).length} ítems valorados · ${avisos.length} avisos${aplicarDeVerdad ? " · ESCRITO en items.json/recetas.json" : ""}`);
  for (const a of avisos) console.log("  AVISO:", a);
  console.log("  más caros:", ordenados.slice(0, 12).map(([k, v]) => `${k}=${v}`).join(", "));
  console.log("  más baratos:", ordenados.slice(-8).map(([k, v]) => `${k}=${v}`).join(", "));
}
