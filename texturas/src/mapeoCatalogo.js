"use strict";
// Qué familia (familias.js) le toca a cada id de terrenos.json/materiales.json
// — el color base NO va aquí, sale del propio `colorDebug` ya declarado en
// esos catálogos (fuente de verdad única, CLAUDE.md regla 2). Añadir un
// terreno/material nuevo al catálogo real y no tocar este archivo hace que
// index.js avise y lo trate como "liso" por defecto — nunca rompe el bake
// por una entrada nueva sin mapear.
//
// Agua/agua_profunda/lava quedan FUERA a propósito: ya llevan tratamiento
// especial (translúcida, con fondo visible — PROFUNDIDAD_FONDO en
// worldScene.ts) y una textura estática de piedra/tierra no pinta nada ahí;
// si algún día se anima de verdad, será su propio generador, no esta familia.
const EXCLUIDOS = new Set(["agua", "agua_profunda", "lava"]);

const MAPEO_TERRENOS = {
  playa: "arena", playa_rocosa: "arena", arena: "arena",
  cesped: "cesped", cesped_ralo: "cesped", extramuros: "cesped",
  tierra: "tierra", tierra_baldia: "tierra", suelo_barbecho: "tierra",
  tierra_labrada: "tierra", barro: "tierra", ceniza: "tierra",
  camino: "tierra", solar_edificio: "tierra",
  nieve: "nieve", hielo: "nieve",
  roca: "piedra", roca_inaccesible: "piedra", roca_volcanica: "piedra",
  adoquin: "piedra", muralla_piedra: "piedra",
  puente: "madera", empalizada: "madera",
};

const MAPEO_MATERIALES = {
  madera: "madera",
  piedra: "piedra",
  marmol: "piedra",
  ladrillo: "ladrillo",
  estuco: "liso",
  metal: "liso",
  cristal: "liso",
  adobe: "tierra",
  papel_pintado: "tela",
  tela_tapiz: "tela",
  mimbre: "tela",
  paja: "tela",
  cuero: "tela",
  lino: "tela",
  lana: "tela",
  seda: "tela",
};

module.exports = { EXCLUIDOS, MAPEO_TERRENOS, MAPEO_MATERIALES };
