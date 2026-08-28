"use strict";

// Fase 3 (GDD_Poblacion_NPCs.md): la rutina horaria CONCRETA de un NPC —
// resuelve los tramos abstractos del perfil (casa/trabajo/taberna/plaza)
// a coordenadas reales de SU asentamiento, y a qué sala de SU casa va
// para cada acción de puertas adentro. Determinista por (NPC, día): la
// variación diaria es un jitter pequeño en los horarios, nunca cambia la
// plantilla — "dentro de lo habitual".
const { crearPRNG } = require("../../interiores/src/azar");
const { TRANSITABLES } = require("../../ciudades/src/generar");

const JITTER_MAX_HORAS = 0.75;

function centroPuerta(edificio) {
  return { x: edificio.puerta.x, y: edificio.puerta.y };
}

function edificioDe(ciudad, edificioId) {
  return ciudad.edificios.find((e) => e.interior?.id === edificioId);
}

function buscarTaberna(ciudad) {
  const t = ciudad.edificios.find((e) => e.tipoEdificioId === "taberna" || e.tipoEdificioId === "posada");
  return t ? centroPuerta(t) : null;
}

function buscarTemplo(ciudad) {
  const t = ciudad.edificios.find((e) => e.tipoEdificioId === "templo");
  return t ? centroPuerta(t) : null;
}

// Orilla más cercana a la casa (pescador_mentiroso, GDD_Agentes_Moviles.md
// v1.1) — cacheada por ciudad: escanea la rejilla UNA vez, no por NPC.
const cacheOrillas = new WeakMap();
function tilesDeAgua(ciudad) {
  if (cacheOrillas.has(ciudad)) return cacheOrillas.get(ciudad);
  const tiles = [];
  for (let y = 0; y < ciudad.alto; y++) {
    for (let x = 0; x < ciudad.ancho; x++) {
      if (ciudad.terreno.get(x, y) === "agua") tiles.push({ x, y });
    }
  }
  cacheOrillas.set(ciudad, tiles);
  return tiles;
}

// Pool de casillas pisables distintas alrededor de un centro (zonas
// comunes — plaza/taberna/banco, GDD_Agentes_Moviles.md "no se
// apelotonen"): en vez de un único punto que todo el mundo comparte, un
// anillo de hasta `k` casillas transitables reales, para repartir a los
// NPCs que coinciden ahí SIN que dos acaben en la misma casilla (reparto
// por turno rotatorio, ver `contadorZonas` en resolverLugar). Cacheado por
// (ciudad, centro) — es barato de recalcular pero no hace falta.
const cachePools = new WeakMap();
function poolAlrededorDe(ciudad, centro, k = 10, radioMax = 4) {
  if (!centro) return [];
  let porCentro = cachePools.get(ciudad);
  if (!porCentro) { porCentro = new Map(); cachePools.set(ciudad, porCentro); }
  const clave = `${centro.x},${centro.y}`;
  if (porCentro.has(clave)) return porCentro.get(clave);

  const puntos = [];
  const vistos = new Set();
  for (let r = 0; r <= radioMax && puntos.length < k; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = Math.round(centro.x) + dx, y = Math.round(centro.y) + dy;
        const clavePunto = `${x},${y}`;
        if (vistos.has(clavePunto)) continue;
        vistos.add(clavePunto);
        if (ciudad.terreno.dentro(x, y) && TRANSITABLES.has(ciudad.terreno.get(x, y))) puntos.push({ x, y });
        if (puntos.length >= k) break;
      }
      if (puntos.length >= k) break;
    }
  }
  if (puntos.length === 0) puntos.push({ x: Math.round(centro.x), y: Math.round(centro.y) });
  porCentro.set(clave, puntos);
  return puntos;
}

function puntoDeAgua(ciudad, casaPunto) {
  const tiles = tilesDeAgua(ciudad);
  if (tiles.length === 0) return null; // asentamiento sin río/lago intramuros
  let mejor = tiles[0], mejorDist = Infinity;
  for (const t of tiles) {
    const d = Math.hypot(t.x - casaPunto.x, t.y - casaPunto.y);
    if (d < mejorDist) { mejorDist = d; mejor = t; }
  }
  return mejor;
}

// Huertos intramuros reales del bake (ciudades/src/generar.js: zonas verdes
// con un 45% de salir como "tierra_labrada") — no todo asentamiento tiene
// uno. `ciudad.zonasVerdes` ya trae el centro/radio de cada uno, así que no
// hace falta escanear la rejilla entera como antes.
//
// Antes: el punto de campo era la casilla tierra_labrada literalmente más
// cercana a la casa — con varios campesinos en el mismo huerto (normal en
// una aldea pequeña, un único huerto para todos), todos convergían en la
// MISMA casilla exacta (mismo bug de apelotonamiento que plaza/taberna/
// banco, sección "no se apelotonen" de GDD_Agentes_Moviles.md — este caso
// se quedó sin arreglar en aquella pasada). Ahora se busca la ZONA de
// huerto más cercana (no la casilla) y el reparto de casilla dentro de
// ella pasa por el mismo `elegirDePool` que ya usan plaza/taberna/banco —
// varios agricultores en el mismo huerto, cada uno en su propia casilla.
function zonaCampoMasCercana(ciudad, casaPunto) {
  const huertos = (ciudad.zonasVerdes ?? []).filter((z) => z.tipo === "huerto");
  if (huertos.length === 0) return null; // este bake no tiene huerto: se resolverá al placeholder junto a la puerta
  let mejor = huertos[0];
  let mejorDist = Infinity;
  for (const z of huertos) {
    const d = Math.hypot(z.x - casaPunto.x, z.y - casaPunto.y);
    if (d < mejorDist) { mejorDist = d; mejor = z; }
  }
  return { x: Math.round(mejor.x), y: Math.round(mejor.y) };
}

function salaParaAccion(edificio, accion, accionesPorSala) {
  const tipos = accionesPorSala[accion];
  if (!tipos || !edificio?.interior) return null;
  for (const planta of edificio.interior.plantas) {
    for (const sala of planta.salas) {
      if (tipos.includes(sala.tipoSalaId)) return { tipoSalaId: sala.tipoSalaId, planta: planta.nivel };
    }
  }
  return null; // su casa no tiene esa sala: se queda junto a la puerta, no rompe nada
}

// Punto de guardia de una puerta de muralla: un par de casillas hacia el
// INTERIOR (pedido del streamer: el guardia hace guardia dentro del anillo,
// no en el vano), acercándose al punto focal de la ciudad.
function puestoDePuerta(puerta, focal) {
  if (!focal) return { x: puerta.x, y: puerta.y };
  const dx = focal.x - puerta.x;
  const dy = focal.y - puerta.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: Math.round(puerta.x + (dx / d) * 2.5), y: Math.round(puerta.y + (dy / d) * 2.5) };
}

function muestrear(pool, n, rnd) {
  const copia = pool.slice();
  const sacados = [];
  while (copia.length && sacados.length < n) sacados.push(copia.splice(Math.floor(rnd() * copia.length), 1)[0]);
  return sacados;
}

// Reparto rotatorio por zona (plaza/taberna/banco de TODO el asentamiento,
// no por NPC): cada vez que un tramo cae en esa zona, se le da la
// SIGUIENTE casilla del anillo — así dos NPCs que coincidan ahí (a
// cualquier hora, en cualquier día) nunca comparten literalmente la misma
// casilla. `ctx.contadorZonas` es un objeto MUTABLE compartido por todos
// los NPCs del asentamiento (exportarAsentamiento.js lo crea una vez).
function elegirDePool(ctx, clave, centro) {
  if (!centro) return null;
  const pool = poolAlrededorDe(ctx.ciudad, centro, 10, 4);
  const i = ctx.contadorZonas[clave] ?? 0;
  ctx.contadorZonas[clave] = i + 1;
  return pool[i % pool.length];
}

function resolverLugar(lugar, ctx, rnd) {
  switch (lugar) {
    case "casa":
      return ctx.casaPunto;
    case "trabajo":
      return ctx.trabajoPunto ?? ctx.casaPunto;
    case "taberna":
      return elegirDePool(ctx, "taberna", ctx.tabernaPunto) ?? ctx.plazaPunto ?? ctx.casaPunto;
    case "plaza":
      return elegirDePool(ctx, "plaza", ctx.plazaPunto) ?? ctx.casaPunto;
    case "campo":
      // Huerto real del bake (tierra_labrada) más cercano a su casa,
      // repartido por casilla igual que plaza/taberna/banco (varios
      // agricultores del mismo huerto no comparten literalmente la misma
      // casilla). Si este asentamiento no tiene ninguno, cae junto a su
      // propia puerta (placeholder v1 — no todo bake tiene huerto).
      return (ctx.campoZona && elegirDePool(ctx, `campo_${ctx.campoZona.x}_${ctx.campoZona.y}`, ctx.campoZona)) ?? ctx.casaPunto;
    case "banco":
      // sitio para sentarse a la intemperie: una zona verde; sin ellas, la plaza
      return elegirDePool(ctx, "banco", ctx.bancoPunto) ?? ctx.plazaPunto ?? ctx.casaPunto;
    case "puesto":
      // puesto de guardia asignado (npc.puestoPuerta) — parte interior de la puerta
      return ctx.puestoPunto ?? ctx.plazaPunto ?? ctx.casaPunto;
    case "ronda": {
      // bucle de patrulla/venta: todas las puertas (por dentro) pasando por
      // la plaza entre puerta y puerta — el orden lo baraja el día
      if (!ctx.rondaParadas || ctx.rondaParadas.length < 2) return ctx.plazaPunto ?? ctx.casaPunto;
      const puertas = muestrear(ctx.rondaParadas, ctx.rondaParadas.length, rnd);
      const paradas = [];
      for (const p of puertas) {
        paradas.push(p);
        if (ctx.plazaPunto) paradas.push(ctx.plazaPunto);
      }
      return { paradas };
    }
    case "ronda_tiendas": {
      // el recaudador: bucle por las tiendas del asentamiento (mismo
      // mecanismo que "ronda" pero con el pool de comercios, no de puertas)
      if (!ctx.tiendaPuntos || ctx.tiendaPuntos.length < 2) return ctx.plazaPunto ?? ctx.casaPunto;
      return { paradas: muestrear(ctx.tiendaPuntos, ctx.tiendaPuntos.length, rnd) };
    }
    case "rio":
      // orilla real del bake más cercana a su casa; sin río/lago intramuros, la plaza
      return ctx.rioPunto ?? ctx.plazaPunto ?? ctx.casaPunto;
    case "templo":
      return ctx.temploPunto ?? ctx.plazaPunto ?? ctx.casaPunto;
    case "deambular": {
      // callejeo: 3-5 puntos distintos del pool urbano, DISTINTOS cada día
      const pool = ctx.deambularPool ?? [];
      if (pool.length < 2) return ctx.plazaPunto ?? ctx.casaPunto;
      return { paradas: muestrear(pool, 3 + Math.floor(rnd() * 3), rnd) };
    }
    case "ocio": {
      // tiempo libre ALEATORIO POR DÍA (pedido del streamer): cada día del
      // mismo NPC sale distinto — taberna, plaza, banco, mirar tiendas o un
      // paseo corto. Misma plantilla, días que no se repiten.
      const opciones = [
        () => elegirDePool(ctx, "taberna", ctx.tabernaPunto) ?? ctx.plazaPunto,
        () => elegirDePool(ctx, "plaza", ctx.plazaPunto),
        () => elegirDePool(ctx, "banco", ctx.bancoPunto) ?? ctx.plazaPunto,
        () => (ctx.tiendaPuntos?.length ? ctx.tiendaPuntos[Math.floor(rnd() * ctx.tiendaPuntos.length)] : null),
        () => (ctx.deambularPool?.length >= 2 ? { paradas: muestrear(ctx.deambularPool, 2, rnd) } : null),
      ];
      return opciones[Math.floor(rnd() * opciones.length)]() ?? ctx.casaPunto;
    }
    default:
      return ctx.casaPunto;
  }
}

function jitter(rnd) {
  return (rnd() * 2 - 1) * JITTER_MAX_HORAS;
}

/**
 * @param {object} npc - con .vivienda/.trabajo (Fase 2) y .perfilSocial (asignarPerfil)
 * @param {object} ciudad - de ciudades/src/generar.js generarCiudad()
 * @param {object} catalogos - poblacion/src/catalogo.js (perfilesSociales, accionesPorSala)
 * @param {number} dia - día de juego, para la variación determinista dentro de lo habitual
 * @returns {Array<{lugar, accion, horaInicio, horaFin, punto: {x,y}, sala: {tipoSalaId,planta}|null}>}
 */
// `contadorZonas` (opcional): objeto MUTABLE compartido entre TODOS los
// NPCs del asentamiento (exportarAsentamiento.js lo crea una vez y lo pasa
// en cada llamada) — reparte las zonas comunes sin que dos coincidan en la
// misma casilla (ver elegirDePool). Sin él (llamada suelta, tests), cada
// NPC actúa como si fuera el único de su asentamiento — sigue siendo
// determinista, solo pierde el reparto colectivo.
function generarRutina(npc, ciudad, catalogos, dia = 0, contadorZonas = {}) {
  const perfil = catalogos.perfilesSociales[npc.perfilSocial];
  if (!perfil) return [];

  const edificioTrabajo = npc.trabajo ? edificioDe(ciudad, npc.trabajo.edificioId) : null;
  // "Casa" en cadena de respaldo (el censo puede pedir más gente que camas
  // hay — déficit conocido de Fase 2, que antes dejaba al NPC SIN rutina,
  // invisible): 1) su vivienda; 2) duerme donde trabaja (el guardia en el
  // cuartel, el cura en el templo, el panadero en la trastienda — de época);
  // 3) la posada/taberna como pensión. Los perfiles sinCasa (vagabundo)
  // saltan la cadena: su intemperie es diseño, no déficit.
  let edificioCasa = npc.vivienda ? edificioDe(ciudad, npc.vivienda.edificioId) : null;
  if (!edificioCasa && !perfil.sinCasa) {
    edificioCasa =
      edificioTrabajo ??
      ciudad.edificios.find((e) => e.tipoEdificioId === "posada" || e.tipoEdificioId === "taberna") ??
      null;
    if (!edificioCasa) return []; // ni casa, ni trabajo, ni posada: este bake no tiene dónde meterlo
  }
  // qué edificio es "casa" para este NPC (GDD_Agentes_Moviles.md "vida en
  // interiores"): InteriorRoom lo usa para saber a quién poner dentro de
  // qué instancia — npc ya viene por referencia, se muta como el resto de
  // campos derivados de la rutina (perfilSocial, etc.)
  npc.casaEdificioId = edificioCasa?.interior?.id ?? null;
  // qué edificio es "trabajo" (vendedores especializados, GDD_Agentes_
  // Moviles.md v1.3: "estar en su tienda interior vendiendo") — igual que
  // casaEdificioId, InteriorRoom lo usa para poner al tendero DENTRO de su
  // tienda durante su horario, no solo en la puerta.
  npc.trabajoEdificioId = edificioTrabajo?.interior?.id ?? null;
  const focal = ciudad.focal ?? null;
  // sitio de "sentarse fuera": un parque si lo hay (un huerto es de labor,
  // no de descanso — solo cae ahí si no hay parque)
  const zonasVerdes = ciudad.zonasVerdes ?? [];
  const zonaBanco = zonasVerdes.find((z) => z.tipo === "parque") ?? zonasVerdes[0];
  const bancoPunto = zonaBanco ? { x: Math.round(zonaBanco.x), y: Math.round(zonaBanco.y) } : null;
  const puertasInterior = (ciudad.puertas ?? []).map((p) => puestoDePuerta(p, focal));
  const tiendaPuntos = ciudad.edificios
    .filter((e) => ["tienda", "panaderia", "sastreria", "joyeria", "alfareria", "taberna", "posada"].includes(e.tipoEdificioId))
    .map(centroPuerta);
  const casaPunto = edificioCasa ? centroPuerta(edificioCasa) : (bancoPunto ?? focal ?? { x: 0, y: 0 });
  const ctx = {
    ciudad,
    contadorZonas,
    casaPunto,
    // sin edificio propio (déficit, o un oficio con más gente que huecos
    // reales — asignarUbicacion.js lo marca con npc.puestoExterior): un
    // puesto de mercado fijo cerca de la plaza en vez de dejarlo sin
    // trabajo visible — así no hace falta un edificio-tienda por cada
    // vendedor (pedido del streamer 2026-08-28).
    trabajoPunto: edificioTrabajo
      ? centroPuerta(edificioTrabajo)
      : npc.puestoExterior
        ? elegirDePool({ ciudad, contadorZonas }, "puestoMercado", focal)
        : null,
    tabernaPunto: buscarTaberna(ciudad),
    plazaPunto: focal,
    campoZona: zonaCampoMasCercana(ciudad, casaPunto),
    bancoPunto,
    // puesto asignado del guardia de puerta (asignarEspeciales reparte índices)
    puestoPunto: npc.puestoPuerta != null ? puertasInterior[npc.puestoPuerta % Math.max(1, puertasInterior.length)] : null,
    rondaParadas: puertasInterior,
    deambularPool: [...puertasInterior, ...(focal ? [focal] : []), ...tiendaPuntos],
    tiendaPuntos,
    temploPunto: buscarTemplo(ciudad),
    rioPunto: puntoDeAgua(ciudad, casaPunto),
  };

  const rnd = crearPRNG(`${npc.slotId}|rutina|dia${dia}`);
  return perfil.tramos.map((tramo) => {
    const resuelto = resolverLugar(tramo.lugar, ctx, rnd);
    const paradas = resuelto?.paradas ?? null;
    return {
      lugar: tramo.lugar,
      accion: tramo.accion,
      horaInicio: Number((tramo.horaInicio + jitter(rnd)).toFixed(2)),
      horaFin: Number((tramo.horaFin + jitter(rnd)).toFixed(2)),
      // con paradas, el "punto" del tramo es la primera — es donde empieza
      // el bucle y el origen que usa el tramo siguiente para su camino
      punto: paradas ? { x: paradas[0].x, y: paradas[0].y } : resuelto,
      paradas: paradas ? paradas.map((p) => ({ x: p.x, y: p.y })) : undefined,
      sala:
        tramo.lugar === "casa" && edificioCasa
          ? salaParaAccion(edificioCasa, tramo.accion, catalogos.accionesPorSala)
          : tramo.lugar === "trabajo" && edificioTrabajo
            ? salaParaAccion(edificioTrabajo, "trabajar", catalogos.accionesPorSala)
            : null,
    };
  });
}

module.exports = { generarRutina };
