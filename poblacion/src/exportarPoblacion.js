"use strict";

// Orquesta la Fase 1 (GDD_Poblacion_NPCs.md): censo → identidad → familia
// → vestir (personajes/ + ropa/) → biografía (IA, offline). Sin ubicar en
// el mapa ni asignar vivienda/trabajo todavía — eso es Fase 2.
//
//   node poblacion/src/exportarPoblacion.js <tier> <semilla> [salida.json]
//
// Requiere GEMINI_API_KEY en env para biografías reales; sin ella, cada
// NPC se queda con la personalidad/conocimiento genéricos de su arquetipo.
const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarCenso } = require("./generarCenso");
const { generarIdentidad, apellidoDeFamilia } = require("./generarIdentidad");
const { generarHistoria } = require("./generarHistoria");
const { generarPersonaje } = require("../../personajes/src/generarPersonaje");
const { cargarCatalogos: cargarCatalogosPersonajes } = require("../../personajes/src/catalogo");
const { cargarCatalogos: cargarCatalogosRopa } = require("../../ropa/src/catalogo");
const { generarPrenda } = require("../../ropa/src/generarPrenda");

const FACTOR_ESCALA_HIJO_MIN = 0.5;
const FACTOR_ESCALA_HIJO_MAX = 0.72;

function resolverMaterial(catalogosRopa, prendaId, profesionId) {
  const prenda = catalogosRopa.prendas[prendaId];
  const profesion = catalogosRopa.profesiones[profesionId];
  const preferido = (profesion?.materialesPreferidos || []).find((m) => prenda.materialesCompatibles.includes(m));
  return preferido || prenda.materialesCompatibles[0];
}

function vestir(catalogosRopa, ficha, semilla) {
  return ficha.ropa.map((prendaId) => {
    const materialId = resolverMaterial(catalogosRopa, prendaId, ficha.profesion);
    const prenda = generarPrenda(prendaId, {
      catalogos: catalogosRopa,
      semilla,
      materialId,
      morfologia: ficha.morfologia,
    });
    return { prendaId, materialId, voxeles: prenda.voxeles };
  });
}

/**
 * Genera la población (Fase 1, sin ubicar) de un asentamiento.
 * @param {string} tierId - tier de ciudades/catalogo/asentamientos.json
 * @param {string} semilla - semilla del asentamiento (p.ej. su id de POI)
 * @param {object} [opciones] - { apiKey, contextoMundo }
 */
async function exportarPoblacion(tierId, semilla, opciones = {}) {
  const catalogos = cargarCatalogos();
  const catalogosPersonajes = cargarCatalogosPersonajes();
  const catalogosRopa = cargarCatalogosRopa();
  const contextoMundo =
    opciones.contextoMundo ??
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "personajes", "catalogo", "contexto_mundo.json"), "utf8"),
    ).texto;
  const apiKey = opciones.apiKey ?? process.env.GEMINI_API_KEY;

  const slots = generarCenso(tierId, semilla, catalogos);

  const apellidosFamilia = new Map(); // familiaId -> apellido
  const sexoCabezaFamilia = new Map(); // familiaId -> sexo del cabeza (para el cónyuge)
  const familiaresPorId = new Map(); // familiaId -> [{nombre, apellido, rolFamiliar}]

  const npcs = [];
  for (const slot of slots) {
    const sexoForzado = slot.rolFamiliar === "conyuge" ? opuesto(sexoCabezaFamilia.get(slot.familiaId)) : undefined;
    const factorEscala =
      slot.rolFamiliar === "hijo"
        ? FACTOR_ESCALA_HIJO_MIN + (FACTOR_ESCALA_HIJO_MAX - FACTOR_ESCALA_HIJO_MIN) * pseudoAzarSlot(slot)
        : undefined;

    const { ficha, voxelesCabeza } = generarPersonaje(slot.npcId, {
      catalogos: catalogosPersonajes,
      semilla: slot.semilla,
      sexoForzado,
      factorEscala,
    });

    if (slot.rolFamiliar === "cabeza") sexoCabezaFamilia.set(slot.familiaId, ficha.sexo);

    let apellidoFamilia;
    if (slot.familiaId) {
      if (!apellidosFamilia.has(slot.familiaId)) {
        apellidosFamilia.set(slot.familiaId, apellidoDeFamilia(slot.familiaId, catalogos));
      }
      apellidoFamilia = apellidosFamilia.get(slot.familiaId);
    }
    const { nombre, apellido } = generarIdentidad(slot, ficha.sexo, catalogos, apellidoFamilia);

    if (slot.familiaId) {
      const lista = familiaresPorId.get(slot.familiaId) ?? [];
      lista.push({ nombre, apellido, rolFamiliar: slot.rolFamiliar });
      familiaresPorId.set(slot.familiaId, lista);
    }

    const ropa = vestir(catalogosRopa, ficha, slot.semilla);

    npcs.push({
      slotId: slot.slotId,
      npcId: slot.npcId, // arquetipo de personajes/catalogo/npcs.json — lo usan los NPCs especiales
      nombre,
      apellido,
      familiaId: slot.familiaId,
      rolFamiliar: slot.rolFamiliar,
      ficha,
      voxelesCabeza,
      ropa,
      historia: null, // se rellena después: necesita el resumen de familiares ya completo
    });
  }

  // Biografías: se piden DESPUÉS de tener toda la familia (para poder
  // mencionar a los familiares por nombre), en paralelo por NPC.
  await Promise.all(
    npcs.map(async (npc) => {
      const familiares = npc.familiaId
        ? familiaresPorId
            .get(npc.familiaId)
            .filter((f) => f.rolFamiliar !== npc.rolFamiliar || f.nombre !== npc.nombre)
            .map((f) => `${f.nombre} ${f.apellido} (${f.rolFamiliar})`)
        : [];
      npc.historia = await generarHistoria(
        {
          contextoMundo,
          nombre: npc.nombre,
          apellido: npc.apellido,
          oficio: npc.ficha.profesion,
          rolFamiliar: npc.rolFamiliar,
          familiares,
        },
        apiKey,
      );
    }),
  );

  return { tierId, semilla, npcs };
}

function opuesto(sexo) {
  return sexo === "mujer" ? "hombre" : "mujer";
}

// Variación determinista auxiliar (0-1) para la escala de los hijos, sin
// consumir el PRNG de identidad/físico del slot.
function pseudoAzarSlot(slot) {
  let h = 0;
  for (let i = 0; i < slot.semilla.length; i++) h = (h * 31 + slot.semilla.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

module.exports = { exportarPoblacion };

if (require.main === module) {
  const [tierId, semilla, salida] = process.argv.slice(2);
  if (!tierId || !semilla) {
    console.error("uso: node poblacion/src/exportarPoblacion.js <tier> <semilla> [salida.json]");
    process.exit(1);
  }
  exportarPoblacion(tierId, semilla).then((resultado) => {
    const ruta = salida ?? path.join(__dirname, "..", "output", `${tierId}_${semilla}.json`);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.writeFileSync(ruta, JSON.stringify(resultado, null, 2), "utf8");
    const conHistoria = resultado.npcs.filter((n) => n.historia).length;
    console.log(
      `${resultado.npcs.length} NPCs generados para "${tierId}" (${conHistoria} con biografía IA) -> ${ruta}`,
    );
  });
}
