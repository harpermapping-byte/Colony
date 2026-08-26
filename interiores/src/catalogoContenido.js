"use strict";

// Catálogo de Contenido — fuente de verdad unificada de todo lo que puede
// aparecer dentro de una sala: mobiliario, decoración, iluminación,
// objetos sueltos, puertas y ventanas. NO duplica los JSON existentes
// (`catalogo/elementos.json`, `puertas.json`, `ventanas.json`) — los
// normaliza en memoria a un modelo más rico (nombre/categoría/
// subcategoría/tags/reglas/dimensiones) derivándolo de los campos que ya
// existen (capa, colocacion, huella, materialesCompatibles,
// tiposSalaValidos...), igual que `salas.js` no reescribe la sala, solo la
// describe mejor. Un catálogo nuevo puede seguir escribiéndose con el
// formato de siempre (`elementos.json`) sin tener que aprenderse este
// módulo — la normalización rellena huecos, nunca exige campos nuevos.
//
// `colocarElementos.js` y `edicion.js` siguen leyendo `catalogos.elementos`
// directamente para lo que ya funcionaba (huella, capa, aportes,
// tileInteraccion...) — este módulo solo AÑADE la capa de consulta/reglas
// nueva por encima, sin tocar esos caminos existentes.

const { crearPRNG } = require("./azar");

// ---- Derivación de categoría/subcategoría/tags a partir de lo que ya hay ----

// Piezas de pared/techo puramente decorativas dentro de la capa decorFija
// (el resto de decorFija es mobiliario fijo funcional: horno_pan, fragua,
// encimera, chimenea...). Lista curada, no heurística de substring, para
// no clasificar mal por accidente.
const IDS_DECORATIVOS_FIJOS = new Set(["tapiz", "cuadro", "escudo_pared", "trofeo_caza", "viga_vista", "boveda_piedra", "artesonado", "columna", "reja_ventana"]);

function derivarCategoria(id, el) {
  if (el.categoria) return el.categoria; // override explícito, opcional
  if ((el.colocacion || []).includes("sobreSuperficie")) return "objetos";
  if (el.capa === "iluminacion") return "iluminacion";
  if (el.capa === "suciedad") return "suciedad";
  if (IDS_DECORATIVOS_FIJOS.has(id)) return "decoracion";
  return "mobiliario";
}

// subcategoría — agrupación fina dentro de una categoría, por patrón de id
// (curado, no adivinado por IA en caliente: mismo criterio que el resto
// del catálogo, donde las listas se escriben a mano una vez).
const PATRONES_SUBCATEGORIA = [
  [/^(cama_|litera|jergon|cuna)/, "camas"],
  [/^(silla|banco|taburete|trono|mecedora|reclinatorio)/, "asientos"],
  [/^(mesa_|mostrador|escritorio|atril|encimera)/, "mesas_superficies"],
  [/^(armario|estanteria|cofre_|arcon|baul_|tinaja|barril)/, "almacenamiento"],
  [/^(horno_pan|fragua|yunque|telar|rueca|rueda_afilar|prensa_vino|mesa_alquimia|mesa_trabajo|caldero|estanteria_pociones|bancada_cultivo)/, "oficio"],
  [/^(candelabro|antorcha|vela_|lampara|farol|brasero)/, "luces"],
];
function derivarSubcategoria(id, el) {
  if (el.subcategoria) return el.subcategoria;
  for (const [patron, sub] of PATRONES_SUBCATEGORIA) if (patron.test(id)) return sub;
  return el.capa; // sin patrón claro: la propia capa ya agrupa razonablemente
}

const TAGS_POR_PATRON_ID = [
  [/^(silla|banco|taburete|trono|mecedora|reclinatorio)/, ["asiento"]],
  [/^(armario|estanteria|cofre_|arcon|baul_|tinaja|barril)/, ["almacenamiento"]],
  [/^(cama_|litera|jergon|cuna)/, ["dormitorio"]],
  [/^(fregadero|mesa_cocina|especiero|horno_pan|olla|sarten|cesta_pan)/, ["cocina"]],
  [/^(escritorio|tintero_pluma|pergamino|mapa_mesa|atril)/, ["oficina"]],
  [/^(altar|reclinatorio|sarcofago|pesebre)/, ["religioso"]],
  [/^(candelabro|antorcha|vela_|lampara|farol|brasero)/, ["iluminacion"]],
];
function derivarTags(id, el, catalogos) {
  const tags = new Set(el.tags || []); // override/añadido explícito, opcional
  for (const [patron, ts] of TAGS_POR_PATRON_ID) if (patron.test(id)) for (const t of ts) tags.add(t);
  if (el.esSuperficie) tags.add("superficie");
  if (el.capa === "iluminacion") tags.add("iluminacion");
  if (el.capa === "suciedad") tags.add("decorativo");
  if (derivarCategoria(id, el) === "decoracion") tags.add("decorativo");
  for (const m of el.materialesCompatibles || []) tags.add(m);
  tags.add(!el.riquezaMinima || el.riquezaMinima === "humilde" ? "comun" : el.riquezaMinima === "noble" ? "raro" : "modesta");
  // tags de función de sala vía la categoría ya asignada a cada tipo de
  // sala (tipos_sala.json sección 5 del GDD) — reutiliza ese dato en vez
  // de duplicar una lista de "qué sala es cuál función".
  if (catalogos?.tiposSala) {
    for (const salaId of el.tiposSalaValidos || []) {
      const cat = catalogos.tiposSala[salaId]?.categoria;
      if (cat) tags.add(cat);
    }
  }
  return [...tags];
}

// ---- Reglas de colocación (sección 8 del pedido): el catálogo solo
// describe la regla, la política de bloqueo sigue en edicion.js/
// colocarElementos.js — ver validarHueco en edicion.js. Los valores por
// defecto reproducen EXACTAMENTE el comportamiento que ya tenía el motor
// antes de este catálogo (solo la suciedad podía solaparse, nada bloqueaba
// puerta "de más"), así que ningún elemento existente cambia de
// comportamiento salvo que declare un override explícito.
function reglasParaElemento(el) {
  if (!el) return { puedeSolapar: false, puedeBloquearPuerta: false, pegadoPared: false, requierePared: false, rotacionesPermitidas: null };
  const colocacion = el.colocacion || [];
  return {
    puedeSolapar: el.puedeSolapar ?? el.capa === "suciedad",
    puedeBloquearPuerta: el.puedeBloquearPuerta ?? false,
    pegadoPared: colocacion.includes("pegadaAPared"),
    requierePared: colocacion.includes("colgadoEnPared"),
    rotacionesPermitidas: el.rotacionesPermitidas || null, // null = sin restricción (las 4 orientaciones)
  };
}

function nombreLegible(id, el) {
  if (el.nombre) return el.nombre;
  return id.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function alturaPorDefecto(id, el) {
  if (el.alto) return el.alto;
  if (el.capa === "suciedad") return 0.05;
  if (el.capa === "iluminacion") return 0.3;
  if (["armario", "estanteria", "baul"].some((k) => id.includes(k))) return 1.8;
  if (id.includes("mesa") || id.includes("encimera") || id.includes("mostrador")) return 0.8;
  if (id.includes("cama")) return 0.6;
  return 1.1;
}

function normalizarElemento(id, el, catalogos) {
  const huella = el.huella || [1, 1];
  return {
    id,
    nombre: nombreLegible(id, el),
    categoria: derivarCategoria(id, el),
    subcategoria: derivarSubcategoria(id, el),
    dimensiones: { ancho: huella[0], largo: huella[1], alto: alturaPorDefecto(id, el) },
    huella, // formato [ancho,largo] tal cual lo consume colocarElementos.js — sin duplicar, mismo array
    rotacionesPermitidas: el.rotacionesPermitidas || [0, 90, 180, 270],
    reglas: reglasParaElemento(el),
    salasPermitidas: el.tiposSalaValidos || [],
    tags: derivarTags(id, el, catalogos),
    pesoGeneracion: el.pesoGeneracion ?? 50,
    variantes: el.variantesNombradas || null, // [{id,peso}] opcional — el conteo simple `variantes:N` de siempre se conserva sin tocar en `original`
    estado: { desgastado: false, roto: false, sucio: false },
    materialesCompatibles: el.materialesCompatibles || [],
    riquezaMinima: el.riquezaMinima || null,
    esSuperficie: !!el.esSuperficie,
    colorDebug: el.colorDebug,
    capa: el.capa, // se conserva el campo original — colocarElementos.js/edicion.js siguen usándolo tal cual
    colocacion: el.colocacion || [],
    aportes: el.aportes || null,
    original: el, // referencia al objeto real de elementos.json — nunca una copia, para no duplicar datos
  };
}

// Puertas/ventanas entran en el mismo índice para que "el catálogo sea la
// fuente de verdad de TODO lo que puede aparecer en una sala" (sección 1
// del pedido), pero son piezas ESTRUCTURALES (parte del muro, no del
// array `colocados` de mobiliario) — `edicion.js` no las coloca como
// instancia todavía (eso es la sección 7 del GDD, hueco de la pared, no
// una huella en el suelo). Quedan navegables/buscables en el catálogo,
// marcadas para que el editor lo deje claro en vez de fingir que
// "añadir" funciona igual para ellas.
function normalizarPuerta(id, def) {
  return {
    id,
    nombre: nombreLegible(id, def),
    categoria: "puertas",
    subcategoria: def.esPuertaPrincipal ? "principal" : "interior",
    dimensiones: { ancho: def.anchoHueco, largo: 1, alto: 2.2 },
    huella: [def.anchoHueco, 1],
    rotacionesPermitidas: [0, 90, 180, 270],
    reglas: { puedeSolapar: false, puedeBloquearPuerta: false, pegadoPared: true, requierePared: true, rotacionesPermitidas: null },
    salasPermitidas: [],
    tags: ["estructural", "puerta", def.riquezaMinima === "noble" ? "raro" : "comun"],
    pesoGeneracion: 50,
    variantes: null,
    estado: { desgastado: false, roto: false, sucio: false },
    materialesCompatibles: [],
    riquezaMinima: def.riquezaMinima || null,
    esSuperficie: false,
    colorDebug: def.colorDebug,
    capa: "estructura",
    colocacion: ["estructural"],
    aportes: null,
    estructural: true, // el editor usa este flag para no ofrecer "colocar como instancia" todavía
    original: def,
  };
}

// Una ventana real es la combinación forma×tamaño×marco×cristal (GDD
// sección 7) — se listan las combinaciones más representativas (una por
// forma, con su tamaño/marco/cristal por defecto) para que el catálogo
// tenga algo navegable/buscable; el bakeador de estructura sigue
// resolviendo la combinatoria completa por su cuenta, esto no la sustituye.
function normalizarVentanas(ventanas) {
  const formas = Object.keys(ventanas.forma || {}).filter((k) => !k.startsWith("_"));
  return formas.map((forma) => {
    const defForma = ventanas.forma[forma];
    const id = `ventana_${forma}`;
    return {
      id,
      nombre: `Ventana ${forma}`,
      categoria: "ventanas",
      subcategoria: forma,
      dimensiones: { ancho: 1, largo: 1, alto: 1.2 },
      huella: [1, 1],
      rotacionesPermitidas: [0, 90, 180, 270],
      reglas: { puedeSolapar: false, puedeBloquearPuerta: false, pegadoPared: true, requierePared: true, rotacionesPermitidas: null },
      salasPermitidas: [],
      tags: ["estructural", "ventana", defForma.riquezaMinima === "noble" ? "raro" : "comun"],
      pesoGeneracion: 50,
      variantes: null,
      estado: { desgastado: false, roto: false, sucio: false },
      materialesCompatibles: [],
      riquezaMinima: defForma.riquezaMinima || null,
      esSuperficie: false,
      colorDebug: defForma.colorDebug,
      capa: "estructura",
      colocacion: ["estructural"],
      aportes: null,
      estructural: true,
      original: defForma,
    };
  });
}

// ---- Construcción del índice + API de consulta ----

function construirCatalogoContenido(catalogos) {
  const items = [];
  for (const [id, el] of Object.entries(catalogos.elementos || {})) {
    if (id.startsWith("_")) continue;
    items.push(normalizarElemento(id, el, catalogos));
  }
  for (const [id, def] of Object.entries(catalogos.puertas || {})) {
    if (id.startsWith("_")) continue;
    items.push(normalizarPuerta(id, def));
  }
  items.push(...normalizarVentanas(catalogos.ventanas || {}));

  const porId = new Map(items.map((it) => [it.id, it]));

  function buscarPorId(id) {
    return porId.get(id) || null;
  }
  function buscarPorCategoria(categoria) {
    return items.filter((it) => it.categoria === categoria);
  }
  function buscarPorSubcategoria(subcategoria) {
    return items.filter((it) => it.subcategoria === subcategoria);
  }
  // uno o varios tags (array = deben cumplirse todos — AND, no OR, para que
  // "buscarPorTag(['madera','asiento'])" sea realmente más específico).
  function buscarPorTag(tagOTags) {
    const tags = Array.isArray(tagOTags) ? tagOTags : [tagOTags];
    return items.filter((it) => tags.every((t) => it.tags.includes(t)));
  }
  function buscarParaSala(tipoSalaId) {
    return items.filter((it) => it.salasPermitidas.includes(tipoSalaId));
  }
  // texto libre sobre id/nombre/tags — lo que consume la barra de
  // búsqueda del editor (sección 10 del pedido).
  function buscarPorTexto(texto) {
    const q = (texto || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.id.includes(q) || it.nombre.toLowerCase().includes(q) || it.tags.some((t) => t.includes(q)));
  }

  // Selección determinista de variante — misma semilla + mismo catálogo =
  // mismo resultado (sección 4 del pedido), sin aleatoriedad no
  // determinista: mismo PRNG mulberry32 que usa el resto del bakeador. Si
  // el elemento no declara `variantesNombradas`, devuelve su propio id sin
  // más (compatibilidad con el `variantes:N` simple de siempre).
  function elegirVariante(id, semillaTexto) {
    const item = buscarPorId(id);
    if (!item || !item.variantes || item.variantes.length === 0) return id;
    const rnd = crearPRNG(`${semillaTexto}:variante:${id}`);
    const total = item.variantes.reduce((s, v) => s + (v.peso ?? 1), 0);
    let tirada = rnd() * total;
    for (const v of item.variantes) {
      tirada -= v.peso ?? 1;
      if (tirada <= 0) return v.id;
    }
    return item.variantes[item.variantes.length - 1].id;
  }

  // Resuelve "necesidades conceptuales" de una sala (sección 9 del pedido)
  // en una lista concreta de ids de catálogo — capa de abstracción
  // ADICIONAL sobre el sistema de generación existente, no un reemplazo:
  // colocarElementos.js sigue resolviendo la generación real por
  // capa/colocacion/riqueza exactamente como antes; esto es para que un
  // futuro paso de generación (o el editor) pueda pedir "dame entre 4 y 8
  // asientos válidos para taberna" sin tener que conocer los ids exactos.
  // Determinista por semilla, igual que el resto del bakeador.
  function resolverNecesidades(necesidades, { tipoSalaId, riqueza, semilla = "necesidades" } = {}) {
    const resultado = {};
    for (const [tag, rango] of Object.entries(necesidades)) {
      const candidatos = items.filter((it) => it.tags.includes(tag) && (!tipoSalaId || it.salasPermitidas.length === 0 || it.salasPermitidas.includes(tipoSalaId)));
      const rnd = crearPRNG(`${semilla}:necesidad:${tag}`);
      const min = rango.min ?? 0;
      const max = rango.max ?? min;
      const cuantos = candidatos.length === 0 ? 0 : min + Math.floor(rnd() * (Math.max(min, max) - min + 1));
      const elegidos = [];
      for (let i = 0; i < cuantos && candidatos.length > 0; i++) {
        elegidos.push(candidatos[Math.floor(rnd() * candidatos.length)].id);
      }
      resultado[tag] = elegidos;
    }
    return resultado;
  }

  // Falla claro ante referencias rotas del catálogo (sección 12 del
  // pedido) — mismo espíritu que las comprobaciones de referencias
  // huérfanas ya usadas en el resto del proyecto (materiales/tiposSala/
  // tiposEdificio), aquí como función reutilizable en vez de un script
  // suelto de una sola vez.
  function validar() {
    const errores = [];
    const idsVistos = new Set();
    const idsSala = new Set(Object.keys(catalogos.tiposSala || {}).filter((k) => !k.startsWith("_")));
    const idsMaterial = new Set(Object.keys(catalogos.materiales || {}).filter((k) => !k.startsWith("_")));
    for (const it of items) {
      if (idsVistos.has(it.id)) errores.push(`id duplicado: ${it.id}`);
      idsVistos.add(it.id);
      if (!it.estructural) {
        if (!Number.isFinite(it.dimensiones.ancho) || it.dimensiones.ancho <= 0) errores.push(`${it.id}: dimensiones.ancho inválido`);
        if (!Number.isFinite(it.dimensiones.largo) || it.dimensiones.largo <= 0) errores.push(`${it.id}: dimensiones.largo inválido`);
        for (const salaId of it.salasPermitidas) if (!idsSala.has(salaId)) errores.push(`${it.id}: salasPermitidas referencia tipoSala inexistente '${salaId}'`);
        for (const m of it.materialesCompatibles) if (!idsMaterial.has(m)) errores.push(`${it.id}: materialesCompatibles referencia material inexistente '${m}'`);
      }
      if (it.variantes) {
        const idsVariante = new Set();
        for (const v of it.variantes) {
          if (!v.id) errores.push(`${it.id}: variante sin id`);
          if (idsVariante.has(v.id)) errores.push(`${it.id}: variante duplicada '${v.id}'`);
          idsVariante.add(v.id);
        }
      }
      if (!Array.isArray(it.tags) || it.tags.some((t) => typeof t !== "string" || !t)) errores.push(`${it.id}: tags inválidos`);
    }
    return { ok: errores.length === 0, errores };
  }

  return { items, buscarPorId, buscarPorCategoria, buscarPorSubcategoria, buscarPorTag, buscarParaSala, buscarPorTexto, elegirVariante, resolverNecesidades, validar };
}

module.exports = { construirCatalogoContenido, reglasParaElemento, nombreLegible };
