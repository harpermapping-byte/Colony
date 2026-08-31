"use strict";

/**
 * Generador de "nombre bonito" a partir de un id de catálogo (docs/GDD_Inventario.md
 * §"Nombre bonito", pedido 2026-08-30: regla permanente para TODO objeto/
 * mueble nuevo — items/catalogo/items.json e interiores/catalogo/elementos.json
 * llevan un campo `nombre` desde ahora). Reusable: cualquier entrada nueva
 * pasa por aquí (`node items/catalogo/nombreBonito.js <id>` o `require`d).
 *
 * No es magia de PLN — son reglas de ortografía y gramática española reales:
 * qué terminaciones llevan tilde, qué participios/adjetivos van pegados al
 * sustantivo anterior y qué palabras (sustantivos) necesitan un "de" delante
 * — más un diccionario de excepciones para lo que las reglas no cubren.
 * PRIMER BORRADOR, no prosa pulida a mano una a una: con ~1130 entradas el
 * criterio fue reglas + revisión por muestreo, no cada nombre repasado
 * individualmente — algún compuesto raro puede leerse forzado; se corrige
 * sobre la marcha añadiendo su caso a `EXCEPCIONES_FRASE` según se note jugando.
 */

// ---- Frases completas ya fijadas a mano (compuestos donde la regla genérica no basta: orden de palabras, "de la"/"del", términos ya asentados) ----
const EXCEPCIONES_FRASE = {
  carne_caza_mayor: "Carne de Caza Mayor",
  herradura_suerte: "Herradura de la Suerte",
  mortero_mano: "Mortero de Mano",
  instrumental_cirugia: "Instrumental de Cirugía",
  estandarte_jarl_salon: "Estandarte del Jarl",
  escritorio_capitan_puerto: "Escritorio del Capitán de Puerto",
  circulo_encantamiento_suelo: "Círculo de Encantamiento",
  hacha_maestro_lenador: "Hacha del Leñador Maestro",
  pico_maestro_minero: "Pico del Minero Maestro",
  martillo_maestro_malla_placas: "Martillo Maestro de Malla y Placas",
  hoz_bronce_hierbas: "Hoz de Bronce para Hierbas",
  cesta_panes_artesanales: "Cesta de Panes Artesanales",
  // Mesas/muebles donde el último tramo es un sustantivo de proceso
  // ("el tajado", "el amasado"...), no un participio-adjetivo — la regla
  // genérica los trataría como adjetivo pegado (mal: "Banco Tronzado" en vez
  // de "Banco de Tronzado").
  artesa_amasado: "Artesa de Amasado",
  mesa_tajado_limpieza: "Mesa de Tajado y Limpieza",
  banco_tronzado: "Banco de Tronzado",
  mesa_raspado: "Mesa de Raspado",
  tina_curtido: "Tina de Curtido",
  mesa_destilado_esencias: "Mesa de Destilado de Esencias",
  estacion_germinacion_mantequeria: "Estación de Germinación y Mantequería",
  // Comida cocinada (docs/GDD_Cocina.md) — concordancia de género real con
  // el ingrediente (baya/fruta/zanahoria/fresa/miel son femeninos).
  baya_cocinado: "Baya Cocinada",
  fruta_cocinado: "Fruta Cocinada",
  zanahoria_cocinado: "Zanahoria Cocinada",
  fresa_cocinado: "Fresa Cocinada",
  miel_cocinado: "Miel Cocinada",
  fruto_seco_cocinado: "Fruto Seco Cocinado",
  trigo_cocinado: "Trigo Cocinado",
  tomate_cocinado: "Tomate Cocinado",
  maniqui_alta_costura: "Maniquí de Alta Costura",
  bastidor_secado_cuero_exposicion: "Bastidor de Secado de Cuero de Exposición",
  tina_templado_aceite: "Tina de Templado de Aceite",
  estante_grabados_runicos: "Estante de Grabados Rúnicos",
  artesa_completa_amasado: "Artesa Completa de Amasado",
  // Herramientas de doble función (docs/GDD_Profesiones.md, herramientas por
  // tier) — el id encadena DOS piezas/usos distintos ("y", no "de...de").
  jarabe_catarro: "Jarabe para el Catarro",
  hacha_mano_cobre_hierro: "Hacha de Mano de Cobre y Hierro",
  kit_ordeno_cepillo: "Kit de Ordeño y Cepillo",
  cuchillo_fileteado_filtro_cobre: "Cuchillo de Fileteado y Filtro de Cobre",
  cuchillo_picar_cazo_hierro: "Cuchillo de Picar y Cazo de Hierro",
  espatula_cucharon_madera_noble: "Espátula y Cucharón de Madera Noble",
  cuchillos_chef_real_serpentin_vidrio: "Cuchillos de Chef Real y Serpentín de Vidrio",
};

// ---- Excepciones de UNA palabra (ñ, hiatos, esdrújulas irregulares que las reglas de sufijo no cubren) ----
const EXCEPCIONES_PALABRA = {
  arana: "araña", aranas: "arañas", cana: "caña", castano: "castaño",
  pequena: "pequeña", pequeno: "pequeño", senales: "señales", rinonera: "riñonera",
  banos: "baños", ordeno: "ordeño", disenio: "diseño", montanas: "montañas",
  raiz: "raíz", baul: "baúl", oido: "oído", laud: "laúd",
  jergon: "jergón", salon: "salón", eslabon: "eslabón",
  cirugia: "cirugía", agricola: "agrícola", organo: "órgano", serpentin: "serpentín",
  cirio: "cirio", canteria: "cantería", cesteria: "cestería",
  atencion: "atención", generico: "genérico", cadaver: "cadáver", lenador: "leñador",
  carreton: "carretón", tablon: "tablón", telarana: "telaraña", telaranas: "telarañas",
  panuelo: "pañuelo", diseno: "diseño", rio: "río",
  mosaico: "mosaico", gargola: "gárgola", barometro: "barómetro",
  maniqui: "maniquí", habito: "hábito",
  estano: "estaño", comun: "común", portatil: "portátil", lampara: "lámpara",
  circulo: "círculo", simbolo: "símbolo", marmol: "mármol", boveda: "bóveda",
  runicos: "rúnicos", fria: "fría", frio: "frío",
  unguento: "ungüento", protesis: "prótesis", energia: "energía", compas: "compás",
  guadana: "guadaña", tapon: "tapón", camion: "camión", sarten: "sartén",
  capitan: "capitán", capitania: "capitanía", catalogo: "catálogo", indice: "índice",
  cartografia: "cartografía", guardian: "guardián", multiple: "múltiple",
  multiples: "múltiples", pantografo: "pantógrafo", glandulas: "glándulas",
  guia: "guía", guias: "guías", hidraulico: "hidráulico", maritimas: "marítimas",
  alamo: "álamo", arbol: "árbol", ataud: "ataúd", automata: "autómata",
  banderin: "banderín", brujula: "brújula", botica: "botica", desvan: "desván",
  espatula: "espátula", mercancias: "mercancías", pajaro: "pájaro",
  pajaros: "pájaros", rubi: "rubí", sarcofago: "sarcófago", sofa: "sofá",
  tuberias: "tuberías", banista: "bañista",
};

// ---- Palabras que las reglas de sufijo NO cubren pero necesitan tilde por
// terminar en "-on" átono (sustantivo agudo real en español: cinturón,
// jabón, carbón, formón, jergón, salón... regla fiable salvo excepciones ya
// resueltas arriba, p.ej. "comun"/"cana" que no terminan en "-on" plano). ----
function acentuarTerminacionOn(palabra) {
  if (/[csç]ion$/.test(palabra)) return palabra; // ya lo resuelve la regla de -ción/-sión
  if (/on$/.test(palabra) && palabra.length > 3) return palabra.slice(0, -2) + "ón";
  return palabra;
}

// ---- Sustantivos → forma de "material/tema" cuando encabezan la frase (sin cambios; solo pasan por corregirPalabra). ----

function corregirPalabra(palabra) {
  if (EXCEPCIONES_PALABRA[palabra]) return EXCEPCIONES_PALABRA[palabra];
  if (/^\d+$/.test(palabra)) return palabra; // números de tier (barco_1 etc.), tal cual
  if (/cion$/.test(palabra)) return palabra.replace(/cion$/, "ción");
  if (/sion$/.test(palabra)) return palabra.replace(/sion$/, "sión");
  if (/eria$/.test(palabra)) return palabra.replace(/eria$/, "ería");
  if (/uria$/.test(palabra)) return palabra.replace(/uria$/, "uría");
  if ((/icos$/.test(palabra) || /icas$/.test(palabra)) && palabra.length > 4) {
    return acentuarEsdrujula(palabra.slice(0, -1)) + "s"; // plural esdrújula: mismo acento que el singular + "s"
  }
  if ((/ico$/.test(palabra) || /ica$/.test(palabra)) && palabra.length > 3) return acentuarEsdrujula(palabra);
  if (/on$/.test(palabra) && palabra.length > 3) return acentuarTerminacionOn(palabra);
  return palabra;
}

function acentuarEsdrujula(palabra) {
  // Esdrújula real (ico/ica): tilde en la vocal justo antes del sufijo de 3 letras.
  const radical = palabra.slice(0, palabra.length - 3);
  const mapa = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
  for (let i = radical.length - 1; i >= 0; i--) {
    if (mapa[radical[i]]) return radical.slice(0, i) + mapa[radical[i]] + radical.slice(i + 1) + palabra.slice(radical.length);
  }
  return palabra;
}

// ---- Adjetivos/participios que van PEGADOS al sustantivo anterior (sin "de") ----
const ADJETIVOS = new Set([
  "grande", "grandes", "gran", "pequena", "pequeno", "mediana", "mediano",
  "basica", "basico", "blanca", "blanco", "blanda", "dura", "duro",
  "larga", "largo", "corta", "corto", "fina", "fino", "grueso", "simple",
  "doble", "agricola", "industrial", "individual", "comun", "comunal", "comunales",
  "publica", "publico", "privada", "gratuita", "gratuitas", "religioso", "musical",
  "medicinal", "decorativa", "decorativo", "decorativos", "ornamental", "ornamentado",
  "mecanica", "mecanico", "automatica", "automata", "hidraulico", "manual", "portatil",
  "auxiliar", "completo", "completa", "continua", "continuo", "real", "noble", "nobles",
  "legendario", "mitica", "mitico", "magico", "magicos", "exotica", "silvestre",
  "venenosa", "curativa", "rota", "roto", "rotos", "oxidada", "vieja", "viejo",
  "antigua", "antiguo", "joven", "multiple", "multiples", "multinivel", "semicircular",
  "central", "operativo", "defensivo", "eficiente", "asistido", "improvisada",
  "fresca", "fresco", "frescas", "fria", "caliente", "seca", "seco", "secas",
  "azul", "roja", "oscura", "oscuro", "nocturna", "nocturno", "sagrado", "votivo",
  "prohibido", "gigante", "supremo", "raro", "raros", "unica", "unicas", "unicos",
  "precioso", "ligero", "redonda", "cerrado", "abrasiva", "abrasivo", "acelerado",
  "afilado", "alta", "altas", "cerrada", "generico", "sinpiel", "biblico", "arcana", "arcano", "arcanos",
  "obsoleto", "vacia", "vacio", "profunda", "eviscerado", "sagrada",
  "comestible", "artesanal", "artesanales", "acelerado", "afilado",
  "apilada", "apilado", "carbonizada", "carbonizado", "cerrado",
  "cincelada", "cincelado", "cocinado", "colgada", "coloreado", "curvado",
  "desactivada", "empotrada", "encantada", "enmarcado", "enrollada",
  "escaldado", "esmaltado", "hilada", "improvisada", "inyectado", "nevado",
  "ornamentado", "oxidada", "perfumado", "reforzada", "reforzado",
  "remachado", "sagrado", "salada", "tachonado", "tallada", "tallado",
  "templado", "aromatica", "vegetal", "basta", "curvo", "suelta", "suelto",
  "grabado", "grabados", "expositivo", "mayor", "expuesta", "expuesto",
  "secundario", "secundaria", "termal", "separadora", "separador", "fuerte",
  "motriz", "heraldico", "maritimas", "metrico", "navales", "alquimico",
  "ajustable", "ajustables", "fijo", "fija", "fijos", "fijas",
  "agropecuario", "agropecuaria", "dulce", "dulces",
]);

// Sustantivos que terminan en -ado/-ada por casualidad (NO son participio-
// adjetivo: son la palabra completa, un sustantivo normal) — sin esta lista,
// la regla genérica de "-ado/-ada = adjetivo pegado" los trataría mal
// (ej. "mercado" no es "mercadeado", es la palabra "mercado").
const SUSTANTIVOS_TERMINADOS_EN_ADO = new Set([
  "espada", "mercado", "temporada", "bancada", "artesonado", "encofrado",
  "plomada", "pescado", "rebanada", "espadas", "dados", "ahumado", "cepillado",
  "amasado", "secado", "marcado",
]);

// Mismo caso que arriba pero para "-ido/-idos": son sustantivos completos
// (el embutido, la comida), no el participio de un verbo.
const SUSTANTIVOS_TERMINADOS_EN_IDO = new Set(["embutido", "embutidos"]);

// Terminaciones de participio: adjetivo (va pegado, nunca "de" delante) —
// SALVO que la palabra completa sea uno de los sustantivos de arriba.
function esParticipioAdjetivo(palabra) {
  if (SUSTANTIVOS_TERMINADOS_EN_ADO.has(palabra)) return false;
  if (SUSTANTIVOS_TERMINADOS_EN_IDO.has(palabra)) return false;
  return /(ada|ado|adas|ados|ida|ido|idas|idos)$/.test(palabra);
}

// Números de tier (barco_1, silla_2...) van pegados, no llevan "de".
function esNumero(palabra) {
  return /^\d+$/.test(palabra);
}

const MINUSCULAS = new Set(["de", "del", "la", "el", "los", "las", "y", "a", "en", "con", "sin"]);

/**
 * Genera el nombre bonito de un id de catálogo: separa por "_", corrige
 * ortografía palabra a palabra, decide si cada palabra (salvo la primera) es
 * un ADJETIVO/participio (va pegado) o un SUSTANTIVO (necesita "de" delante
 * — regla por defecto en español para sustantivo+sustantivo), y capitaliza.
 */
function nombreBonito(id) {
  if (EXCEPCIONES_FRASE[id]) return EXCEPCIONES_FRASE[id];

  const partes = id.split("_").filter(Boolean);
  // "gran" antepuesto (gran_forja, gran_taller_mamposteria...) es un adjetivo
  // PREPUESTO al sustantivo siguiente ("Gran Forja", no "Gran de Forja") — la
  // palabra 1 nunca lleva "de" delante en ese caso, aunque no sea adjetivo.
  const conGranPrepuesto = partes[0] === "gran";
  const umbralDe = conGranPrepuesto ? 1 : 0;
  const salida = [];
  for (let i = 0; i < partes.length; i++) {
    const original = partes[i];
    const corregida = corregirPalabra(original);
    const esAdjetivoOParticipio = ADJETIVOS.has(original) || esParticipioAdjetivo(original) || esNumero(original) || MINUSCULAS.has(original);
    if (i > umbralDe && !esAdjetivoOParticipio) salida.push("de");
    salida.push(corregida);
  }
  return salida
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

// ---- Caso especial: los 33 "cadáver entero" de caza (docs/GDD_Caza.md) ----
// El id codifica carne+piel+tamaño (cadaver_<carne>_<piel>_<tamano>) — en vez
// de dejar que la regla genérica trocee esa cadena larga, se recompone en
// 3 partes reales y se nombra cada una con nombreBonito() por separado.
const TAMANOS = new Set(["cria", "pequeno", "mediano", "grande", "alfa"]);
const NOMBRE_TAMANO = { cria: "Cría", pequeno: "Pequeño", mediano: "Mediano", grande: "Grande", alfa: "Alfa" };

function nombreCadaver(id) {
  const resto = id.replace(/^cadaver_/, "");
  const partes = resto.split("_");
  const tamano = partes[partes.length - 1];
  const cuerpo = partes.slice(0, -1).join("_"); // "<carne>_<piel>"
  // La piel es SIEMPRE el último tramo antes del tamaño: o "sinpiel", o un
  // id real de piel (piel_basta/fina/invierno/exotica, cuero_grueso/reptil).
  // Ambos casos (piel_X o cuero_X) ocupan 2 tokens — se separan por el
  // prefijo conocido, nunca a ciegas por conteo de tokens.
  const m = cuerpo.match(/^(.*?)_((?:piel|cuero)_\w+|sinpiel)$/);
  const carneId = m ? m[1] : cuerpo;
  const pielId = m ? m[2] : null;

  const carneNombre = carneId === "generico" ? "Animal" : nombreBonito(carneId);
  let base = `Cadáver de ${carneNombre}`;
  if (pielId && pielId !== "sinpiel") base += ` con ${nombreBonito(pielId)}`;
  return `${base} (${NOMBRE_TAMANO[tamano] || tamano})`;
}

const _nombreBonitoBase = nombreBonito;
function nombreBonitoConCadaver(id) {
  if (id.startsWith("cadaver_") && TAMANOS.has(id.split("_").pop())) return nombreCadaver(id);
  // "asado_<categoriaRecursoCarne>" (docs/GDD_Cocina.md) — mismo criterio
  // que el cadáver: el sufijo YA es un id real de items.json, se nombra con
  // esta misma función en vez de dejar que la regla genérica trocee la
  // cadena larga (evita el "de Caza de Mayor" doble-"de" de carne_caza_mayor).
  if (id.startsWith("asado_") && id !== "asado_huevo") {
    return `Asado de ${_nombreBonitoBase(id.slice("asado_".length))}`;
  }
  return _nombreBonitoBase(id);
}

module.exports = { nombreBonito: nombreBonitoConCadaver, corregirPalabra, ADJETIVOS, EXCEPCIONES_FRASE, EXCEPCIONES_PALABRA };

if (require.main === module) {
  const id = process.argv[2];
  if (!id) {
    console.error("Uso: node nombreBonito.js <id_de_catalogo>");
    process.exit(1);
  }
  console.log(nombreBonito(id));
}
