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
// las nuevas domésticas puras (perro/gato/gallo/caballo/burro/buey) — cero
// catálogo nuevo, "las listas crecen, el código no". IMPORTANTE: solo puede
// entrar aquí una especie que YA tenga rig/esqueleto en animales_rig.json —
// generarAnimal() revienta si no lo tiene. oveja/carnero/cerdo/
// ganso_domestico/perra/gata/yegua/toro/vaca/... (trío macho-hembra-cría,
// ampliación 2026-08-29) ya existen en baker/catalogo/animales.json pero
// deliberadamente NO se añaden aquí todavía: sin rig. caballo/burro/buey
// (pedido 2026-08-29, "animales de trabajo") SÍ tienen rig ya, así que
// entran directos — pesos bajos porque son animales caros de mantener, no
// todas las casas tienen uno. 'burro' sustituye a 'mulo' (híbrido estéril,
// no encajaba con el sistema de cría que se está montando).
const ESPECIES = [
  { especieId: "gallina_salvaje", peso: 8, radio: 3 },
  { especieId: "gallo", peso: 1, peroSoloSiHay: "gallina_salvaje", radio: 3 }, // "algún gallo si hay gallinas"
  { especieId: "vaca_salvaje", peso: 2, radio: 4 },
  { especieId: "perro", peso: 4, radio: 5 },
  { especieId: "gato", peso: 4, radio: 4 },
  { especieId: "caballo", peso: 2, radio: 5 },
  { especieId: "burro", peso: 1, radio: 4 },
  { especieId: "buey", peso: 1, radio: 3 },
];

// Cuántos animales por tier — mismo criterio de escala que el censo de
// NPCs (poblacion/catalogo/censo.json), pero mucho más barato: sin
// vivienda/trabajo/rutina, solo un punto y un radio.
const CANTIDAD_POR_TIER = {
  aldea_pequena: [3, 5],
  aldea: [4, 8],
  pueblo: [6, 12],
  capital: [8, 16],
  capital_jarl: [16, 26], // el tier más grande (110-130 edificios, catálogo asentamientos.json) — faltaba, caía al default [4,8] de aldea_pequena
  gran_capital: [12, 22],
  castillo: [2, 5],
  asentamiento_hostil: [2, 4], // campamento bandido (7-11 edificios) — menos fauna civil (perro/gato/caballo...) que una aldea real, faltaba y caía al mismo default
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

  const hayEdificios = ciudad.edificios.length > 0; // se decide junto con la primera tirada de especie
  const pesos = ESPECIES.filter((e) => !e.peroSoloSiHay); // las parejas condicionadas (gallo, carnero...) se añaden aparte, ver abajo
  const totalPeso = pesos.reduce((s, e) => s + e.peso, 0);

  const casas = ciudad.edificios.filter((e) => e.tipoEdificioId?.startsWith("casa_") || e.tipoEdificioId === "granero");
  const centrosDeSpawn = casas.length > 0 ? casas.map((c) => ({ x: c.cx, y: c.cy })) : [ciudad.focal].filter(Boolean);
  if (centrosDeSpawn.length === 0) return [];

  const fauna = [];
  const especiesSalidas = new Set();
  for (let i = 0; i < cantidad; i++) {
    let r = rnd() * totalPeso;
    let especie = pesos[0];
    for (const e of pesos) { r -= e.peso; if (r <= 0) { especie = e; break; } }
    const centro = centrosDeSpawn[Math.floor(rnd() * centrosDeSpawn.length)];
    const punto = puntoCercaTransitable(ciudad, centro.x, centro.y, especie.radio + 2, rnd);
    if (!punto) continue;
    fauna.push({ especieId: especie.especieId, x: punto.x, y: punto.y, radio: especie.radio });
    especiesSalidas.add(especie.especieId);
  }

  // Parejas macho/hembra condicionadas ("algún gallo si hay gallinas",
  // "algún carnero si hay ovejas"...): 0-2 extra, solo si el sorteo
  // principal dio al menos un individuo de la especie de la que dependen —
  // nunca un macho suelto sin su rebaño/corral.
  for (const pareja of ESPECIES) {
    if (!pareja.peroSoloSiHay || !hayEdificios || !especiesSalidas.has(pareja.peroSoloSiHay)) continue;
    const nExtra = Math.floor(rnd() * 2) + (rnd() < 0.7 ? 1 : 0); // casi siempre 1, a veces 2, a veces 0
    for (let i = 0; i < nExtra; i++) {
      const centro = centrosDeSpawn[Math.floor(rnd() * centrosDeSpawn.length)];
      const punto = puntoCercaTransitable(ciudad, centro.x, centro.y, pareja.radio + 2, rnd);
      if (punto) fauna.push({ especieId: pareja.especieId, x: punto.x, y: punto.y, radio: pareja.radio });
    }
  }

  return fauna;
}

module.exports = { generarFauna, CANTIDAD_POR_TIER };
