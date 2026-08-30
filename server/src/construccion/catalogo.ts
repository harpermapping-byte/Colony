/**
 * Catálogo CONSTRUIBLE fusionado (GDD_Construccion §3): el menú de
 * construcción se monta LEYENDO los catálogos de interiores, nunca listas
 * propias — cuando crezcan las listas (regla 7 del CLAUDE.md), el
 * constructor ofrece lo nuevo solo, sin tocar este código.
 *
 * Fuentes (require con ruta absoluta: el servidor ya lee catálogos hermanos):
 * - `interiores/catalogo/elementos.json` → muebles, EXCLUYENDO la capa
 *   "estructural" y las entradas con specialModifier de ENEMIGO (un jugador
 *   no coloca bichos; los especiales de nobleza/tesoro sí son muebles).
 * - `interiores/catalogo/exteriores.json` → estructuras exteriores, entero.
 * - `interiores/catalogo/tipos_edificio.json` → solo `construible: true`
 *   (con `huellaExterior`); al colocarse generan interior (§5).
 *
 * Regla de colisión (§3): todo ocupa como SÓLIDO salvo `colision: false`
 * explícito (exteriores) o anchor FLOOR_DECAL (alfombras/círculos rituales,
 * pisables por diseño — es el valor real que usa elementos.json).
 */

import * as path from "node:path";
import { DatosProduccion } from "./produccion";
import { CategoriaVidaAnimal } from "../mundo/catalogoCombateFauna";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");
const CARPETA_CATALOGO = path.join(RAIZ_REPO, "interiores", "catalogo");

export type CategoriaConstruible = "mueble" | "exterior" | "edificio";

/**
 * Red motriz (docs/GDD_Motriz.md): campo opcional aditivo, mismo molde que
 * `produccion` — un nodo puede PRODUCIR (molino), TRANSMITIR (eje,
 * engranaje, palancas) o CONSUMIR (mesa de profesión que se beneficia).
 * Definido aquí (no en un módulo propio de energia.ts) para que ese módulo
 * — que SÍ necesita importar `EntradaConstruible` y `ContextoConstruccion`
 * para recorrer la rejilla — no cierre un ciclo de imports con catalogo.ts.
 */
export interface EntradaEnergia {
  /** Nodo FUENTE: unidades de potencia que aporta a la red al conectarse (constante, sin fluctuación en v1). */
  produce?: number;
  /** Solo si produce>0: de dónde la saca — "agua" exige un cauce adyacente a la huella (ver validarColocacion). */
  fuente?: "agua" | "viento" | "movimiento";
  /** Nodo de PASO (eje, engranaje, palancas): deja pasar la conexión a través de sí mismo hacia sus vecinos. */
  transmite?: boolean;
  /** Solo palanca de freno: aunque transmite=true, `extra.frenado` puede cortar el paso en caliente. */
  interrumpible?: boolean;
  /** Solo palanca de cambios: nº de direcciones cardinales entre las que `extra.canalActivo` elige la única salida abierta. */
  canales?: number;
  /** Nodo de CONSUMO (mesa de profesión): potencia mínima alcanzable en la red para que el bonus se aplique. */
  consume?: number;
  /** Solo nodos de consumo: factor que multiplica la velocidad de la acción cuando la red alcanza `consume`. */
  multiplicador?: number;
}

export interface EntradaConstruible {
  id: string;
  categoria: CategoriaConstruible;
  /** [ancho, largo] en casillas, SIN rotar (rot impar la intercambia) */
  huella: [number, number];
  /** true = sus casillas se endurecen en la rejilla al colocarse */
  colision: boolean;
  variantes: number;
  /** Producción pasiva (docs/GDD_Produccion.md) — presente en colmena/aserradero. */
  produccion?: DatosProduccion;
  /** Solo tipos_edificio.json: colocable SOLO por el jarl vía plantilla:colocar (radio a la capital), NUNCA por "construir" normal — mecanismo paralelo a `construible`, no una variante suya. */
  plantillaJarl?: boolean;
  /** Proyecto especial del jarl (docs/Backlog_Mecanicas_Futuras.md, "Proyectos especiales del jarl"):
   * a diferencia de `plantillaJarl`, SIGUE viviendo en el "construir" normal de parcela (mismo Map,
   * genera interior igual que cualquier edificio) — solo que `validarColocacion` exige además ser el
   * jarl, que la parcela sea `tipo:"especial"` (docs/GDD_Ciudad_Capital.md §3), y tope de 1 por asentamiento. */
  proyectoJarl?: boolean;
  /** Red motriz (docs/GDD_Motriz.md) — presente en molino/eje/palancas/mesas de profesión conectables. */
  energia?: EntradaEnergia;
  /** Actividad diaria de atributo (docs/GDD_Personaje.md §3.5) — presente en pesas/diana/atril: acercarse y mandar `actividad:realizar` otorga `xp` de `atributo`, una vez por día de mundo. */
  actividadAtributo?: EntradaActividadAtributo;
  /** Cama (docs/GDD_Personaje.md §3.6) — presente en cama_individual/cama_doble/litera_marinero: acercarse y mandar `dormir:iniciar` empieza un sueño con tope de tiempo que recupera Estamina entera al completarse. */
  esCama?: boolean;
  /** Pesca pasiva (docs/GDD_Pesca.md) — presente en trampa_pesca/cangrejera/batea_almejas: exige agua ORTOGONALMENTE ADYACENTE a la huella al colocarse (mismo `hayAguaAdyacente` que el molino de agua), nunca dentro de la huella (construcción siempre en tierra). */
  requiereAgua?: boolean;
  /** Agricultura (docs/GDD_Agricultura.md) — presente en bancal_cultivo/maceta_*: superficie donde plantar UNA semilla a la vez (mensajes `cultivo:*`, RoomExteriorBase.ts). `multiplicadorCosecha` escala la cantidad de cada cosecha (macetas grandes rinden más). */
  plantable?: { multiplicadorCosecha: number };
  /**
   * Cocina (docs/GDD_Cocina.md) — presente en hoguera_campamento/chimenea_cocina
   * (esVasija:false, solo "cocinar tal cual") y en toda vasija (esVasija:true):
   * cuenco_cocina/cazuela_cocina/olla_cocina/cuenco_barro_grande/olla_grande/
   * tinaja_batidos. `vasija` es un id libre (no un enum cerrado — cocina v2
   * 2026-08-30 añadió tipos nuevos) que decide la familia/nombre del plato
   * (`cocina/cocina.ts::familiaDePlato`). `hierveAgua` (default true si
   * esVasija) marca si hace falta `cocina:llenarAgua` + esperar el hervor
   * antes de añadir ingredientes — false en cuenco_barro_grande (sartén,
   * fuego directo) y tinaja_batidos (sin fuego).
   */
  cocina?: { esVasija: boolean; capacidad?: number; vasija?: string; hierveAgua?: boolean };
  /** Encurtido de pieles (docs/GDD_Caza.md) — presente en cubo_sal/barril_curtido. */
  curtidor?: EntradaCurtidor;
  /** Cocina v2 (docs/GDD_Cocina.md) — presente en recipiente_queso: leche a granel [+sal] + tiempo real -> mantequilla/queso (server/src/construccion/cuajado.ts). true = el mueble existe, sin más parámetros (las constantes de tiempo/cantidad viven en cuajado.ts, un único mueble en el juego). */
  quesera?: boolean;
  /** Ganadería (docs/GDD_Ganaderia.md) — presente en comedero: mueble-cubo cargable a granel, mismo mecanismo de "hueco/stock" que curtidor pero sin lote ni transformación, solo un contador de disponibilidad diaria. */
  alimentador?: EntradaAlimentador;
  /** Ganadería (docs/GDD_Ganaderia.md) — presente en gallinero/nido/cobertizo_ganado: refugio que hace falta tener en la propiedad destino para poder traer un animal de esas categoriasVida (domesticar o comprar). */
  refugioGranja?: EntradaRefugioGranja;
  /**
   * Cocina v2 (docs/GDD_Cocina.md) — presente en estructura_palos/olla_grande:
   * al colocarse, exige que al menos una casilla ORTOGONALMENTE ADYACENTE a
   * la huella tenga una construcción cuyo `objeto` esté en esta lista (o sea
   * exactamente esta cadena) — `construccion.ts::hayConstruibleAdyacente`,
   * mismo espíritu que `requiereAgua` pero mirando construcciones en vez de
   * terreno. olla_grande exige estructura_palos; estructura_palos exige
   * hoguera_campamento o chimenea_cocina — así "la olla grande se pone
   * exclusivamente sobre una hoguera con estructura de palos" (pedido
   * explícito) queda en dos pasos encadenados, no una comprobación multi-tipo.
   */
  requiereConstruibleAdyacente?: string | string[];
  /**
   * Cocina v2 (docs/GDD_Cocina.md) — presente en cuenco_barro_grande/olla_grande/
   * tinaja_batidos/recipiente_queso/estructura_palos: itemId que el jugador
   * debe tener en el inventario para colocar esta construible — se consume
   * al colocarse ("construir", RoomExteriorBase.ts). Da sentido real a
   * craftear la olla/vasija en herrería/alfarería/carpintería sin abrir la
   * pregunta más grande de "construir cuesta materiales" para TODO el resto
   * del juego (que hoy sigue gratis, sin excepción, fuera de estas piezas).
   */
  requiereItemColocar?: string;
  /**
   * Crafteo (docs/GDD_Crafteo.md §7bis, pedido 2026-08-30: "los niveles de
   * oficio permiten poder usar mejores mesas, construir o poner las mejoras
   * de mesa") — presente en mesas de tier avanzado y en mejoras de mesa
   * sueltas: exige tener ese nivel del oficio (XP derivada, mismo
   * `nivelDeXp`/`obtenerXpOficio` que el resto de crafteo) para PONERLA,
   * no solo para craftear en ella. Ausente = cualquiera puede construirla
   * (comportamiento de siempre, la inmensa mayoría de construibles).
   */
  nivelOficioMinimo?: { oficio: string; nivel: number };
}

export interface EntradaActividadAtributo {
  atributo: string;
  xp: number;
}

/**
 * Encurtido de pieles (docs/GDD_Caza.md, pedido 2026-08-30) — presente en
 * `cubo_sal`/`barril_curtido` (exteriores.json): mueble-contenedor con un
 * ÚNICO lote en curso (`server/src/construccion/curtido.ts`, mismo reloj
 * perezoso que `produccion`/`crafteo`, sin tick de servidor).
 */
export interface EntradaCurtidor {
  /** itemId a granel que carga el mueble (sal / curtiente) — `curtidor:cargarMaterial`. */
  materialCarga: string;
  /** unidades de `materialCarga` consumidas del stock por cada unidad de piel del lote. */
  materialPorUnidad: number;
  capacidadMaxMaterial: number;
  /** Acepta un itemId EXACTO (p.ej. "piel_raspada") — alternativa a entradaFamilia/entradaTier. */
  entradaItemId?: string;
  /** Acepta cualquier item cuya `familiaMaterial` (items.json) coincida — p.ej. "cuero" para cualquier piel cruda. */
  entradaFamilia?: string;
  /** Solo junto a entradaFamilia: además exige ese `tier` exacto (0 = crudo). */
  entradaTier?: number;
  /** itemId que produce el lote al completarse. */
  salida: string;
  /** duración del lote en horas REALES (Date.now(), no horas de mundo) — mismo criterio que cadaveres.ts/desgaste.ts. */
  horas: number;
}

/** Ganadería (docs/GDD_Ganaderia.md) — mueble tipo comedero: carga a granel un itemId (pienso) hasta capacidadMaxMaterial, `animal:cargarComedero`. Con stock>0 da acceso a comida ese día a TODOS los animales de la propiedad (sin lote/transformación, a diferencia de curtidor). */
export interface EntradaAlimentador {
  itemId: string;
  capacidadMaxMaterial: number;
}

/** Ganadería (docs/GDD_Ganaderia.md) — refugio (gallinero/nido/cobertizo_ganado): qué categoriasVida de EstadisticasCombateAnimal acepta como hogar — sin uno presente en la propiedad destino no se puede domesticar/comprar un animal de esas categorías hacia ahí. */
export interface EntradaRefugioGranja {
  categoriasVida: CategoriaVidaAnimal[];
}

interface EntradaElemento {
  capa?: string;
  specialModifier?: unknown;
  anchorType?: string;
  huella?: [number, number];
  variantes?: number;
  energia?: EntradaEnergia;
  actividadAtributo?: EntradaActividadAtributo;
  esCama?: boolean;
  nivelOficioMinimo?: { oficio: string; nivel: number };
}

interface EntradaExterior {
  huella?: [number, number];
  colision?: boolean;
  variantes?: number;
  produccion?: DatosProduccion;
  energia?: EntradaEnergia;
  actividadAtributo?: EntradaActividadAtributo;
  proyectoJarl?: boolean;
  requiereAgua?: boolean;
  plantable?: { multiplicadorCosecha: number };
  cocina?: { esVasija: boolean; capacidad?: number; vasija?: string; hierveAgua?: boolean };
  curtidor?: EntradaCurtidor;
  quesera?: boolean;
  alimentador?: EntradaAlimentador;
  refugioGranja?: EntradaRefugioGranja;
  requiereConstruibleAdyacente?: string | string[];
  requiereItemColocar?: string;
  nivelOficioMinimo?: { oficio: string; nivel: number };
}

interface EntradaTipoEdificio {
  construible?: boolean;
  huellaExterior?: [number, number];
  variantes?: number;
  produccion?: DatosProduccion;
  plantillaJarl?: boolean;
  proyectoJarl?: boolean;
  energia?: EntradaEnergia;
}

function leerCatalogo<T>(nombre: string): Record<string, T> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(path.join(CARPETA_CATALOGO, nombre)) as Record<string, T>;
}

/** Fusiona los tres catálogos en un Map id → entrada construible. */
export function cargarCatalogoConstruible(): Map<string, EntradaConstruible> {
  const resultado = new Map<string, EntradaConstruible>();

  const elementos = leerCatalogo<EntradaElemento>("elementos.json");
  for (const [id, d] of Object.entries(elementos)) {
    if (id.startsWith("_")) continue; // notas del catálogo
    // el GDD §3 solo veta los specialModifier de enemigo (hoy
    // "ESPECIAL_ENEMIGO_SALVAJE"); nobleza/tesoro son muebles legítimos
    if (d.capa === "estructural") continue;
    if (typeof d.specialModifier === "string" && d.specialModifier.includes("ENEMIGO")) continue;
    if (!d.huella) continue; // sin huella no hay nada que colocar en la rejilla
    resultado.set(id, {
      id,
      categoria: "mueble",
      huella: d.huella,
      // FLOOR_DECAL = alfombra/marca en el suelo: pisable, no endurece
      colision: d.anchorType !== "FLOOR_DECAL",
      variantes: d.variantes ?? 1,
      energia: d.energia,
      actividadAtributo: d.actividadAtributo,
      esCama: d.esCama,
      nivelOficioMinimo: d.nivelOficioMinimo,
    });
  }

  const exteriores = leerCatalogo<EntradaExterior>("exteriores.json");
  for (const [id, d] of Object.entries(exteriores)) {
    if (id.startsWith("_")) continue;
    if (!d.huella) continue;
    resultado.set(id, {
      id,
      categoria: "exterior",
      huella: d.huella,
      colision: d.colision === true, // su campo manda; sin campo = decorativo
      variantes: d.variantes ?? 1,
      produccion: d.produccion,
      energia: d.energia,
      actividadAtributo: d.actividadAtributo,
      proyectoJarl: d.proyectoJarl,
      requiereAgua: d.requiereAgua,
      plantable: d.plantable,
      cocina: d.cocina,
      curtidor: d.curtidor,
      quesera: d.quesera,
      alimentador: d.alimentador,
      refugioGranja: d.refugioGranja,
      requiereConstruibleAdyacente: d.requiereConstruibleAdyacente,
      requiereItemColocar: d.requiereItemColocar,
      nivelOficioMinimo: d.nivelOficioMinimo,
    });
  }

  const tiposEdificio = leerCatalogo<EntradaTipoEdificio>("tipos_edificio.json");
  for (const [id, d] of Object.entries(tiposEdificio)) {
    if (id.startsWith("_")) continue;
    // plantillaJarl:true (aserradero) es DELIBERADAMENTE excluido de aquí —
    // solo colocable vía "plantilla:colocar" (cargarCatalogoPlantillas más
    // abajo), NUNCA por el "construir" normal de parcela — dos mecanismos
    // paralelos, no una variante del mismo flag (docs/GDD_Produccion.md).
    if (d.construible !== true || !d.huellaExterior) continue;
    resultado.set(id, {
      id,
      categoria: "edificio",
      huella: d.huellaExterior,
      colision: true, // un edificio siempre bloquea su solar (se entra por portal, futuro)
      variantes: d.variantes ?? 1,
      energia: d.energia,
      proyectoJarl: d.proyectoJarl,
    });
  }

  return resultado;
}

/**
 * Plantillas del jarl (docs/GDD_Produccion.md, pedido 2026-08-29): tipos de
 * edificio con `plantillaJarl: true` (aserradero) — colocable SOLO por el
 * jarl dentro de un radio a la capital, nunca por el "construir" normal de
 * parcela (por eso viven en un Map SEPARADO de cargarCatalogoConstruible,
 * no mezclado — evita que un jugador cualquiera pueda "construir" uno).
 */
export function cargarCatalogoPlantillas(): Map<string, EntradaConstruible> {
  const resultado = new Map<string, EntradaConstruible>();
  const tiposEdificio = leerCatalogo<EntradaTipoEdificio>("tipos_edificio.json");
  for (const [id, d] of Object.entries(tiposEdificio)) {
    if (id.startsWith("_")) continue;
    if (d.plantillaJarl !== true || !d.huellaExterior) continue;
    resultado.set(id, {
      id,
      categoria: "edificio",
      huella: d.huellaExterior,
      colision: true,
      variantes: d.variantes ?? 1,
      produccion: d.produccion,
      plantillaJarl: true,
      energia: d.energia,
    });
  }
  return resultado;
}
