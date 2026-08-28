"use strict";

// Fauna DOMÉSTICA urbana (GDD_Agentes_Moviles.md v1.3, pedido del
// streamer 2026-08-28): gallinas, alguna vaca suelta, perros, gatos, algún
// gallo si hay gallinas — sueltos por el asentamiento, sin censo ni
// rutina horaria (a diferencia de los NPC de poblacion/): solo un punto de
// aparición y un radio de merodeo pequeño alrededor. El CEREBRO en vivo
// (comer/jugar/dormir/sentarse/deambular) lo lleva server/src/mundo/fauna.ts;
// aquí solo se decide CUÁNTOS y DÓNDE, una vez, determinista por semilla.
const { crearPRNG } = require("../../interiores/src/azar");
const { TRANSITABLES } = require("./generar");

// Especies domésticas: reusan las plantillas ya existentes de
// personajes/catalogo/animales_rig.json (gallina_salvaje/vaca_salvaje) o
// las nuevas domésticas puras (perro/gato/gallo) — cero catálogo nuevo,
// "las listas crecen, el código no".
const ESPECIES = [
  { especieId: "gallina_salvaje", peso: 8, radio: 3 },
  { especieId: "gallo", peso: 1, peroSoloSiHay: "gallina_salvaje", radio: 3 }, // "algún gallo si hay gallinas"
  { especieId: "vaca_salvaje", peso: 2, radio: 4 },
  { especieId: "perro", peso: 4, radio: 5 },
  { especieId: "gato", peso: 4, radio: 4 },
];

// Cuántos animales por tier — mismo criterio de escala que el censo de
// NPCs (poblacion/catalogo/censo.json), pero mucho más barato: sin
// vivienda/trabajo/rutina, solo un punto y un radio.
const CANTIDAD_POR_TIER = {
  aldea_pequena: [3, 5],
  aldea: [4, 8],
  pueblo: [6, 12],
  capital: [8, 16],
  gran_capital: [12, 22],
  castillo: [2, 5],
};

function enteroEnRango([min, max], rnd) {
  return min + Math.floor(rnd() * (max - min + 1));
}

function puntoCercaTransitable(ciudad, cx, cy, radioMax, rnd) {
  for (let intento = 0; intento < 20; intento++) {
    const ang = rnd() * Math.PI * 2;
    const dist = rnd() * radioMax;
    const x = Math.round(cx + Math.cos(ang) * dist);
    const y = Math.round(cy + Math.sin(ang) * dist);
    if (ciudad.terreno.dentro(x, y) && TRANSITABLES.has(ciudad.terreno.get(x, y))) return { x, y };
  }
  return null;
}

/**
 * Reparte spawns de fauna doméstica junto a las casas y la plaza —
 * determinista por semilla, cero censo. Devuelve
 * `[{especieId, x, y, radio}]` (radio = merodeo máximo desde el spawn).
 */
function generarFauna(ciudad) {
  const rnd = crearPRNG(`${ciudad.tier}:${ciudad.semilla}:fauna`);
  const [min, max] = CANTIDAD_POR_TIER[ciudad.tier] ?? [4, 8];
  const cantidad = enteroEnRango([min, max], rnd);

  const hayGallinas = ciudad.edificios.length > 0; // se decide junto con la primera tirada de especie
  const pesos = ESPECIES.filter((e) => !e.peroSoloSiHay); // el gallo se añade aparte, ver abajo
  const totalPeso = pesos.reduce((s, e) => s + e.peso, 0);

  const casas = ciudad.edificios.filter((e) => e.tipoEdificioId?.startsWith("casa_") || e.tipoEdificioId === "granero");
  const centrosDeSpawn = casas.length > 0 ? casas.map((c) => ({ x: c.cx, y: c.cy })) : [ciudad.focal].filter(Boolean);
  if (centrosDeSpawn.length === 0) return [];

  const fauna = [];
  let salieronGallinas = false;
  for (let i = 0; i < cantidad; i++) {
    let r = rnd() * totalPeso;
    let especie = pesos[0];
    for (const e of pesos) { r -= e.peso; if (r <= 0) { especie = e; break; } }
    const centro = centrosDeSpawn[Math.floor(rnd() * centrosDeSpawn.length)];
    const punto = puntoCercaTransitable(ciudad, centro.x, centro.y, especie.radio + 2, rnd);
    if (!punto) continue;
    fauna.push({ especieId: especie.especieId, x: punto.x, y: punto.y, radio: especie.radio });
    if (especie.especieId === "gallina_salvaje") salieronGallinas = true;
  }

  // "algún gallo si hay gallinas": 0-2 gallos extra, solo si el sorteo dio
  // al menos una gallina — nunca un gallo suelto sin corral.
  if (salieronGallinas && hayGallinas) {
    const nGallos = Math.floor(rnd() * 2) + (rnd() < 0.7 ? 1 : 0); // casi siempre 1, a veces 2, a veces 0
    for (let i = 0; i < nGallos; i++) {
      const centro = centrosDeSpawn[Math.floor(rnd() * centrosDeSpawn.length)];
      const punto = puntoCercaTransitable(ciudad, centro.x, centro.y, 5, rnd);
      if (punto) fauna.push({ especieId: "gallo", x: punto.x, y: punto.y, radio: 3 });
    }
  }

  return fauna;
}

module.exports = { generarFauna, CANTIDAD_POR_TIER };
