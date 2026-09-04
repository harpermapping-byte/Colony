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
const { reglasParaElemento } = require("./catalogoContenido");
const { segmentosDePared } = require("./formasSala");

// reglas por defecto cuando no hay definición de catálogo a mano (item
// suelto sin `catalogos`, o id no encontrado) — reproduce EXACTAMENTE el
// comportamiento que ya tenía este archivo antes del catálogo de
// contenido: solo la suciedad podía solaparse, nada bloqueaba puerta "de
// más". `reglasParaElemento` (catalogoContenido.js) da estos mismos
// valores por defecto para cualquier elemento sin overrides explícitos,
// así que pasar o no `catalogos` no cambia el resultado salvo que una
// pieza declare `puedeSolapar`/`puedeBloquearPuerta`/`rotacionesPermitidas`
// a propósito (sección 8 del pedido de catálogo de contenido).
function reglasDe(catalogos, elementoId, capaFallback) {
  const def = catalogos?.elementos?.[elementoId];
  if (def) return reglasParaElemento(def);
  return reglasParaElemento({ capa: capaFallback });
}

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

// Comprueba que TODA la huella (x,y,ancho,largo) cae en suelo real de
// resultado.mascara (string 'ancho*largo' de '1'/'0', mismo formato que
// interiorColision.ts) — llamar solo cuando resultado.mascara existe.
function huellaDentroDeMascara(resultado, x, y, ancho, largo) {
  const { mascara, ancho: anchoSala } = resultado;
  for (let dy = 0; dy < largo; dy++) {
    for (let dx = 0; dx < ancho; dx++) {
      if (mascara[(y + dy) * anchoSala + (x + dx)] !== "1") return false;
    }
  }
  return true;
}

// ---- Puertas y ventanas como instancia editable (2026-09-04) ----
// El generador automático solo punza la puerta en el muro sur y las
// ventanas en el muro norte (colocarElementos.js — cada sala aislada no
// sabe qué pared da a fuera hasta que edificio.js compone la planta
// entera, ver comentario ahí). El editor, en cambio, SÍ deja al streamer
// decidir a mano cualquiera de los 4 lados del perímetro real de la
// sala — mismo dato (`resultado.mascara`), reusando la MISMA función que
// ya usan los renderers de verificación (formasSala.js:segmentosDePared)
// para no duplicar el cálculo de "qué casilla de suelo toca pared de
// verdad" por tercera vez.

// Perímetro real de la sala como lista de {x,y,lado} — una esquina
// cóncava puede aparecer más de una vez (toca pared en dos lados a la
// vez), exactamente igual que ya asume segmentosDePared en sus otros usos.
function segmentosPerimetro(resultado) {
  return segmentosDePared({ ancho: resultado.ancho, largo: resultado.largo, mascara: resultado.mascara });
}

// Casilla de suelo INTERIOR justo detrás de la puerta (el umbral real de
// entrada) — generaliza el `entradaY = resultado.largo-1` que este
// archivo usaba antes (asumía la puerta siempre en el muro sur) a los 4
// lados posibles ahora que moverPuerta permite cualquiera. Sin `puerta`
// (no debería pasar, colocarSala siempre la coloca) o con un `lado`
// desconocido, cae al comportamiento de siempre (sur) por compatibilidad
// con datos guardados antes de este catálogo.
function umbralPuerta(resultado) {
  const { puerta, ancho, largo } = resultado;
  if (!puerta) return null;
  if (puerta.lado === "norte") return { x: puerta.x, y: 0 };
  if (puerta.lado === "este") return { x: ancho - 1, y: puerta.y };
  if (puerta.lado === "oeste") return { x: 0, y: puerta.y };
  return { x: puerta.x, y: largo - 1 }; // sur (o dato legacy sin lado)
}

// Punto EXTERIOR (el hueco en sí, una casilla más allá del límite) para
// una puerta que cae en (x,y) interior con ese `lado` — inverso de
// umbralPuerta, mismo criterio de siempre: el muro no ocupa casilla
// propia, la puerta es el hueco justo al otro lado del límite.
function exteriorDePuerta(x, y, lado, ancho, largo) {
  if (lado === "norte") return { x, y: -1 };
  if (lado === "este") return { x: ancho, y };
  if (lado === "oeste") return { x: -1, y };
  return { x, y: largo }; // sur
}

// Casillas de suelo interior que ocuparía un tramo de ventana de `ancho`
// tiles arrancando en (x,y) — crece en X para norte/sur (recorre el
// muro horizontal), en Y para este/oeste (recorre el muro vertical).
// Mismo sentido de recorrido que ya usa colocarElementos.js para sus
// propias ventanas automáticas (siempre norte, crecen en X).
function celdasVentana(lado, x, y, ancho) {
  const celdas = [];
  for (let i = 0; i < ancho; i++) celdas.push(lado === "norte" || lado === "sur" ? { x: x + i, y } : { x, y: y + i });
  return celdas;
}

function clave(x, y) { return `${x}_${y}`; }

// Valida un tramo de ventana contra el perímetro real: fuera de perímetro
// es bloqueo duro (una ventana no puede flotar en el vacío, mismo
// criterio que "fuera_de_limites" para muebles); coincidir con el umbral
// de la puerta o con un borde ya usado (bordesOcupados — colgado o
// ventana ya puesta ahí, el mismo Set que ya usa colocarElementos.js)
// son avisos forzables. `ignorarInstanceId` (moverVentana): no cuenta el
// propio tramo viejo de la ventana que se está reubicando como "ya
// ocupado" contra sí misma.
function validarTramoVentana(resultado, lado, x, y, ancho, ignorarInstanceId) {
  const segmentos = segmentosPerimetro(resultado);
  const celdas = celdasVentana(lado, x, y, ancho);
  for (const c of celdas) {
    if (!segmentos.some((s) => s.x === c.x && s.y === c.y && s.lado === lado)) return { ok: false, avisos: ["fuera_de_perimetro"] };
  }

  const bordesOcupados = new Set(resultado.bordesOcupados || []);
  if (ignorarInstanceId) {
    const propia = (resultado.ventanas || []).find((v) => v.instanceId === ignorarInstanceId);
    if (propia) for (const c of celdasVentana(propia.lado, propia.x, propia.y ?? 0, propia.ancho)) bordesOcupados.delete(clave(c.x, c.y));
  }
  const umbral = umbralPuerta(resultado);
  const avisos = [];
  for (const c of celdas) {
    if (umbral && c.x === umbral.x && c.y === umbral.y) avisos.push("coincide_con_la_puerta");
    if (bordesOcupados.has(clave(c.x, c.y))) avisos.push("borde_ya_ocupado");
  }
  return { ok: true, avisos: [...new Set(avisos)] };
}

// Validación de una huella en (x,y): fueraDeLimites es el único motivo de
// bloqueo duro (sección 9: "impedir... ocupar tiles inválidos" — salirse
// de la sala rompe el dato, no es una cuestión de gusto). Solapamiento y
// bloqueo de puerta son avisos, no bloqueos — el diseñador puede
// ignorarlos a propósito (sección 9: "no ser demasiado restrictivo").
// `reglas` viene del catálogo de contenido (catalogoContenido.js sección
// 8 de ese pedido: "el catálogo únicamente debe proporcionar las reglas;
// la política de bloqueo sigue perteneciendo al sistema de edición") —
// este archivo decide qué hacer con `puedeSolapar`/`puedeBloquearPuerta`,
// el catálogo solo dice si la pieza los tiene marcados.
function validarHueco(resultado, x, y, ancho, largo, ocupadas, reglas) {
  const avisos = [];
  // El muro no ocupa casilla propia (ver colocarElementos.js): con una sala
  // rectangular (resultado.mascara ausente), el rectángulo entero
  // resultado.ancho x resultado.largo es suelo válido, sin margen que
  // restar. Con una sala de plantilla no rectangular (catalogo/formasSala.json),
  // "fuera de límites" incluye también salirse de la máscara real — mismo
  // bloqueo duro que salirse de la caja, no un aviso ignorable: una pieza
  // fuera de la forma real de la sala es un dato roto, no una cuestión de
  // gusto (mismo criterio que ya aplica el resto de esta función).
  const fueraDeLimites =
    x < 0 || y < 0 || x + ancho > resultado.ancho || y + largo > resultado.largo ||
    (resultado.mascara && !huellaDentroDeMascara(resultado, x, y, ancho, largo));
  if (fueraDeLimites) return { ok: false, avisos: ["fuera_de_limites"] };

  let solapa = false;
  if (!reglas.puedeSolapar) {
    for (let dy = 0; dy < largo && !solapa; dy++) {
      for (let dx = 0; dx < ancho && !solapa; dx++) {
        if (ocupadas.has(`${x + dx}_${y + dy}`)) solapa = true;
      }
    }
  }
  if (solapa) avisos.push("solapa_con_otro_mueble");

  // La puerta en sí ya no es una casilla de suelo (cae justo fuera del
  // perímetro real) — "bloquear la puerta" significa tapar la casilla de
  // suelo pegada a ese hueco, por donde se entra de verdad. Antes de
  // moverPuerta (sección "puertas y ventanas como instancia editable",
  // 2026-09-04) la puerta SIEMPRE estaba en el muro sur (entradaY =
  // resultado.largo-1, fijo); ahora puede estar en cualquiera de los 4
  // lados del perímetro, así que el umbral se calcula por `puerta.lado`
  // (umbralPuerta, más abajo) en vez de asumir siempre sur.
  const umbral = umbralPuerta(resultado);
  const cubrePuerta = !!umbral && x <= umbral.x && umbral.x < x + ancho && y <= umbral.y && umbral.y < y + largo;
  if (cubrePuerta && !reglas.puedeBloquearPuerta) avisos.push("bloquea_la_puerta");

  return { ok: true, avisos };
}

// mover — sección 4/9: reposiciona una pieza ya colocada. `forzar:true`
// ignora los avisos de solape/puerta (siguen registrados en la respuesta,
// pero no impiden el movimiento). `opts.catalogos` es opcional — sin él
// se usan las reglas por defecto (mismo comportamiento que antes del
// catálogo de contenido).
function moverElemento(resultado, instanceId, x, y, opts = {}) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  if (item.x === undefined) return { ok: false, avisos: ["esta_pieza_no_esta_en_el_suelo"] }; // colgado/techo/sobre no se "mueve" por tile, sección 10

  const ocupadas = calcularOcupacion(resultado, instanceId);
  const reglas = reglasDe(opts.catalogos, item.id, item.capa);
  const validacion = validarHueco(resultado, x, y, item.ancho, item.largo, ocupadas, reglas);
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
  const reglas = reglasDe(catalogos, item.id, item.capa);

  // rotacionesPermitidas (catálogo, opcional): aviso forzable, no bloqueo
  // duro — misma filosofía que solape/puerta (sección 8/9 del pedido de
  // catálogo). Sin esa restricción declarada (la mayoría de piezas), las
  // 4 orientaciones siguen abiertas como siempre.
  const avisosRotacion = reglas.rotacionesPermitidas && !reglas.rotacionesPermitidas.includes(gradosAbsolutos) ? ["rotacion_no_habitual_para_esta_pieza"] : [];

  const ocupadas = calcularOcupacion(resultado, instanceId);
  const validacion = validarHueco(resultado, item.x, item.y, nuevoAncho, nuevoLargo, ocupadas, reglas);
  if (!validacion.ok) return validacion;
  const avisos = [...validacion.avisos, ...avisosRotacion];
  if (avisos.length > 0 && !opts.forzar) return { ok: false, avisos, requiereForzar: true };

  item.ancho = nuevoAncho;
  item.largo = nuevoLargo;
  item.rotacion = gradosAbsolutos;
  if (def?.tileInteraccion) {
    const [ix, iy] = rotarOffset(def.tileInteraccion, huellaBase, gradosAbsolutos);
    item.tileInteraccion = [item.x + ix, item.y + iy];
  }
  item.origen = "modificado";
  return { ok: true, avisos };
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

// moverPuerta — puertas/ventanas como instancia editable (2026-09-04):
// reubica la puerta de la sala a otra casilla del PERÍMETRO REAL, en
// cualquiera de los 4 lados (el generador automático solo la punza en el
// sur — ver colocarElementos.js — pero nada en el resto del motor asume
// eso salvo lo que este mismo archivo ya generalizó arriba con
// umbralPuerta). `lado` es opcional: con una esquina cóncava (la misma
// casilla toca pared en 2 lados a la vez) se puede pedir explícito cuál
// de los dos se quiere; sin pedirlo, se usa el primero que encuentre
// segmentosPerimetro.
function moverPuerta(resultado, x, y, opts = {}) {
  const candidatos = segmentosPerimetro(resultado).filter((s) => s.x === x && s.y === y);
  if (candidatos.length === 0) return { ok: false, avisos: ["no_es_perimetro_valido"] };
  const lado = opts.lado && candidatos.some((c) => c.lado === opts.lado) ? opts.lado : candidatos[0].lado;

  // Mismo aviso forzable "bloquea_la_puerta" que ya existía para muebles
  // (validarHueco) — aquí en sentido inverso: un mueble ya puesto en la
  // casilla que pasaría a ser el nuevo umbral.
  const avisos = calcularOcupacion(resultado).has(clave(x, y)) ? ["bloquea_la_puerta"] : [];
  if (avisos.length > 0 && !opts.forzar) return { ok: false, avisos, requiereForzar: true };

  const destino = exteriorDePuerta(x, y, lado, resultado.ancho, resultado.largo);
  resultado.puerta = { lado, x: destino.x, y: destino.y, origen: "modificado" };
  return { ok: true, avisos };
}

// anadirVentana — coloca una ventana nueva en un tramo de `ancho` tiles
// del perímetro real, arrancando en (x,y) en el `lado` dado. Los 4 ejes
// de catálogo (forma/tamano/marco/cristal, ventanas.json) son opcionales
// — sin especificar, se usa el primero disponible de cada uno (mismo
// catálogo que ya consulta colocarElementos.js, ejeValido ahí).
function primerIdCatalogo(seccion) {
  const entradas = Object.entries(seccion || {}).filter(([id]) => !id.startsWith("_"));
  return entradas.length > 0 ? entradas[0] : null;
}
function anadirVentana(resultado, catalogos, x, y, lado, opts = {}) {
  const catV = catalogos.ventanas || {};
  const elegirEje = (seccion, idPedido) => (idPedido && seccion?.[idPedido] ? [idPedido, seccion[idPedido]] : primerIdCatalogo(seccion));
  const formaEntrada = elegirEje(catV.forma, opts.forma);
  const tamanoEntrada = elegirEje(catV.tamano, opts.tamano);
  const marcoEntrada = elegirEje(catV.marco, opts.marco);
  const cristalEntrada = elegirEje(catV.cristal, opts.cristal);
  if (!formaEntrada || !tamanoEntrada || !marcoEntrada || !cristalEntrada) return { ok: false, avisos: ["catalogo_ventanas_incompleto"] };
  const [formaId, formaDef] = formaEntrada;
  const [tamanoId, tamanoDef] = tamanoEntrada;
  const [marcoId] = marcoEntrada;
  const [cristalId, cristalDef] = cristalEntrada;

  const ancho = tamanoDef.anchoTiles || 1;
  const validacion = validarTramoVentana(resultado, lado, x, y, ancho);
  if (!validacion.ok) return validacion;
  if (validacion.avisos.length > 0 && !opts.forzar) return { ok: false, avisos: validacion.avisos, requiereForzar: true };

  // Misma fórmula de aporteLuz que colocarElementos.js (GDD_Bakeador_Interiores
  // §7bis) — no reinventarla aquí, para que una ventana añadida a mano
  // aporte luz ambiente exactamente igual que una generada.
  const factorTamano = tamanoDef.aporteLuz ?? tamanoDef.anchoTiles * (tamanoDef.altaEnPared ? 0.6 : 1);
  const factorCristal = cristalDef.aporteLuz ?? 1;
  const aporteLuz = Math.round(factorTamano * factorCristal * 100) / 100;

  const item = {
    instanceId: nuevoInstanceId("ventana"), x, y, lado, ancho,
    forma: formaId, tamano: tamanoId, marco: marcoId, cristal: cristalId,
    aporteLuz, colorDebug: formaDef.colorDebug || "#a9c9d6", origen: "modificado",
  };
  resultado.ventanas = [...(resultado.ventanas || []), item];
  const nuevosBordes = celdasVentana(lado, x, y, ancho).map((c) => clave(c.x, c.y));
  resultado.bordesOcupados = [...new Set([...(resultado.bordesOcupados || []), ...nuevosBordes])];
  return { ok: true, avisos: validacion.avisos, instanceId: item.instanceId };
}

// moverVentana — reubica una ventana ya colocada (a mano o generada) a
// otro tramo del perímetro, opcionalmente cambiando de lado; conserva su
// forma/tamaño/marco/cristal/aporteLuz. Libera su tramo viejo de
// bordesOcupados antes de validar el nuevo (para no chocar consigo misma
// si se mueve dentro del mismo muro), igual que moverElemento ignora la
// propia huella al recalcular ocupación.
function moverVentana(resultado, instanceId, x, y, opts = {}) {
  const v = (resultado.ventanas || []).find((it) => it.instanceId === instanceId);
  if (!v) return { ok: false, avisos: ["ventana_no_encontrada"] };
  const ladoFinal = opts.lado || v.lado;

  const validacion = validarTramoVentana(resultado, ladoFinal, x, y, v.ancho, instanceId);
  if (!validacion.ok) return validacion;
  if (validacion.avisos.length > 0 && !opts.forzar) return { ok: false, avisos: validacion.avisos, requiereForzar: true };

  const viejos = new Set(celdasVentana(v.lado, v.x, v.y ?? 0, v.ancho).map((c) => clave(c.x, c.y)));
  resultado.bordesOcupados = (resultado.bordesOcupados || []).filter((k) => !viejos.has(k));
  v.lado = ladoFinal; v.x = x; v.y = y; v.origen = "modificado";
  const nuevosBordes = celdasVentana(ladoFinal, x, y, v.ancho).map((c) => clave(c.x, c.y));
  resultado.bordesOcupados = [...new Set([...(resultado.bordesOcupados || []), ...nuevosBordes])];
  return { ok: true, avisos: validacion.avisos };
}

// eliminarVentana — quita una ventana ya colocada (a mano o generada) y
// libera su tramo de bordesOcupados, para que un colgado/otra ventana
// pueda ocupar ese mismo sitio después.
function eliminarVentana(resultado, instanceId) {
  const idx = (resultado.ventanas || []).findIndex((v) => v.instanceId === instanceId);
  if (idx === -1) return { ok: false, avisos: ["ventana_no_encontrada"] };
  const [v] = resultado.ventanas.splice(idx, 1);
  const libres = new Set(celdasVentana(v.lado, v.x, v.y ?? 0, v.ancho).map((c) => clave(c.x, c.y)));
  resultado.bordesOcupados = (resultado.bordesOcupados || []).filter((k) => !libres.has(k));
  return { ok: true, avisos: [] };
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
  const reglas = reglasParaElemento(def);
  const ocupadas = calcularOcupacion(resultado);
  const validacion = validarHueco(resultado, x, y, ancho, largo, ocupadas, reglas);
  if (!validacion.ok) return validacion;

  const avisosCatalogo = [];
  if (def.tiposSalaValidos && !def.tiposSalaValidos.includes(resultado.tipoSalaId)) avisosCatalogo.push("tipo_de_sala_no_habitual_para_esta_pieza");
  if (reglas.rotacionesPermitidas && !reglas.rotacionesPermitidas.includes(grados)) avisosCatalogo.push("rotacion_no_habitual_para_esta_pieza");
  const avisos = [...validacion.avisos, ...avisosCatalogo];
  if (avisos.length > 0 && !opts.forzar) return { ok: false, avisos, requiereForzar: true };

  const item = { id: elementoId, x, y, ancho, largo, rotacion: grados, colorDebug: def.colorDebug, capa: def.capa, instanceId: nuevoInstanceId(elementoId), origen: "modificado", estado: opts.estado || { desgastado: false, roto: false, sucio: false } };
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
function duplicarElemento(resultado, instanceId, opts = {}) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  if (item.x === undefined) return { ok: false, avisos: ["esta_pieza_no_esta_en_el_suelo"] };

  const reglas = reglasDe(opts.catalogos, item.id, item.capa);
  const ocupadas = calcularOcupacion(resultado);
  const RADIO = 6;
  for (let r = 1; r <= RADIO; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = item.x + dx, y = item.y + dy;
        const validacion = validarHueco(resultado, x, y, item.ancho, item.largo, ocupadas, reglas);
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
    const validacion = validarHueco(resultado, item.x, item.y, ancho, largo, ocupadas, reglasParaElemento(def));
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

// cambiarEstado — sección 5 del pedido de catálogo de contenido: el modelo
// de instancia lleva `estado` (desgastado/roto/sucio) preparado desde ya,
// aunque todavía no haya ninguna mecánica que lo module ella sola —
// cambiarlo a mano es una edición como cualquier otra, así que también
// marca origen:"modificado" y sobrevive a una regeneración igual que
// mover/rotar/sustituir.
function cambiarEstado(resultado, instanceId, cambios) {
  const encontrado = buscarItem(resultado, instanceId);
  if (!encontrado) return { ok: false, avisos: ["instancia_no_encontrada"] };
  const { item } = encontrado;
  item.estado = { ...(item.estado || {}), ...cambios };
  item.origen = "modificado";
  return { ok: true, avisos: [], estado: item.estado };
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
  // Puerta/ventanas movidas o añadidas a mano (2026-09-04): MISMO criterio
  // exacto que ya protege un mueble modificado — origen:"modificado" a
  // nivel de la propia puerta/ventana (no de la sala entera, ese
  // candado más grueso sigue siendo solo de cambiarTipoSala), así que
  // "regenerar mobiliario" sigue pudiendo rehacer el resto de la sala sin
  // pisar una puerta reubicada o una ventana añadida a propósito.
  const puertaConservada = !opts.forzar && resultado.puerta?.origen === "modificado";
  const ventanasConservadas = opts.forzar ? [] : (resultado.ventanas || []).filter((v) => v.origen === "modificado");

  const semillaRegeneracion = `${resultado.semilla}:regen:${Date.now()}`;
  // anchoForzado/largoForzado/formaSalaForzada: "regenerar mobiliario" NUNCA
  // debe cambiar la forma/tamaño de la sala por debajo del jugador — sin
  // esto, un colocarSala fresco con una semilla nueva podía volver a tirar
  // los dados de ancho/largo Y de plantilla de forma (catalogo/formasSala.json)
  // y devolver una sala de otra forma, aunque `resultado.mascara`/ancho/largo
  // se quedaran desactualizados (mismatch real entre el mobiliario nuevo y
  // la máscara vieja). `resultado.formaSalaId` puede no existir en datos
  // guardados ANTES de este catálogo (undefined) — colocarSala lo trata
  // igual que "sin forzar", cae a la elección probabilística normal.
  const fresco = colocarSala({
    tipoSalaId: resultado.tipoSalaId,
    catalogos,
    riqueza: resultado.riqueza,
    amueblado: resultado.amueblado,
    semilla: semillaRegeneracion,
    anchoForzado: resultado.ancho,
    largoForzado: resultado.largo,
    formaSalaForzada: resultado.formaSalaId,
  });
  // Sincroniza forma/máscara con lo que de verdad se acaba de generar (con
  // formaSalaForzada esto es un no-op salvo en datos legacy sin
  // formaSalaId, donde puede introducir una máscara por primera vez).
  resultado.mascara = fresco.mascara;
  resultado.formaSalaId = fresco.formaSalaId;

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

  // Puerta: si se movió a mano, se queda tal cual (ni siquiera se
  // recalcula su punto exterior, que de todas formas ya cae en la misma
  // máscara — anchoForzado/largoForzado/formaSalaForzada garantizan que
  // la forma no cambió); si no, adopta la de la regeneración fresca
  // (determinista: colocarSala no tira ningún dado para la puerta, así
  // que en la práctica esto casi siempre da la misma posición de antes).
  if (!puertaConservada) resultado.puerta = fresco.puerta;

  // Ventanas: mismo patrón de conservar+concatenar que ya usan colgados
  // más arriba (sin filtrar solapes entre conservadas y frescas — igual
  // de aproximado que colgados, no se le pide más rigor a esto que a lo
  // que ya existía). bordesOcupados se reconstruye desde la regeneración
  // fresca (sus propios colgados/ventanas) MÁS los bordes de lo
  // conservado, para que una ventana añadida a mano después de este
  // regen siga viendo ocupado el sitio real de lo que se acaba de
  // preservar.
  resultado.ventanas = [...ventanasConservadas, ...fresco.ventanas];
  const bordesConservados = [];
  for (const it of conservadasColgados) bordesConservados.push(`${it.x}_${it.y}`);
  for (const v of ventanasConservadas) for (const c of celdasVentana(v.lado, v.x, v.y ?? 0, v.ancho)) bordesConservados.push(clave(c.x, c.y));
  resultado.bordesOcupados = [...new Set([...(fresco.bordesOcupados || []), ...bordesConservados])];

  const sobreTodos = resultado.colocados.flatMap((c) => c.sobre || []);
  resultado.estadisticas = calcularEstadisticas([...resultado.colocados, ...resultado.colgados, ...resultado.techo, ...sobreTodos]);
  return {
    ok: true,
    conservadas: conservadas.length + conservadasColgados.length + conservadasTecho.length + (puertaConservada ? 1 : 0) + ventanasConservadas.length,
    nuevas: frescoLibre.length,
  };
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
  cambiarEstado,
  cambiarTipoSala,
  moverPuerta,
  anadirVentana,
  moverVentana,
  eliminarVentana,
  regenerarMobiliario,
  regenerarHabitacion,
  regenerarPiso,
  regenerarEdificio,
  calcularOcupacion,
  buscarItem,
  segmentosPerimetro,
  umbralPuerta,
};
