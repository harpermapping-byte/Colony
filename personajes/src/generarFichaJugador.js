"use strict";

/**
 * Ficha de personaje ELEGIDA por el jugador (creador de personaje, pedido
 * streamer 2026-09-10: "Creador completo elegible por el jugador (sexo,
 * morfología, piel/pelo/ojos)... adelante"). Hermano de generarPersonaje.js
 * pero SIN ningún dado: el jugador ya decidió cada rasgo a mano, así que
 * aquí solo se VALIDA contra el catálogo real (rasgos.json — cualquier id
 * que no exista o esté fuera de rango cae a un valor por defecto seguro,
 * nunca se lanza una excepción por una elección rara: el llamante de
 * server/src es una ruta HTTP pública, ver la lección del bug crítico de
 * 2026-09-10 en docs/GDD_Cuentas.md §5quater — nunca confiar en el tipo/
 * forma de lo que mande el cliente) y se construye la MISMA forma
 * {ficha, voxelesCabeza, cuerpo} que generarPersonaje.js ya produce para
 * NPCs — mismo contrato, client/src/render3d/personajeVoxel.ts no
 * distingue de dónde vino.
 *
 * Reusa las tablas de geometría de pelo/barba y `voxelizarCajas` de
 * generarPersonaje.js en vez de duplicarlas — mismo catálogo de estilos, un
 * solo sitio que mantener si se añade un peinado nuevo.
 */
const { CAJAS_PELO, CAJAS_BARBA, voxelizarCajas } = require("./generarPersonaje");
const { cargarCatalogos } = require("./catalogo");
const { crearPRNG } = require("../../interiores/src/azar");
const { aplicarMorfologia, REGLAS: REGLAS_MORFOLOGIA } = require("../../ropa/src/morfologia");

function idsValidos(lista) {
  return new Set(lista.map(([id]) => id));
}

// Solo los colores de PESO>0 son elegibles por un jugador real — hueso/
// ceniciento/piedra (coloresPiel) son variantes reservadas (uso no-jugador,
// ver rasgos.json), nunca debieron salir en un creador de personaje.
function eligibles(lista) {
  const con_peso = lista.filter(([, peso]) => peso > 0);
  return con_peso.length ? con_peso : lista;
}

function colorDe(lista, id) {
  const entrada = lista.find(([nombre]) => nombre === id);
  return entrada ? entrada[2] : null;
}

function acotar(valor, rango) {
  const n = Number(valor);
  return Math.max(rango.min, Math.min(rango.max, Number.isFinite(n) ? n : rango.defecto));
}

/**
 * @param {object} eleccion - { sexo, peloEstilo, barbaEstilo, peloColorId, pielColorId, ojosColorId, altura, corpulencia } — cualquier campo puede faltar o venir mal formado, se resuelve a un valor por defecto seguro.
 * @param {string} [semillaEstable] - normalmente el nombre del jugador — SOLO para el jitter de color de los vóxeles (determinista, puramente cosmético), nunca decide ningún rasgo elegido.
 * @returns {{ficha: object, voxelesCabeza: object[], cuerpo: object}} mismo contrato que generarPersonaje().
 */
function generarFichaJugador(eleccion, semillaEstable) {
  const opciones = eleccion && typeof eleccion === "object" ? eleccion : {};
  const catalogos = cargarCatalogos();
  const rasgos = catalogos.rasgos;

  const sexo = opciones.sexo === "mujer" ? "mujer" : "hombre";

  // Cruzados a propósito (mismo criterio que generarPersonaje.js): los 30
  // ids de peloEstilosHombre/peloEstilosMujer son los MISMOS en las dos
  // listas, solo cambia el peso — cualquiera de los dos sirve para validar.
  const estilosPeloValidos = idsValidos(rasgos.peloEstilosHombre);
  const peloEstilo = estilosPeloValidos.has(opciones.peloEstilo) ? opciones.peloEstilo : "corto";

  const estilosBarbaValidos = idsValidos(rasgos.barbaEstilos);
  const barbaEstilo = estilosBarbaValidos.has(opciones.barbaEstilo) ? opciones.barbaEstilo : "ninguna";

  const pelos = eligibles(rasgos.coloresPelo);
  const pieles = eligibles(rasgos.coloresPiel);
  const ojos = eligibles(rasgos.coloresOjos);
  const peloColorId = idsValidos(pelos).has(opciones.peloColorId) ? opciones.peloColorId : pelos[0][0];
  const pielColorId = idsValidos(pieles).has(opciones.pielColorId) ? opciones.pielColorId : pieles[0][0];
  const ojosColorId = idsValidos(ojos).has(opciones.ojosColorId) ? opciones.ojosColorId : ojos[0][0];

  const morfologia = {
    sexo,
    altura: Number(acotar(opciones.altura, REGLAS_MORFOLOGIA.rangos.altura).toFixed(3)),
    corpulencia: Number(acotar(opciones.corpulencia, REGLAS_MORFOLOGIA.rangos.corpulencia).toFixed(3)),
  };

  const ficha = {
    npcId: "jugador",
    sexo,
    morfologia,
    rasgos: {
      peloEstilo,
      barbaEstilo,
      peloColor: { id: peloColorId, hex: colorDe(rasgos.coloresPelo, peloColorId) },
      pielColor: { id: pielColorId, hex: colorDe(rasgos.coloresPiel, pielColorId) },
      ojosColor: { id: ojosColorId, hex: colorDe(rasgos.coloresOjos, ojosColorId) },
    },
    // Un jugador viste por lo EQUIPADO (client/src/render3d/equipoVisual.ts,
    // slots reales de inventario) — a diferencia de un NPC, esta ficha nunca
    // trae ropa "de civil" propia.
    ropa: [],
  };

  const rnd = crearPRNG(`jugador|${semillaEstable || "sin-nombre"}`);
  const cuerpo = aplicarMorfologia(catalogos.proporcionesRig, morfologia);
  const voxelesCabeza = [
    ...voxelizarCajas(CAJAS_PELO[peloEstilo] || [], cuerpo.ladoCabeza, ficha.rasgos.peloColor.hex, "pelo", rnd),
    ...voxelizarCajas(CAJAS_BARBA[barbaEstilo] || [], cuerpo.ladoCabeza, ficha.rasgos.peloColor.hex, "barba", rnd),
  ];

  return { ficha, voxelesCabeza, cuerpo };
}

module.exports = { generarFichaJugador };
