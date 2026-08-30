/**
 * Lógica de inventario — PURA (sin Colyseus ni fs, salvo cargarCatalogoItems)
 * para testearla sola, mismo patrón que construccion.ts/mundo/colisiones.ts.
 * Implementa el concepto ya cerrado en docs/Backlog_Mecanicas_Futuras.md
 * ("Inventario, contenedores y objetos en el mundo"):
 *
 *   - Rejilla tipo "tetris": cada ítem tiene una huella 2D real que hay que
 *     encajar, no una lista con cantidad.
 *   - Peso y espacio son EJES DISTINTOS: el peso cuenta contra el "peso
 *     transportable" (ligado a Fuerza); la huella cuenta contra el hueco
 *     físico de la rejilla — independientes entre sí.
 *   - Contenedores anidados: un ítem puede declarar `esContenedor` en el
 *     catálogo (items/catalogo/items.json) — al equiparse, su rejilla se
 *     suma como un Contenedor MÁS, independiente del cuerpo (decisión de
 *     esta fase, ver GDD_Inventario.md — el backlog lo dejaba abierto).
 *
 * Rotación: solo 0/1 (no 0/90/180/270) — una rejilla cuadrada de casillas no
 * gana nada con 180°/270° sobre 0°/90° (misma huella resultante), así que
 * dos estados bastan y simplifican la ocupación.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { RecetaCrafteo } from "../construccion/crafteo";

export type TipoItem = "recurso" | "equipable" | "herramienta" | "consumible" | "arma" | "municion" | "objeto" | "semilla";

export interface EntradaCatalogoItem {
  tipo: TipoItem;
  categoriaRecurso?: string;
  slotEquipo?: string;
  huella: [number, number];
  peso: number;
  apilable: boolean;
  stackMax?: number;
  esContenedor?: { ancho: number; alto: number };
  variantes: number;
  colorDebug: string;
  /** id de ropa/catalogo/prendas.json cuando esta entrada tiene representación visual real (armadura vestible) — ausente = placeholder sin voxel propio, mismo criterio que el resto del arte del proyecto. */
  prendaId?: string;

  // --- crafteo (docs/GDD_Crafteo.md) — informativo, cero código lo consume todavía salvo el catálogo en sí ---
  /** familia de material (metal/madera/piedra/cuero/tela/precioso...) — ausente = no forma parte de una cadena de refinamiento. */
  familiaMaterial?: string;
  /** tier dentro de su familia: 0 = crudo, 1 = refinado, 2 = avanzado... */
  tier?: number;

  // --- combate (pedido 2026-08-29, docs/GDD_Combate.md) — todo opcional/aditivo, cero cambio para lo que ya existe ---
  ataqueFisico?: number;
  ataqueMagico?: number;
  /** alcance en casillas — solo armas */
  alcance?: number;
  /** cooldown entre golpes con esta arma, en ms */
  cooldownMs?: number;
  defensaFisica?: number;
  defensaMagica?: number;
  /** id de items/catalogo/items.json (tipo "municion") que consume esta arma a distancia — ausente en armas cuerpo a cuerpo. */
  municionId?: string;
  /** docs/GDD_Anatomia.md, pedido 2026-08-30 — SOLO armas: qué efecto anatómico produce un golpe conectado (server/src/personaje/anatomia.ts::resolverGolpeAnatomico). "magico"/"fuego" reservados, sin arma que los use todavía. Ausente = sin efecto anatómico (fauna/NPC no llevan este campo). */
  tipoDano?: "cortante" | "contundente" | "perforante" | "magico" | "fuego";

  // --- desgaste (server/src/inventario/desgaste.ts) — ausente = el ítem nunca se desgasta ---
  durabilidadMax?: number;
  /** durabilidad perdida por cada USO directo (golpe dado, tala, minado...) */
  desgastePorUso?: number;

  /** docs/GDD_Personaje.md — solo en tipo:"consumible". Ausente en un consumible = sin efecto todavía (placeholder de contenido, no error). "caca" nunca se declara aquí — sube sola al comer, ver manejarPersonajeConsumir. */
  restaura?: { vital: "comida" | "bebida" | "sueno" | "estamina" | "vida" | "caca"; cantidad: number };

  /** docs/GDD_Mascotas.md — sirve para "dar de comer" a un animal domesticable y avanzar su domesticación; docs/GDD_Monturas.md lo cruza con `origenCocina` contra la `dieta` real de la especie. Ausente/false = no sirve como comida de mascota. */
  comidaMascota?: boolean;

  /** docs/GDD_Monturas.md — se consume sobre una mascota propia ya domesticada y `montable` (personajes/catalogo/animales_rig.json) para marcarla `montura:true` de forma permanente. Ausente/false = objeto normal. */
  esMontura?: boolean;

  /** docs/GDD_Agricultura.md — SOLO en tipo:"semilla": qué cultivo produce y cómo se comporta al plantarla. Ausente en cualquier otro tipo. */
  cultivo?: DatosCultivo;

  /** docs/GDD_Agricultura.md — "bolsa de semillas" comprada en tienda: `objeto:abrir` la desempaqueta en `cantidad` unidades sueltas de `itemId` (una semilla apilable). Mecanismo genérico, reusable para cualquier futuro "paquete de N" — no solo semillas. */
  abreEn?: { itemId: string; cantidad: number };

  /** docs/GDD_Bosques.md — SOLO en tipo:"semilla" de árbol (semilla_<especieId>): qué especie de vegetacion.json nace al plantarla y cuántos días de mundo tarda en madurar (mismo valor que EspecieArbol.diasMaduracion, duplicado aquí para no acoplar el catálogo de ítems al de vegetación). NO usa el campo `cultivo` — eso es solo agricultura de parcela. */
  crecimientoArbol?: { especieArbolId: string; diasMaduracion: number };

  /** docs/GDD_Cocina.md, pedido 2026-08-30 — SOLO en ingredientes crudos (tipo "recurso"): cuánto aportaría cocinado. Obligatorio `comida` ("todos quitan hambre", pedido explícito); vida/estamina/bebida opcionales, "cada uno lo marca el diseño". Consumido por `server/src/cocina/cocina.ts`. */
  aportesCocina?: AportesCocina;
  /** docs/GDD_Cocina.md — solo junto a `aportesCocina`: para el bonus de "combinar planta y carne". */
  origenCocina?: "vegetal" | "animal";

  /** docs/GDD_Cocina.md — igual que `restaura` pero con VARIOS vitales a la vez (un plato cocinado sube vida+estamina+comida+bebida en un solo consumo) — `restaura` se queda para consumibles de un solo vital, este es aditivo y nunca sustituye entradas existentes. */
  restauraMultiple?: AportesCocina;
}

/**
 * docs/GDD_Monturas.md (pedido 2026-08-30) — "dar de comer" ya no acepta
 * cualquier `comidaMascota`: tiene que encajar con la dieta REAL de la
 * especie (carnivoro/herbivoro/omnivoro, baker/catalogo/animales.json vía
 * catalogoCombateFauna.ts). Sin dato de un lado u otro (dieta desconocida
 * en catálogo, o comida sin `origenCocina` como racion_viaje) se acepta
 * igual — universal, mismo criterio "nunca romper por un dato ausente" que
 * el resto del proyecto.
 */
export function comidaSirveParaDieta(entrada: EntradaCatalogoItem | undefined, dieta: "herbivoro" | "carnivoro" | "omnivoro" | undefined): boolean {
  if (!entrada?.comidaMascota) return false;
  if (!dieta || !entrada.origenCocina || dieta === "omnivoro") return true;
  return dieta === "carnivoro" ? entrada.origenCocina === "animal" : entrada.origenCocina === "vegetal";
}

/**
 * Lo que aporta un ingrediente crudo al cocinarse, o un plato ya cocinado
 * al comerlo — mismos 4 ejes que pidió el streamer (docs/GDD_Cocina.md):
 * "+stamina +vida +hambre +bebida". `comida` siempre presente (quita
 * hambre); el resto opcional según el ingrediente/plato.
 */
export interface AportesCocina {
  vida?: number;
  estamina?: number;
  comida: number;
  bebida?: number;
}

/**
 * Datos de cultivo de una semilla (docs/GDD_Agricultura.md, pedido
 * 2026-08-30) — informativos, consumidos por `server/src/cultivo/cultivo.ts`
 * y `RoomExteriorBase.ts` (mensajes `cultivo:*`), nunca por el motor de
 * inventario en sí (mismo criterio que `restaura`/`energia`).
 */
export interface DatosCultivo {
  /** itemId (tipo "recurso") que se cosecha — YA debe existir en items.json. */
  itemIdCosecha: string;
  /** días de MUNDO (tiempoMundo().dia, no horas reales) desde que se planta hasta la primera cosecha. */
  diasCrecimiento: number;
  /** meses del año de mundo (1-12, tiempoMundo().mes) en los que esta semilla puede PLANTARSE — fuera de estos meses, `cultivo:plantar` se rechaza. */
  mesesSiembra: number[];
  /** true = tras cosechar, la planta sigue viva y vuelve a fructificar (mismo diasCrecimiento otra vez, mismo plantón); false = la cosecha se lleva la planta entera, la parcela queda vacía para volver a plantar. Asignado a mano por especie, como en la vida real (docs/GDD_Agricultura.md). */
  cosechaRecurrente: boolean;
  /** unidades de itemIdCosecha por cosecha, ANTES del multiplicador de la maceta/bancal. */
  cantidadPorCosecha: number;
  /** Injertos (docs/GDD_Agricultura.md §4, diseño cerrado en Backlog_Mecanicas_Futuras.md): "genética" de esta especie — obligatorios en TODA semilla, base o híbrida, porque `mesa_injertos` puede cruzar cualquier par. */
  rasgos: RasgosCultivo;
}

/**
 * Los 6 rasgos numéricos (0-1) de un cultivo (docs/Backlog_Mecanicas_Futuras.md
 * "Injertos y cruces de cultivos", diseño ya cerrado) — al injertar dos
 * semillas, cada rasgo del resultado = media de los dos padres + variación
 * aleatoria (ver `cultivo/cultivo.ts::mezclarRasgos`). Puramente
 * informativos por ahora salvo `rendimiento` (escala `cantidadPorCosecha`)
 * y `velocidadCrecimiento` (escala `diasCrecimiento`) en el híbrido
 * resultante — el resto (calidad/resistenciaEnfermedad/tamañoFruto/
 * necesidadAgua) queda como dato de sabor/futuro consumidor (precio de
 * venta, enfermedades...), mismo criterio "SIN CONSUMIDOR" ya aceptado en
 * otros catálogos del proyecto.
 */
export interface RasgosCultivo {
  rendimiento: number;
  calidad: number;
  resistenciaEnfermedad: number;
  velocidadCrecimiento: number;
  necesidadAgua: number;
  tamanoFruto: number;
}

export type CatalogoItems = Record<string, EntradaCatalogoItem>;

export type Rotacion = 0 | 1;

export interface ItemInstancia {
  /** id de instancia ÚNICO dentro del contenedor (no de catálogo) — se reasigna al mover entre contenedores. */
  id: number;
  itemId: string;
  cantidad: number;
  x: number;
  y: number;
  rot: Rotacion;
  /** ausente si el ítem de catálogo no tiene durabilidadMax (nunca se desgasta) — ver desgaste.ts */
  durabilidad?: number;
  /** epoch ms de la última vez que se tocó (para el desgaste por inactividad, cálculo perezoso) */
  ultimoUso?: number;
}

export interface Contenedor {
  ancho: number;
  alto: number;
  items: ItemInstancia[];
  /** siguiente id de instancia a repartir dentro de ESTE contenedor — nunca se reutiliza tras borrar. */
  siguienteId: number;
}

const RUTA_CATALOGO_DEFECTO = path.join(__dirname, "..", "..", "..", "items", "catalogo", "items.json");

/** Carga items/catalogo/items.json (filtra claves "_nota*", igual que el resto de catálogos del proyecto). */
export function cargarCatalogoItems(ruta: string = RUTA_CATALOGO_DEFECTO): CatalogoItems {
  const bruto = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, unknown>;
  const catalogo: CatalogoItems = {};
  for (const [id, datos] of Object.entries(bruto)) {
    if (id.startsWith("_")) continue;
    catalogo[id] = datos as EntradaCatalogoItem;
  }
  return catalogo;
}

export function crearContenedor(ancho: number, alto: number): Contenedor {
  return { ancho, alto, items: [], siguienteId: 1 };
}

const RUTA_RECETAS_DEFECTO = path.join(__dirname, "..", "..", "..", "items", "catalogo", "recetas.json");

/** Carga items/catalogo/recetas.json (docs/GDD_Crafteo.md §5) — mismo criterio que cargarCatalogoItems: filtra "_nota*". */
export function cargarCatalogoRecetas(ruta: string = RUTA_RECETAS_DEFECTO): Map<string, RecetaCrafteo> {
  const bruto = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, unknown>;
  const catalogo = new Map<string, RecetaCrafteo>();
  for (const [id, datos] of Object.entries(bruto)) {
    if (id.startsWith("_")) continue;
    // el JSON no repite el id dentro de cada entrada (sería redundante con
    // la clave) — se inyecta aquí, mismo criterio que cargarCatalogoConstruible.
    catalogo.set(id, { ...(datos as Omit<RecetaCrafteo, "id">), id });
  }
  return catalogo;
}

/** Huella ya rotada: rot=1 intercambia ancho/alto (giro de 90°). */
export function huellaRotada(huella: [number, number], rot: Rotacion): [number, number] {
  return rot === 1 ? [huella[1], huella[0]] : [huella[0], huella[1]];
}

/** Casillas [x,y] que ocupa un ítem con esa huella ya rotada, ancladas en (x0,y0) = esquina superior izquierda. */
function casillasDe(x0: number, y0: number, huella: [number, number]): Array<[number, number]> {
  const [w, h] = huella;
  const casillas: Array<[number, number]> = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) casillas.push([x0 + dx, y0 + dy]);
  return casillas;
}

/**
 * ¿Cabe un ítem con esta huella/rot en (x,y) del contenedor? Comprueba
 * límites de la rejilla Y solapamiento con instancias YA colocadas.
 * `ignorarId` excluye una instancia del chequeo (para mover/rotar la MISMA
 * pieza sin que choque consigo misma).
 */
export function hayHueco(
  contenedor: Contenedor,
  catalogo: CatalogoItems,
  itemId: string,
  x: number,
  y: number,
  rot: Rotacion,
  ignorarId?: number
): boolean {
  const entrada = catalogo[itemId];
  if (!entrada) return false;
  const [w, h] = huellaRotada(entrada.huella, rot);
  if (x < 0 || y < 0 || x + w > contenedor.ancho || y + h > contenedor.alto) return false;

  const ocupadas = new Set<string>();
  for (const it of contenedor.items) {
    if (it.id === ignorarId) continue;
    const datosIt = catalogo[it.itemId];
    if (!datosIt) continue;
    for (const [cx, cy] of casillasDe(it.x, it.y, huellaRotada(datosIt.huella, it.rot))) ocupadas.add(`${cx}_${cy}`);
  }
  for (const [cx, cy] of casillasDe(x, y, [w, h])) {
    if (ocupadas.has(`${cx}_${cy}`)) return false;
  }
  return true;
}

/** Primer hueco libre escaneando fila a fila (izquierda→derecha, arriba→abajo) — determinista, no aleatorio. */
export function buscarHueco(
  contenedor: Contenedor,
  catalogo: CatalogoItems,
  itemId: string,
  rot: Rotacion = 0
): { x: number; y: number } | null {
  for (let y = 0; y < contenedor.alto; y++) {
    for (let x = 0; x < contenedor.ancho; x++) {
      if (hayHueco(contenedor, catalogo, itemId, x, y, rot)) return { x, y };
    }
  }
  return null;
}

export interface ResultadoAgregar {
  ok: boolean;
  motivo?: "sin_hueco" | "item_desconocido";
  instancia?: ItemInstancia;
}

/**
 * Añade `cantidad` unidades de itemId al contenedor. Si es apilable, intenta
 * primero sumarse a una pila YA existente con hueco (hasta stackMax) antes
 * de abrir una casilla nueva — mismo criterio "encajar antes que expandir"
 * de cualquier inventario en rejilla real. Si sobra cantidad tras llenar una
 * pila, abre pilas nuevas hasta que quepa o se quede sin hueco (entonces
 * devuelve ok:false con lo que SÍ entró ya aplicado — nunca a medias sin
 * decírselo a quien llama).
 */
export function agregarItem(contenedor: Contenedor, catalogo: CatalogoItems, itemId: string, cantidad: number): ResultadoAgregar {
  const entrada = catalogo[itemId];
  if (!entrada) return { ok: false, motivo: "item_desconocido" };

  let restante = cantidad;
  let ultimaInstancia: ItemInstancia | undefined;

  if (entrada.apilable) {
    const tope = entrada.stackMax ?? Infinity;
    for (const it of contenedor.items) {
      if (restante <= 0) break;
      if (it.itemId !== itemId || it.cantidad >= tope) continue;
      const suma = Math.min(tope - it.cantidad, restante);
      it.cantidad += suma;
      restante -= suma;
      ultimaInstancia = it;
    }
  }

  while (restante > 0) {
    const hueco = buscarHueco(contenedor, catalogo, itemId);
    if (!hueco) return { ok: false, motivo: "sin_hueco", instancia: ultimaInstancia };
    const enEstaPila = entrada.apilable ? Math.min(entrada.stackMax ?? Infinity, restante) : 1;
    const instancia: ItemInstancia = {
      id: contenedor.siguienteId++,
      itemId,
      cantidad: enEstaPila,
      x: hueco.x,
      y: hueco.y,
      rot: 0,
      // nace a durabilidad máxima si el catálogo declara durabilidadMax;
      // si no, se queda sin el campo (nunca se desgasta) — ver desgaste.ts
      ...(entrada.durabilidadMax != null ? { durabilidad: entrada.durabilidadMax } : {}),
    };
    contenedor.items.push(instancia);
    restante -= enEstaPila;
    ultimaInstancia = instancia;
  }
  return { ok: true, instancia: ultimaInstancia };
}

export interface ResultadoQuitar {
  ok: boolean;
  motivo?: "no_encontrado" | "cantidad_insuficiente";
}

/** Quita `cantidad` de una instancia concreta (por id de INSTANCIA, no de catálogo) — la borra si llega a 0. */
export function quitarItem(contenedor: Contenedor, instanciaId: number, cantidad: number): ResultadoQuitar {
  const idx = contenedor.items.findIndex((it) => it.id === instanciaId);
  if (idx === -1) return { ok: false, motivo: "no_encontrado" };
  const it = contenedor.items[idx];
  if (it.cantidad < cantidad) return { ok: false, motivo: "cantidad_insuficiente" };
  it.cantidad -= cantidad;
  if (it.cantidad === 0) contenedor.items.splice(idx, 1);
  return { ok: true };
}

export interface ResultadoMover {
  ok: boolean;
  motivo?: "no_encontrado" | "sin_hueco";
}

/**
 * Mueve una instancia dentro del MISMO contenedor (reposicionar/rotar) o a
 * OTRO contenedor (cuerpo -> mochila, por ejemplo) — mismo caso, destino
 * puede ser el mismo objeto que origen. Todo o nada: si no cabe, no toca
 * nada (ni borra del origen).
 */
export function moverItem(
  origen: Contenedor,
  destino: Contenedor,
  catalogo: CatalogoItems,
  instanciaId: number,
  xDestino: number,
  yDestino: number,
  rotDestino: Rotacion
): ResultadoMover {
  const it = origen.items.find((i) => i.id === instanciaId);
  if (!it) return { ok: false, motivo: "no_encontrado" };
  // ignorarId solo tiene sentido si origen === destino (misma instancia ya colocada ahí)
  const ignorar = origen === destino ? instanciaId : undefined;
  if (!hayHueco(destino, catalogo, it.itemId, xDestino, yDestino, rotDestino, ignorar)) {
    return { ok: false, motivo: "sin_hueco" };
  }
  if (origen !== destino) {
    origen.items.splice(origen.items.indexOf(it), 1);
    it.id = destino.siguienteId++;
    destino.items.push(it);
  }
  it.x = xDestino;
  it.y = yDestino;
  it.rot = rotDestino;
  return { ok: true };
}

/** Peso total de lo que hay dentro de un contenedor (suma peso_unitario * cantidad de cada instancia). */
export function pesoContenedor(contenedor: Contenedor, catalogo: CatalogoItems): number {
  let total = 0;
  for (const it of contenedor.items) {
    const entrada = catalogo[it.itemId];
    if (entrada) total += entrada.peso * it.cantidad;
  }
  return Math.round(total * 100) / 100;
}

/**
 * ¿Cargar `cantidad` más de `itemId` dejaría el contenedor por encima de lo
 * que puede transportar ese nivel de Fuerza? (`pesoMaximoTransportable`,
 * `server/src/personaje/bonusAtributos.ts` — docs/GDD_Personaje.md §3.3).
 * `true` = NO cabe por peso (aunque hubiera hueco físico en la rejilla).
 */
export function excedePesoMaximo(
  contenedor: Contenedor,
  catalogo: CatalogoItems,
  itemId: string,
  cantidad: number,
  pesoMaximo: number,
): boolean {
  const entrada = catalogo[itemId];
  if (!entrada) return false; // ítem desconocido: que lo rechace intentarCoger, no esto
  return pesoContenedor(contenedor, catalogo) + entrada.peso * cantidad > pesoMaximo;
}

export interface SlotsEquipo {
  [slot: string]: string | undefined; // slot -> itemId equipado (undefined = vacío)
}

// docs/GDD_Equipo.md — los 19 huecos de equipo del jugador. Los de anillo
// son un caso especial: el catálogo declara `slotEquipo:"anillo"` (UN solo
// valor, un anillo vale para cualquier mano) pero hay DOS huecos físicos
// donde puede caer (anilloIzquierdo/anilloDerecho) — GRUPOS_SLOT resuelve
// esa equivalencia sin tener que duplicar cada anillo del catálogo con un
// id distinto por mano.
const GRUPOS_SLOT: Record<string, string[]> = {
  anillo: ["anilloIzquierdo", "anilloDerecho"],
};

/** ¿Puede equiparse este ítem en este slot? El catálogo declara UN slotEquipo; GRUPOS_SLOT amplía los casos "vale para varios huecos físicos" (hoy solo anillo). */
export function puedeEquiparEnSlot(catalogo: CatalogoItems, itemId: string, slot: string): boolean {
  const declarado = catalogo[itemId]?.slotEquipo;
  if (!declarado) return false;
  if (declarado === slot) return true;
  return (GRUPOS_SLOT[declarado] ?? []).includes(slot);
}

// Slots que, al equiparse con un ítem `esContenedor`, aportan una rejilla
// PROPIA (docs/GDD_Inventario.md §3: "independientes, nunca fusionada con
// la del cuerpo") — espalda (mochila), cinturon (bolsa/riñonera) y
// bandolera (bolso cruzado): los 3 SIMULTÁNEOS, cada uno con su propio
// Contenedor en `extras` (decisión de diseño de docs/GDD_Equipo.md, pedida
// explícitamente: "varios tipos DIFERENTES colocados en su cuerpo a la vez").
export const SLOTS_CONTENEDOR = new Set(["espalda", "cinturon", "bandolera"]);

/** Vista unificada de TODOS los contenedores de un jugador (cuerpo + cada mochila/bolsa equipada) — para operaciones que recorren "todo lo que lleva encima" (buscar una instancia, sumar peso). */
export interface InventarioJugador {
  cuerpo: Contenedor;
  extras: Map<string, Contenedor>; // slot contenedor -> su rejilla propia
  equipo: SlotsEquipo;
}

function *contenedoresDe(inv: InventarioJugador): Generator<[string, Contenedor]> {
  yield ["cuerpo", inv.cuerpo];
  for (const [slot, cont] of inv.extras) yield [slot, cont];
}

/** Busca una instancia por id en CUALQUIER contenedor del jugador (cuerpo o cualquier mochila/bolsa equipada) — para equipar/consumir/mover sin que quien llame tenga que saber de antemano en cuál está. */
export function buscarInstanciaJugador(
  inv: InventarioJugador,
  instanciaId: number,
): { contenedorId: string; contenedor: Contenedor; item: ItemInstancia } | null {
  for (const [contenedorId, contenedor] of contenedoresDe(inv)) {
    const item = contenedor.items.find((it) => it.id === instanciaId);
    if (item) return { contenedorId, contenedor, item };
  }
  return null;
}

/** Peso total de TODO lo que lleva el jugador — cuerpo + cada mochila/bolsa equipada. El peso máximo transportable (Fuerza, docs/GDD_Personaje.md §3.3) se compara contra ESTA suma, nunca solo contra el cuerpo — mochilas dan más HUECO, nunca más peso permitido (ejes independientes, GDD_Inventario.md §0). */
export function pesoTotalJugador(inv: InventarioJugador, catalogo: CatalogoItems): number {
  let total = 0;
  for (const [, contenedor] of contenedoresDe(inv)) total += pesoContenedor(contenedor, catalogo);
  return Math.round(total * 100) / 100;
}

export interface ResultadoEquipar {
  ok: boolean;
  motivo?: "instancia_no_encontrada" | "no_equipable_en_ese_slot" | "slot_ocupado" | "item_desconocido";
}

/**
 * Equipa una instancia (de CUALQUIER contenedor del jugador — cuerpo o una
 * mochila/bolsa ya puesta) en `slot`. La pieza sale de su contenedor de
 * origen y su itemId pasa a `equipo[slot]`; si además declara
 * `esContenedor` (mochila/bolsa) Y el slot es uno de SLOTS_CONTENEDOR, se
 * crea su rejilla propia en `extras[slot]` — vacía, lista para usar.
 * Un slot ya ocupado se rechaza (`slot_ocupado`): desequipar primero es un
 * paso explícito, mismo criterio "eventos explícitos, nunca automágicos"
 * que ya usa el resto del proyecto (docs/GDD_Personaje.md §1).
 */
export function equiparItem(inv: InventarioJugador, catalogo: CatalogoItems, instanciaId: number, slot: string): ResultadoEquipar {
  const encontrado = buscarInstanciaJugador(inv, instanciaId);
  if (!encontrado) return { ok: false, motivo: "instancia_no_encontrada" };
  const { contenedor, item } = encontrado;
  const entrada = catalogo[item.itemId];
  if (!entrada) return { ok: false, motivo: "item_desconocido" };
  if (!puedeEquiparEnSlot(catalogo, item.itemId, slot)) return { ok: false, motivo: "no_equipable_en_ese_slot" };
  if (inv.equipo[slot]) return { ok: false, motivo: "slot_ocupado" };

  quitarItem(contenedor, instanciaId, item.cantidad);
  inv.equipo[slot] = item.itemId;
  if (entrada.esContenedor && SLOTS_CONTENEDOR.has(slot)) {
    inv.extras.set(slot, crearContenedor(entrada.esContenedor.ancho, entrada.esContenedor.alto));
  }
  return { ok: true };
}

export interface ResultadoDesequipar {
  ok: boolean;
  motivo?: "slot_vacio" | "item_desconocido" | "contenedor_no_vacio" | "sin_hueco" | "excede_peso";
}

/**
 * Desequipa `slot`: la pieza vuelve al `cuerpo` (primer hueco libre, mismo
 * criterio determinista que `buscarHueco`) — falla con `sin_hueco` en vez
 * de perder el objeto si no cabe. Un slot contenedor con la mochila/bolsa
 * TODAVÍA con cosas dentro se rechaza (`contenedor_no_vacio`): hay que
 * vaciarla primero, igual que en la vida real no te puedes quitar una
 * mochila puesta y que el contenido desaparezca solo.
 *
 * `pesoMaximo` (opcional): mientras algo está EQUIPADO no cuenta contra el
 * peso transportable (`pesoTotalJugador` solo suma cuerpo+extras, nunca
 * `equipo` — llevarlo puesto no pesa en la mochila, mismo criterio que
 * "peso y espacio son ejes distintos" de docs/GDD_Inventario.md §0); pero
 * SÍ vuelve a contar en cuanto se quita, así que hay que comprobarlo aquí
 * o un jugador ya al límite podría desequipar algo pesado y quedarse por
 * encima sin que nada lo impidiera. Sin este argumento, no se comprueba
 * (uso en tests/herramientas que no necesitan la regla de peso).
 */
export function desequiparItem(inv: InventarioJugador, catalogo: CatalogoItems, slot: string, pesoMaximo?: number): ResultadoDesequipar {
  const itemId = inv.equipo[slot];
  if (!itemId) return { ok: false, motivo: "slot_vacio" };
  const entrada = catalogo[itemId];
  if (!entrada) return { ok: false, motivo: "item_desconocido" };

  if (SLOTS_CONTENEDOR.has(slot)) {
    const extra = inv.extras.get(slot);
    if (extra && extra.items.length > 0) return { ok: false, motivo: "contenedor_no_vacio" };
  }

  if (pesoMaximo != null && excedePesoMaximo(inv.cuerpo, catalogo, itemId, 1, pesoMaximo)) {
    return { ok: false, motivo: "excede_peso" };
  }

  const resultado = agregarItem(inv.cuerpo, catalogo, itemId, 1);
  if (!resultado.ok) return { ok: false, motivo: "sin_hueco" };

  delete inv.equipo[slot];
  if (SLOTS_CONTENEDOR.has(slot)) inv.extras.delete(slot);
  return { ok: true };
}

export interface StatsEquipo {
  defensaFisica: number;
  defensaMagica: number;
  ataqueFisico: number;
  ataqueMagico: number;
}

/**
 * Suma los stats de TODO lo equipado (docs/GDD_Equipo.md) — nunca se
 * persiste un total aparte, se recalcula desde `equipo` cada vez que algo
 * cambia (equipar/desequipar), mismo criterio que ya fijó
 * docs/GDD_Personaje.md §1 para ataque/defensa: "combinar atributos +
 * equipo en el momento de resolver, sin nada que sincronizar de más".
 */
export function calcularStatsEquipo(catalogo: CatalogoItems, equipo: SlotsEquipo): StatsEquipo {
  const total: StatsEquipo = { defensaFisica: 0, defensaMagica: 0, ataqueFisico: 0, ataqueMagico: 0 };
  for (const itemId of Object.values(equipo)) {
    if (!itemId) continue;
    const entrada = catalogo[itemId];
    if (!entrada) continue;
    total.defensaFisica += entrada.defensaFisica ?? 0;
    total.defensaMagica += entrada.defensaMagica ?? 0;
    total.ataqueFisico += entrada.ataqueFisico ?? 0;
    total.ataqueMagico += entrada.ataqueMagico ?? 0;
  }
  return total;
}
