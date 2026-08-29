"use strict";

// Fase 2 (GDD_Poblacion_NPCs.md): vivienda y trabajo de una población ya
// generada (Fase 1, exportarPoblacion.js) sobre un asentamiento REAL de
// ciudades/ (generarCiudad/hornearCiudad) — sin caminos ni rutinas
// todavía, eso es Fase 3.
//
// Vivienda: cualquier edificio con camas cuenta como vivienda; su
// capacidad es la suma de plazas de cama que tenga YA bakeadas (una cama
// individual/litera = 1 plaza, una cama doble = 2 — para una pareja). Las
// familias se mudan JUNTAS a una sola vivienda con hueco para todos.
//
// Trabajo: solo adultos (rolFamiliar !== "hijo") con oficio mapeado en
// poblacion/catalogo/oficiosEdificios.json, al edificio de ese oficio más
// cercano a su vivienda con hueco libre.
const CAPACIDAD_CAMA = { cama_individual: 1, cama_doble: 2, litera: 1, litera_marinero: 1 };

function contarCamas(edificio) {
  let capacidad = 0;
  for (const planta of edificio.interior?.plantas ?? []) {
    for (const sala of planta.salas ?? []) {
      for (const item of sala.resultado?.colocados ?? []) {
        if (CAPACIDAD_CAMA[item.id]) capacidad += CAPACIDAD_CAMA[item.id];
      }
    }
  }
  return capacidad;
}

// Piezas "de puesto de trabajo" reales (temasProfesion en elementos.json:
// yunque/fragua de herrería, telar de sastre, torno de alfarero...) — un
// taller con 2-4 de esas piezas da trabajo a 1-2 personas, no a una por
// pieza (yunque+fragua+armero+fuelle de una MISMA herrería no son 4
// herreros). Sin catálogo de elementos disponible, o si el edificio no
// tiene ninguna pieza temática (taberna/templo/tienda/panadería: sus
// oficios aún no tienen mobiliario propio etiquetado), cae a la huella.
function capacidadTrabajo(edificio, elementosCatalogo) {
  if (elementosCatalogo) {
    let piezasTematicas = 0;
    for (const planta of edificio.interior?.plantas ?? []) {
      for (const sala of planta.salas ?? []) {
        for (const item of sala.resultado?.colocados ?? []) {
          if (elementosCatalogo[item.id]?.temasProfesion) piezasTematicas++;
        }
      }
    }
    if (piezasTematicas > 0) return Math.max(1, Math.min(4, Math.round(piezasTematicas / 3)));
  }
  const area = (edificio.w ?? 1) * (edificio.h ?? 1);
  return Math.max(1, Math.min(4, Math.round(area / 20)));
}

function centroDe(edificio) {
  return { x: edificio.cx + (edificio.w ?? 1) / 2, y: edificio.cy + (edificio.h ?? 1) / 2 };
}

function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function construirViviendas(ciudad) {
  // `reservadoJugador` (docs/GDD_Propiedades.md, generar.js): edificio
  // apartado para que un jugador lo compre/alquile — NUNCA se censa ahí una
  // familia NPC, o "comprar" una vivienda podría desalojar a alguien vivo.
  return ciudad.edificios
    .filter((edificio) => !edificio.reservadoJugador)
    .map((edificio) => ({ edificio, capacidad: contarCamas(edificio), ocupantes: [] }))
    .filter((v) => v.capacidad > 0);
}

function construirTrabajos(ciudad, oficiosEdificios, elementosCatalogo) {
  const trabajos = [];
  for (const edificio of ciudad.edificios) {
    if (edificio.reservadoJugador) continue; // mismo criterio: sin NPC trabajando en lo reservado para venta
    for (const [npcId, tipos] of Object.entries(oficiosEdificios)) {
      if (npcId.startsWith("_")) continue;
      if (tipos.includes(edificio.tipoEdificioId)) {
        trabajos.push({ edificio, npcId, capacidad: capacidadTrabajo(edificio, elementosCatalogo), ocupantes: [] });
      }
    }
  }
  return trabajos;
}

/**
 * @param {object} ciudad - de ciudades/src/generar.js generarCiudad()
 * @param {Array} npcs - de poblacion/src/exportarPoblacion.js (se MUTAN: gana .vivienda/.trabajo)
 * @param {object} oficiosEdificios - poblacion/catalogo/oficiosEdificios.json
 * @param {object} [elementosCatalogo] - interiores/catalogo/elementos.json (cargarCatalogos().elementos) — capacidad de trabajo por piezas reales; sin esto, cae a la huella del edificio
 * @returns {{ sinVivienda: string[], sinTrabajo: string[] }} slotIds que no encontraron hueco (censo > capacidad real del bake)
 */
function asignarUbicacion(ciudad, npcs, oficiosEdificios, elementosCatalogo) {
  const viviendas = construirViviendas(ciudad);
  const trabajos = construirTrabajos(ciudad, oficiosEdificios, elementosCatalogo);

  const porFamilia = new Map();
  const unidades = [];
  for (const npc of npcs) {
    // un especial sin techo (vagabundo) no entra al reparto de viviendas:
    // duerme a la intemperie por diseño, no por déficit
    if (npc.sinCasa) continue;
    if (!npc.familiaId) {
      unidades.push([npc]);
      continue;
    }
    if (!porFamilia.has(npc.familiaId)) {
      const lista = [];
      porFamilia.set(npc.familiaId, lista);
      unidades.push(lista);
    }
    porFamilia.get(npc.familiaId).push(npc);
  }
  // Unidades más grandes primero: mejor encaje global, evita que una
  // familia numerosa se quede sin casa por huecos ya gastados en sueltos.
  unidades.sort((a, b) => b.length - a.length);

  const sinVivienda = [];
  for (const unidad of unidades) {
    const candidatas = viviendas
      .filter((v) => v.capacidad - v.ocupantes.length >= unidad.length)
      .sort((a, b) => a.capacidad - a.ocupantes.length - (b.capacidad - b.ocupantes.length));
    const elegida = candidatas[0];
    if (!elegida) {
      sinVivienda.push(...unidad.map((n) => n.slotId));
      continue;
    }
    for (const npc of unidad) {
      elegida.ocupantes.push(npc.slotId);
      npc.vivienda = {
        edificioId: elegida.edificio.interior.id,
        tipoEdificioId: elegida.edificio.tipoEdificioId,
        centro: centroDe(elegida.edificio),
      };
    }
  }

  const sinTrabajo = [];
  for (const npc of npcs) {
    if (npc.rolFamiliar === "hijo") continue;
    const tieneOficioConEdificio = (oficiosEdificios[npc.ficha.npcId] ?? []).length > 0;
    if (!tieneOficioConEdificio) continue; // v1 conocido: aldeano/campesino trabaja el campo, no un interior
    const candidatos = trabajos.filter((t) => t.npcId === npc.ficha.npcId && t.capacidad > t.ocupantes.length);
    if (candidatos.length === 0) {
      sinTrabajo.push(npc.slotId); // su oficio existe pero este asentamiento no tiene hueco/edificio
      // en vez de dejarlo sin trabajo visible: un puesto de mercado fijo
      // cerca de la plaza (GDD_Agentes_Moviles.md v1.3, "vendedores
      // especializados... o puesto exterior si no hace falta obligar a
      // tener tantos edificios tienda") — generarRutina.js lo resuelve.
      npc.puestoExterior = true;
      continue;
    }
    const origen = npc.vivienda?.centro ?? { x: 0, y: 0 };
    candidatos.sort((a, b) => distancia(origen, centroDe(a.edificio)) - distancia(origen, centroDe(b.edificio)));
    const elegido = candidatos[0];
    elegido.ocupantes.push(npc.slotId);
    npc.trabajo = {
      edificioId: elegido.edificio.interior.id,
      tipoEdificioId: elegido.edificio.tipoEdificioId,
      centro: centroDe(elegido.edificio),
    };
  }

  return { sinVivienda, sinTrabajo };
}

module.exports = { asignarUbicacion, contarCamas, capacidadTrabajo };
