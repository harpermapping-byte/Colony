"use strict";

// Orquesta TODO (GDD_Poblacion_NPCs.md): ciudad (ciudades/) + población
// (Fase 1) + ubicación (Fase 2) + perfil social + rutina + caminos
// bakeados (Fase 3). Es el artefacto final por asentamiento — lo que el
// servidor consumirá cuando puebla NPCs de verdad (el runtime que MUEVE
// al NPC por su camino según la hora sigue pendiente, ver GDD).
//
//   node poblacion/src/exportarAsentamiento.js <tier> <semilla> [salida.json]
const fs = require("fs");
const path = require("path");
const { generarCiudad } = require("../../ciudades/src/generar");
const { cargarCatalogos: cargarCatalogosInteriores } = require("../../interiores/src/catalogo");
const { cargarCatalogos } = require("./catalogo");
const { exportarPoblacion } = require("./exportarPoblacion");
const { asignarUbicacion } = require("./asignarUbicacion");
const { asignarPerfil } = require("./asignarPerfil");
const { perfilEspecial } = require("./asignarEspeciales");
const { generarRutina } = require("./generarRutina");
const { bakearCaminosDeRutina } = require("./bakearCaminos");

/**
 * @param {string} tierId - tier de ciudades/catalogo/asentamientos.json
 * @param {string} semilla
 * @param {object} [opciones] - { apiKey, contextoMundo, dia }
 */
async function exportarAsentamiento(tierId, semilla, opciones = {}) {
  const catalogosInteriores = cargarCatalogosInteriores();
  const catalogos = cargarCatalogos();

  const ciudad = generarCiudad({ tier: tierId, semilla, catalogos: catalogosInteriores });
  const poblacion = await exportarPoblacion(tierId, semilla, opciones);

  // NPCs ESPECIALES antes de ubicar (GDD_Agentes_Moviles.md): el perfil
  // forzado decide cosas que la ubicación necesita saber (el vagabundo no
  // entra al reparto de viviendas) y reparte los turnos/puertas de la guardia
  const ctxEspecial = { indiceGuardia: { n: 0 }, nPuertas: (ciudad.puertas ?? []).length };
  for (const npc of poblacion.npcs) {
    npc.perfilForzado = perfilEspecial(npc, ctxEspecial, catalogos.especiales);
    if (npc.perfilForzado && catalogos.perfilesSociales[npc.perfilForzado]?.sinCasa) npc.sinCasa = true;
  }

  const deficit = asignarUbicacion(ciudad, poblacion.npcs, catalogos.oficiosEdificios, catalogosInteriores.elementos);

  const cacheCaminos = new Map();
  // compartido entre TODOS los npcs de este asentamiento (GDD_Agentes_
  // Moviles.md "no se apelotonen"): reparte plaza/taberna/banco por turno
  // rotatorio para que dos NPCs nunca acaben en la misma casilla.
  const contadorZonas = {};
  for (const npc of poblacion.npcs) {
    npc.perfilSocial = npc.perfilForzado ?? asignarPerfil(npc, catalogos.perfilesSociales);
    npc.rutina = npc.perfilSocial ? generarRutina(npc, ciudad, catalogos, opciones.dia ?? 0, contadorZonas) : [];
    if (npc.rutina.length) bakearCaminosDeRutina(ciudad, npc.rutina, cacheCaminos);
  }

  return { tierId, semilla, ciudad, npcs: poblacion.npcs, deficit };
}

/**
 * Escribe el `poblacion.json` que consume el JUEGO junto al mapa bakeado
 * (GDD_Agentes_Moviles.md): por NPC, lo que el servidor necesita para
 * moverlo (rutina con puntos y caminos bakeados) y lo que el cliente
 * necesita para pintarlo (vox = mismo formato PersonajeExportado de
 * demo_personajes.json: ficha + voxelesCabeza + ropa). El resto de la
 * ficha de población (familia, historia...) se queda en el export de
 * estudio de output/ — el runtime no lo necesita todavía.
 */
function escribirPoblacionDeMapa(resultado, carpetaMapa) {
  // el cliente (VoxelExportado en voxelMalla.ts) solo lee x/y/z/tam/color/
  // pivote — el resto de metadatos del generador (zona, etc.) se queda fuera
  const soloCampoCliente = ({ x, y, z, tam, color, pivote }) => ({ x, y, z, tam, color, pivote });
  const npcs = resultado.npcs
    .filter((n) => n.rutina.length > 0)
    .map((n) => ({
      slotId: n.slotId,
      nombre: n.apellido ? `${n.nombre} ${n.apellido}` : n.nombre,
      oficio: n.trabajo?.oficio ?? n.ficha?.profesion ?? null,
      grito: n.grito, // frase de calle de los especiales (melonero, pregonero...) — el cliente la muestra en burbuja
      velocidad: n.velocidad, // multiplicador de velocidad de andar (el "corredor") — undefined = normal
      casaEdificioId: n.casaEdificioId, // interior donde "vive" — InteriorRoom pone aquí a la familia cuando entra un jugador
      trabajoEdificioId: n.trabajoEdificioId, // interior donde "trabaja" — ídem, para verlo vendiendo dentro de su tienda
      rutina: n.rutina,
      vox: {
        ficha: n.ficha,
        voxelesCabeza: n.voxelesCabeza.map(soloCampoCliente),
        ropa: n.ropa.map((p) => ({ ...p, voxeles: p.voxeles.map(soloCampoCliente) })),
      },
    }));
  const ruta = path.join(carpetaMapa, "poblacion.json");
  // los generadores trabajan en float completo y cada vóxel salía como
  // "0.16533333333333333" (19 caracteres por número): 4 decimales sobran de
  // largo (la resolución del vóxel es ~0.053) y el archivo pesa 3x menos
  const redondear = (clave, v) => (typeof v === "number" ? Math.round(v * 10000) / 10000 : v);
  fs.writeFileSync(ruta, JSON.stringify({ tierId: resultado.tierId, semilla: resultado.semilla, npcs }, redondear), "utf8");
  return { ruta, npcs: npcs.length };
}

module.exports = { exportarAsentamiento, escribirPoblacionDeMapa };

if (require.main === module) {
  const [tierId, semilla, salida] = process.argv.slice(2);
  if (!tierId || !semilla) {
    console.error("uso: node poblacion/src/exportarAsentamiento.js <tier> <semilla> [salida.json | carpetaMapaBakeado]");
    console.error("  con carpeta de mapa: escribe ahí el poblacion.json que consume el juego");
    process.exit(1);
  }
  exportarAsentamiento(tierId, semilla).then((resultado) => {
    // si la salida es la CARPETA de un mapa ya bakeado, se escribe el
    // poblacion.json de juego dentro; si no, el export de estudio de siempre
    if (salida && fs.existsSync(salida) && fs.statSync(salida).isDirectory()) {
      const { ruta, npcs } = escribirPoblacionDeMapa(resultado, salida);
      console.log(`${npcs} NPCs con rutina y vóxeles -> ${ruta}`);
      return;
    }
    const ruta = salida ?? path.join(__dirname, "..", "output", `asentamiento_${tierId}_${semilla}.json`);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    // ciudad completa (interiores anidados de cada edificio) ya la exporta
    // ciudades/ por su cuenta y pesa varios MB — aquí solo lo nuevo de
    // población, para no duplicarla.
    const { ciudad, ...resto } = resultado;
    fs.writeFileSync(ruta, JSON.stringify(resto, null, 2), "utf8");
    const conRutina = resultado.npcs.filter((n) => n.rutina.length > 0).length;
    console.log(
      `${resultado.npcs.length} NPCs en "${tierId}" (${conRutina} con rutina, ` +
        `${resultado.deficit.sinVivienda.length} sin vivienda, ${resultado.deficit.sinTrabajo.length} sin trabajo) -> ${ruta}`,
    );
  });
}
