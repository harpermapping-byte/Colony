"use strict";

// Edición manual no destructiva sobre el resultado de colocarSala —
// secciones 4/5/6/7/8/9 del pedido de edificios/editor. No sustituye al
// generador: opera sobre lo que colocarSala ya produjo, moviendo/
// rotando/añadiendo/eliminando piezas por su `instanceId` (colocarElementos.js
// ya marca cada pieza colocada como origen:"generado" con un instanceId
// único). Cada operación de aquí pone origen:"modificado" en lo que toca,
// y regenerarMobiliario respeta ("nunca destruye") lo ya marcado
// modificado salvo que se pida explícitamente con forzar:true.

const { colocarSala } = require("./colocarElementos");
const { rotarHuella, rotarOffset, ORIENTACIONES } = require("./rotacion");
const { calcularEstadisticas } = require("./estadisticas");

function buscarItem(resultado, instanceId) {
  for (const capa of ["colocados", "colgados", "techo"]) {
    const arr = resultado[capa];
    const idx = arr.findIndex((it) => it.instanceId === instanceId);
    if (idx !== -1) return { capa, arr, idx, item: arr[idx] };
    for (const host of resultado.colocados) {
      const sobreIdx = (host.sobre || []).findIndex((s) => s.instanceId === instanceId);
      if (sobreIdx !== -1) return { capa: "sobre", arr: host.sobre, idx: sobreIdx, item: host.sobre[sobreIdx], host };
    }
  }
  return null;
}

// Reconstruye qué casillas de suelo están ocupadas a partir de lo que ya
// hay colocado — colocarSala no expone su `libreSuelo` interno (es un
// cierre local), así que la edición lo recalcula desde el propio
// resultado en vez de duplicar ese estado en dos sitios.
function calcularOcupacion(resultado, ignorarInstanceId = null) {
  const ocupadas = new Set();
  for (const item of resultado.colocados) {
    if (item.instanceId === ignorarInstanceId) continue;
    if (item.x === undefined) continue; // colgado/techo no ocupa suelo
    for (let dy = 0; dy < (item.largo || 1); dy++) {
      for (let dx = 0; dx < (item.ancho || 1); dx++) {
        ocupadas.add(`${item.x + dx}_${item.y + dy}`);
      }
    }
  }
  return ocupadas;
}

// Validación de una huella en (x,y): fueraDeLimites es el único motivo de
// bloqueo duro (sección 9: "impedir... ocupar tiles inválidos" — salirse
// de la sala rompe el dato, no es una cuestión de gusto). Solapamiento y
// bloqueo de puerta son avisos, no bloqueos — el diseñador puede
// ignorarlos a propósito (sección 9: "no ser demasiado restrictivo").
function validarHueco(resultado, x, y, ancho, largo, ocupadas, capa) {
  const avisos = [];
  const fueraDeLimites = x < 1 || y < 1 || x + ancho > resultado.ancho - 1 || y + largo > resultado.largo - 1;
  if (fueraDeLimites) return { ok: false, avisos: ["fuera_de_limites"] };

  // La suciedad (GDD sección 7ter) es puramente cosmética — "se puede
  // pisar/superponer con cualquier otra cosa" — nunca avisa de solape.
  let solapa = false;
  if (capa !== "suciedad") {
    for (let dy = 0; dy < largo && !solapa; dy++) {
      for (let dx = 0; dx < ancho && !solapa; dx++) {
        if (ocupadas.has(`${x + dx}_${y + dy}`)) solapa = true;
      }
    }
  }
  if (solapa) avisos.push("solapa_con_otro_mueble");

  const { puerta } = resultado;
  const cubrePuerta = x <= puerta.x && puerta.x < x + ancho && y <= puerta.y && puerta.y < y + largo;
  if (cubrePuerta) avisos.push("bloquea_la_puerta");

  return { ok: true, avisos };
}

// mover — sección 4/9: reposiciona una pieza ya colocada. `forzar:true`
// ignora los avisos de solape/puerta (siguen registrados en la respuesta,
// pero no impiden el movimiento).
function moverElemento(resultado, instanceId, x, y, opts = {}) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  if (item.x === undefined) return { ok: false, avisos: ["esta_pieza_no_esta_en_el_suelo"] }; // colgado/techo/sobre no se "mueve" por tile, sección 10

  const ocupadas = calcularOcupacion(resultado, instanceId);
  const validacion = validarHueco(resultado, x, y, item.ancho, item.largo, ocupadas, item.capa);
  if (!validacion.ok) return validacion;
  if (validacion.avisos.length > 0 && !opts.forzar) return { ok: false, avisos: validacion.avisos, requiereForzar: true };

  item.x = x;
  item.y = y;
  item.origen = "modificado";
  return { ok: true, avisos: validacion.avisos };
}

// rotar — sección 7: rota huella (y tileInteraccion si la pieza declara
// uno) sobre la misma posición; si el nuevo footprint ya no cabe, se
// informa en vez de dejar datos inconsistentes.
function rotarElemento(resultado, instanceId, catalogos, gradosAbsolutos, opts = {}) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  if (item.x === undefined) return { ok: false, avisos: ["esta_pieza_no_esta_en_el_suelo"] };
  if (!ORIENTACIONES.includes(gradosAbsolutos)) return { ok: false, avisos: ["orientacion_invalida"] };

  const def = catalogos.elementos[item.id];
  const huellaBase = def?.huella || [item.ancho, item.largo];
  const [nuevoAncho, nuevoLargo] = rotarHuella(huellaBase, gradosAbsolutos);

  const ocupadas = calcularOcupacion(resultado, instanceId);
  const validacion = validarHueco(resultado, item.x, item.y, nuevoAncho, nuevoLargo, ocupadas, item.capa);
  if (!validacion.ok) return validacion;
  if (validacion.avisos.length > 0 && !opts.forzar) return { ok: false, avisos: validacion.avisos, requiereForzar: true };

  item.ancho = nuevoAncho;
  item.largo = nuevoLargo;
  item.rotacion = gradosAbsolutos;
  if (def?.tileInteraccion) {
    const [ix, iy] = rotarOffset(def.tileInteraccion, huellaBase, gradosAbsolutos);
    item.tileInteraccion = [item.x + ix, item.y + iy];
  }
  item.origen = "modificado";
  return { ok: true, avisos: validacion.avisos };
}

// eliminar — sección 4/9. Funciona en cualquier capa (suelo/pared/techo/
// sobre-superficie).
function eliminarElemento(resultado, instanceId) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  encontrado.arr.splice(encontrado.idx, 1);
  return { ok: true, avisos: [] };
}

let contadorManual = 0;
function nuevoInstanceId(prefijo) {
  contadorManual += 1;
  return `manual_${prefijo}_${Date.now().toString(36)}_${contadorManual}`;
}

// añadir — sección 4/9: coloca una pieza nueva del catálogo en (x,y).
// riquezaMinima/tiposSalaValidos se comprueban solo como aviso — el
// diseñador puede añadir a propósito algo "fuera de catálogo" para esa
// sala si quiere una distribución poco convencional (sección 9).
function anadirElemento(resultado, catalogos, elementoId, x, y, opts = {}) {
  const def = catalogos.elementos[elementoId];
  if (!def) return { ok: false, avisos: ["elemento_desconocido"] };

  const grados = opts.rotacion ?? 0;
  const [ancho, largo] = rotarHuella(def.huella || [1, 1], grados);
  const ocupadas = calcularOcupacion(resultado);
  const validacion = validarHueco(resultado, x, y, ancho, largo, ocupadas, def.capa);
  if (!validacion.ok) return validacion;

  const avisosCatalogo = [];
  if (def.tiposSalaValidos && !def.tiposSalaValidos.includes(resultado.tipoSalaId)) avisosCatalogo.push("tipo_de_sala_no_habitual_para_esta_pieza");
  const avisos = [...validacion.avisos, ...avisosCatalogo];
  if (avisos.length > 0 && !opts.forzar) return { ok: false, avisos, requiereForzar: true };

  const item = { id: elementoId, x, y, ancho, largo, rotacion: grados, colorDebug: def.colorDebug, capa: def.capa, instanceId: nuevoInstanceId(elementoId), origen: "modificado" };
  if (def.aportes) item.aportes = def.aportes;
  if (def.tileInteraccion) {
    const [ix, iy] = rotarOffset(def.tileInteraccion, def.huella || [1, 1], grados);
    item.tileInteraccion = [x + ix, y + iy];
  }
  if (def.esSuperficie) item.esSuperficie = true;
  resultado.colocados.push(item);
  return { ok: true, avisos, instanceId: item.instanceId };
}

// duplicar — sección 9: copia una pieza ya colocada al tile libre más
// cercano (búsqueda simple en espiral corta); si no encuentra hueco en el
// radio de búsqueda, falla explícito en vez de superponer en silencio.
function duplicarElemento(resultado, instanceId) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  if (item.x === undefined) return { ok: false, avisos: ["esta_pieza_no_esta_en_el_suelo"] };

  const ocupadas = calcularOcupacion(resultado);
  const RADIO = 6;
  for (let r = 1; r <= RADIO; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = item.x + dx, y = item.y + dy;
        const validacion = validarHueco(resultado, x, y, item.ancho, item.largo, ocupadas, item.capa);
        if (validacion.ok && validacion.avisos.length === 0) {
          const copia = { ...item, x, y, instanceId: nuevoInstanceId(item.id), origen: "modificado" };
          resultado.colocados.push(copia);
          return { ok: true, avisos: [], instanceId: copia.instanceId };
        }
      }
    }
  }
  return { ok: false, avisos: ["sin_hueco_libre_cerca"] };
}

// sustituir — sección 4: cambia el tipo de catálogo de una pieza ya
// colocada, conservando su posición/rotación mientras quepa; si el nuevo
// tipo no cabe en ese sitio con esa rotación, se informa en vez de dejar
// el dato roto.
function sustituirElemento(resultado, catalogos, instanceId, nuevoElementoId) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  const def = catalogos.elementos[nuevoElementoId];
  if (!def) return { ok: false, avisos: ["elemento_desconocido"] };

  if (item.x !== undefined) {
    const [ancho, largo] = rotarHuella(def.huella || [1, 1], item.rotacion || 0);
    const ocupadas = calcularOcupacion(resultado, instanceId);
    const validacion = validarHueco(resultado, item.x, item.y, ancho, largo, ocupadas, def.capa);
    if (!validacion.ok) return validacion;
    item.ancho = ancho;
    item.largo = largo;
  }
  item.id = nuevoElementoId;
  item.colorDebug = def.colorDebug;
  item.capa = def.capa;
  if (def.aportes) item.aportes = def.aportes;
  else delete item.aportes;
  item.origen = "modificado";
  return { ok: true, avisos: [] };
}

// cambiarTipoSala — sección 8: cambia la clasificación/materiales por
// defecto de la sala sin tocar lo ya colocado (no destructivo por
// definición: esto solo cambia metadatos de la sala, nunca borra piezas).
function cambiarTipoSala(resultado, catalogos, nuevoTipoSalaId) {
  const def = catalogos.tiposSala[nuevoTipoSalaId];
  if (!def) return { ok: false, avisos: ["tipoSala_desconocido"] };
  resultado.tipoSalaId = nuevoTipoSalaId;
  resultado.materialSuelo = def.materialSuelo;
  resultado.materialPared = def.materialPared;
  resultado.origen = "modificado";
  return { ok: true, avisos: [] };
}

// regenerarMobiliario — sección 6: vuelve a generar decorFija/decorMovible/
// iluminacion/suciedad desde cero, pero PRESERVA intactas todas las piezas
// que el usuario ya marcó "modificado" (movidas/rotadas/añadidas/
// sustituidas a mano) y descarta cualquier pieza nueva que caería encima
// de una de ellas — así una regeneración nunca borra una edición manual
// sin que se pida explícitamente con forzar:true (sección 5).
function regenerarMobiliario(resultado, catalogos, opts = {}) {
  const conservadas = opts.forzar ? [] : resultado.colocados.filter((it) => it.origen === "modificado");
  const conservadasColgados = opts.forzar ? [] : resultado.colgados.filter((it) => it.origen === "modificado");
  const conservadasTecho = opts.forzar ? [] : resultado.techo.filter((it) => it.origen === "modificado");

  const semillaRegeneracion = `${resultado.semilla}:regen:${Date.now()}`;
  const fresco = colocarSala({
    tipoSalaId: resultado.tipoSalaId,
    catalogos,
    riqueza: resultado.riqueza,
    amueblado: resultado.amueblado,
    semilla: semillaRegeneracion,
  });

  const ocupadasPorConservadas = new Set();
  for (const it of conservadas) {
    if (it.x === undefined) continue;
    for (let dy = 0; dy < it.largo; dy++) for (let dx = 0; dx < it.ancho; dx++) ocupadasPorConservadas.add(`${it.x + dx}_${it.y + dy}`);
  }
  const frescoLibre = fresco.colocados.filter((it) => {
    if (it.x === undefined) return true;
    for (let dy = 0; dy < it.largo; dy++) for (let dx = 0; dx < it.ancho; dx++) if (ocupadasPorConservadas.has(`${it.x + dx}_${it.y + dy}`)) return false;
    return true;
  });

  resultado.colocados = [...conservadas, ...frescoLibre];
  resultado.colgados = [...conservadasColgados, ...fresco.colgados];
  resultado.techo = [...conservadasTecho, ...fresco.techo];

  const sobreTodos = resultado.colocados.flatMap((c) => c.sobre || []);
  resultado.estadisticas = calcularEstadisticas([...resultado.colocados, ...resultado.colgados, ...resultado.techo, ...sobreTodos]);
  return { ok: true, conservadas: conservadas.length + conservadasColgados.length + conservadasTecho.length, nuevas: frescoLibre.length };
}

// regenerarHabitacion — sección 6/7: si la sala en sí fue editada a mano
// (tipo/tamaño cambiado, origen:"modificado" a nivel de sala) se respeta
// y no se toca salvo forzar:true; si no, regenera su mobiliario igual que
// regenerarMobiliario (la forma/tamaño de la sala nunca cambia sola).
function regenerarHabitacion(resultado, catalogos, opts = {}) {
  if (resultado.origen === "modificado" && !opts.forzar) return { ok: false, avisos: ["sala_modificada_a_mano_usa_forzar"] };
  return regenerarMobiliario(resultado, catalogos, opts);
}

// regenerarPiso / regenerarEdificio — sección 6: aplican regenerarHabitacion
// a cada sala de la planta/edificio, cada una respetando su propio candado
// de "modificado" — regenerar el edificio entero nunca destruye a ciegas
// una sola habitación que el usuario ya afinó a mano.
function regenerarPiso(planta, catalogos, opts = {}) {
  const resultados = planta.salas.map((s) => ({ tipoSalaId: s.tipoSalaId, ...regenerarHabitacion(s.resultado, catalogos, opts) }));
  return { ok: true, salas: resultados };
}

function regenerarEdificio(edificio, catalogos, opts = {}) {
  return { ok: true, plantas: edificio.plantas.map((p) => regenerarPiso(p, catalogos, opts)) };
}

module.exports = {
  moverElemento,
  rotarElemento,
  eliminarElemento,
  anadirElemento,
  duplicarElemento,
  sustituirElemento,
  cambiarTipoSala,
  regenerarMobiliario,
  regenerarHabitacion,
  regenerarPiso,
  regenerarEdificio,
  calcularOcupacion,
  buscarItem,
};
