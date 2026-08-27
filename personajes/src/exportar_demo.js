"use strict";

// Exporta un puñado de personajes VESTIDOS y animales a
// assets/personajes/demo_personajes.json — el JSON que materializa el
// cliente (client/src/render3d/personajeVoxel.ts / animalVoxel.ts). Es el
// eslabón "generar UNA vez, el cliente solo lee" del circuito de
// personajes: cuando el servidor pueble NPCs de verdad, escribirá/consumirá
// este MISMO formato por NPC del mundo; esta demo fija de la ciudad existe
// para validar el circuito entero (catálogo → generador → JSON → rig
// animado en el juego) y se sustituye entonces.
//   node personajes/src/exportar_demo.js

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarPersonaje } = require("./generarPersonaje");
const { generarAnimal } = require("./generarAnimal");
const { cargarCatalogos: cargarCatalogosRopa } = require("../../ropa/src/catalogo");
const { generarPrenda } = require("../../ropa/src/generarPrenda");

const catalogos = cargarCatalogos();
const catalogosRopa = cargarCatalogosRopa();

// Material de una prenda para un NPC: el preferido de su profesión que la
// prenda admita; si no coinciden, el primero compatible de la prenda.
function resolverMaterial(prendaId, profesionId) {
  const prenda = catalogosRopa.prendas[prendaId];
  const profesion = catalogosRopa.profesiones[profesionId];
  const preferido = (profesion?.materialesPreferidos || []).find((m) => prenda.materialesCompatibles.includes(m));
  return preferido || prenda.materialesCompatibles[0];
}

function exportarNPC(npcId, semilla) {
  const { ficha, voxelesCabeza, cuerpo } = generarPersonaje(npcId, { catalogos, semilla });
  const ropa = ficha.ropa.map((prendaId) => {
    const materialId = resolverMaterial(prendaId, ficha.profesion);
    const prenda = generarPrenda(prendaId, {
      catalogos: catalogosRopa,
      semilla,
      materialId,
      morfologia: ficha.morfologia, // la MISMA morfología del cuerpo → acopla sola
    });
    return { prendaId, materialId, voxeles: prenda.voxeles };
  });
  return { ficha, cuerpo, voxelesCabeza, ropa };
}

function exportarAnimal(especieId, semilla) {
  const { ficha, piezas } = generarAnimal(especieId, { catalogos, semilla });
  return { ficha, piezas };
}

const demo = {
  _nota: "Generado por personajes/src/exportar_demo.js — NO editar a mano; regenerar con ese script. Demo del circuito personajes/ropa/animales → cliente; lo sustituirá el poblado real de NPCs del servidor.",
  npcs: [
    exportarNPC("aldeano", "demo-npc-01"),
    exportarNPC("herrero", "demo-npc-02"),
    exportarNPC("anciano_sabio", "demo-npc-03"),
  ],
  animales: [
    exportarAnimal("lobo", "demo-fauna-01"),
    exportarAnimal("gallina_salvaje", "demo-fauna-02"),
    exportarAnimal("conejo", "demo-fauna-03"),
    exportarAnimal("abeja", "demo-fauna-04"),
    exportarAnimal("rana", "demo-fauna-05"),
  ],
};

const salida = path.join(__dirname, "..", "..", "assets", "personajes", "demo_personajes.json");
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, JSON.stringify(demo), "utf8");
const kb = (fs.statSync(salida).size / 1024).toFixed(0);
const nVox = demo.npcs.reduce((s, n) => s + n.voxelesCabeza.length + n.ropa.reduce((a, r) => a + r.voxeles.length, 0), 0);
console.log(`demo_personajes.json: ${demo.npcs.length} NPCs vestidos (${nVox} vóxeles) + ${demo.animales.length} animales -> ${salida} (${kb} KB)`);
