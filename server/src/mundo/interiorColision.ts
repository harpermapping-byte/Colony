/**
 * Convierte el interior YA bakeado de un edificio (interiores/src/edificio.js,
 * el mismo JSON que ciudades/ escribe en `<rutaMapa>/interiores/<edificio>.json`)
 * en la rejilla de colisión que usa la simulación — mismo patrón que
 * mundo/mapaColision.ts para el exterior, pero a escala de habitación.
 *
 * v2 (docs/GDD_Sistema_Puertas.md): rejilla de la planta que se pida por
 * `nivel` (NUNCA plantas[0] a fuego: con bodega, el índice 0 es el sótano).
 * Las escaleras/trampillas (conectoresVerticales) de ESA planta se exponen
 * como `conectores`, cada uno con su casilla real — InteriorRoom los trata
 * como un portal más: pisarlos/interactuar cambia de planta (mismo mensaje
 * portal:usar/portal:ir que el resto del sistema de puertas). Las puertas
 * ENTRE salas de la MISMA planta (puertasConexion) siguen sin ser TP: son
 * solo un hueco físico en la pared, como pactó el usuario.
 */

import * as fs from "fs";
import * as path from "path";
import { MundoColision, TIPO } from "./colisiones";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");

interface DefElemento {
  capa?: string;
  anchorType?: string;
  esCama?: boolean;
  esSilla?: boolean;
}

// Colisión PROPIA de interiores — NO la del catálogo de construcción
// (construccion/catalogo.ts: "todo bloquea salvo FLOOR_DECAL", pensado
// para lo poco que coloca un jugador). Un interior bakeado por
// interiores/ viene lleno de clutter decorativo ("suciedad": hojas
// secas, escombros, nidos de rata; "iluminacion": antorchas de pie) que
// NUNCA debería bloquear el paso — con la regla de construcción, una
// habitación de 20 casillas con 9 piezas de clutter salía casi
// intransitable (bug real, encontrado con flood-fill de prueba).
const CAPAS_QUE_NO_BLOQUEAN = new Set(["suciedad", "iluminacion"]);
let catalogoElementos: Record<string, DefElemento> | null = null;
function elementoEsSolido(id: string): boolean {
  if (!catalogoElementos) {
    catalogoElementos = JSON.parse(
      fs.readFileSync(path.join(RAIZ_REPO, "interiores", "catalogo", "elementos.json"), "utf8"),
    );
  }
  const def = catalogoElementos![id];
  if (!def) return false; // pieza desconocida: mejor pasable que atascar al jugador
  if (CAPAS_QUE_NO_BLOQUEAN.has(def.capa ?? "")) return false;
  return def.anchorType !== "FLOOR_DECAL";
}

/** `esCama`/`esSilla` del catálogo (interiores/catalogo/elementos.json) — mismos flags que ya usa `construccion/catalogo.ts` para el mobiliario del JUGADOR (2026-09-08, "vida en interiores" con silla/cama real). */
function definicionDe(id: string): DefElemento | undefined {
  if (!catalogoElementos) {
    catalogoElementos = JSON.parse(
      fs.readFileSync(path.join(RAIZ_REPO, "interiores", "catalogo", "elementos.json"), "utf8"),
    );
  }
  return catalogoElementos![id];
}

interface ElementoColocado {
  id: string;
  x: number;
  y: number;
  ancho: number;
  largo: number;
  /** Objetos SIN casilla propia sobre este mueble (interiores/src/colocarElementos.js,
   * AnchorType.CHILD_SLOT) — instanceId único y determinista del bake, se
   * interactúa por la posición del HOST. Fase 2 de inventario ("coger",
   * docs/GDD_Inventario.md §7): antes se descartaba al cargar. */
  sobre?: { id: string; instanceId: string }[];
  /** instanceId propio del mueble (único y determinista del bake) — "vida
   * en interiores" con silla/cama real (2026-09-08) lo usa para reservar
   * qué NPC ocupa cuál, sin que dos coincidan en el mismo mueble. */
  instanceId?: string;
  /** Offset [dx,dy] (interiores/src/colocarElementos.js) — casilla exacta
   * donde sentarse/interactuar, relativa a x/y. Ausente = usar x/y tal cual
   * (mueble de 1x1 sin offset dedicado, p.ej. la mayoría de sillas). */
  tileInteraccion?: [number, number];
}

interface SalaInterior {
  offsetX: number;
  offsetY: number;
  resultado: {
    ancho: number;
    largo: number;
    puerta: { lado: string; x: number; y: number } | null;
    colocados: ElementoColocado[];
    /** Sala ORGÁNICA (mazmorras/src/celular.js, docs/GDD_Bakeador_Dungeons.md):
     * string ancho*largo de '1'/'0' — solo esas casillas son suelo real. Ausente
     * = comportamiento de siempre, el rectángulo entero es suelo. */
    mascara?: string;
  };
}

/** Punto candidato de spawn de enemigo (docs/GDD_Bakeador_Dungeons.md §4.2) —
 * el bake coloca MUCHOS puntos por planta; qué subconjunto se activa lo
 * decide el servidor (DungeonRoom) en runtime, no este loader. */
export interface SpawnEnemigo {
  x: number;
  y: number;
  temasEnemigo: string[];
  esBossSlot: boolean;
}

interface PuertaConexion {
  x: number;
  y: number;
}

interface PosicionConector {
  x: number;
  y: number;
}

interface ConectorVertical {
  tipoConectorId: string;
  entreNiveles: [number, number];
  salaAbajo: string;
  salaArriba: string;
  posicionAbajo: PosicionConector;
  posicionArriba: PosicionConector;
  huella: [number, number];
}

interface InteriorBakeado {
  id: string;
  tipoEdificioId?: string;
  tipoDungeonId?: string;
  plantas: { nivel: number; rol: string; salas: SalaInterior[]; puertasConexion?: PuertaConexion[]; spawnsEnemigos?: SpawnEnemigo[] }[];
  conectoresVerticales?: ConectorVertical[];
}

/** Escalera/trampilla de ESTA planta, ya resuelta a "aquí está, a este nivel lleva". */
export interface ConectorInteractivo {
  x: number;
  y: number;
  huella: [number, number];
  tipoConectorId: string;
  destinoNivel: number;
  /** casilla del OTRO lado (en la rejilla de `destinoNivel`) donde aparece
   * quien lo cruza — las plantas no comparten XY (GDD_Bakeador_Interiores
   * sección 7), así que la posición de aquí NO sirve para el otro piso. */
  entradaDestino: { x: number; y: number };
}

/** Sala alquilable/comprable con id ESTABLE (docs/GDD_Propiedades.md) — su
 * índice dentro de `salas` de ESTA planta, ya determinista por semilla
 * (colocarSala se siembra con `${semilla}:${nivel}:${i}`, interiores/src/
 * edificio.js:143): un campo derivado en este loader, sin tocar el bake. */
export interface SalaIndexada {
  salaIndex: number;
  tipoSalaId: string;
  x: number;
  y: number;
}

/** Silla/cama real (2026-09-08) — casilla exacta de interacción + instanceId para reservar. */
export interface MuebleInteractivo {
  x: number;
  y: number;
  instanceId: string;
  esCama: boolean;
  esSilla: boolean;
}

export interface InteriorCargado extends MundoColision {
  id: string;
  /** tipoEdificioId (edificios normales) o tipoDungeonId (mazmorras) — "" si ninguno. Gatea qué acciones de propiedad aplican (docs/GDD_Propiedades.md: ventaJugador/salasAlquilables). */
  tipoEdificioId: string;
  nivel: number;
  rol: string;
  /** casilla de aparición al entrar (dentro de la primera sala de la planta) */
  spawnX: number;
  spawnY: number;
  conectores: ConectorInteractivo[];
  /** Puntos candidatos de spawn de enemigo de ESTA planta (mazmorras) — [] en
   * un interior normal (edificios/interiores/ no llevan este campo). */
  spawnsEnemigos: SpawnEnemigo[];
  /** Casilla pisable por tipoSalaId de ESTA planta (GDD_Agentes_Moviles.md
   * "vida en interiores"): dónde colocar a un NPC cuya rutina dice "casa,
   * sala X" — varias salas del mismo tipo (dos dormitorios) dan varios
   * puntos. Vacío en interiores sin `sala` real por tramo (mazmorras). */
  salasPorTipo: Map<string, { x: number; y: number }[]>;
  /** Sillas/camas REALES (esCama/esSilla, interiores/catalogo/elementos.json)
   * de ESTA planta, indexadas por tipoSalaId (GDD_Agentes_Moviles.md "vida
   * en interiores", pedido 2026-09-08: "sentarse en sillas... tumbarse en
   * su cama"). `instanceId` deja reservar el mueble concreto por NPC
   * (GestorVidaInterior) para que dos no coincidan en la misma silla/cama.
   * Vacío en interiores sin mobiliario de ese tipo (mazmorras, la mayoría
   * de salas no domésticas). */
  mueblesPorSala: Map<string, MuebleInteractivo[]>;
  /** Solo las salas ALQUILABLES (dormitorio_individual/dormitorio_comunal) de
   * ESTA planta, con su id estable — docs/GDD_Propiedades.md. Vacío si el
   * edificio no tiene salas de ese tipo en esta planta (la inmensa mayoría). */
  salasIndexadas: SalaIndexada[];
  /** Objetos "sobre" (sin casilla propia) de ESTA planta, vivos en memoria —
   * fase 2 de inventario ("coger", docs/GDD_Inventario.md §7). Clave =
   * instanceId (ya único y determinista, generado por el bake). Se filtra
   * si el id de catálogo cabe o no en items/catalogo/items.json en el
   * momento de "coger", NO aquí — así ampliar items.json amplía qué es
   * cogible sin tocar este loader (CLAUDE.md: "las listas crecen"). */
  objetosSueltos: Map<string, { itemId: string; x: number; y: number }>;
}

export function cargarInterior(rutaArchivo: string, nivel = 0): InteriorCargado {
  const interior = JSON.parse(fs.readFileSync(rutaArchivo, "utf8")) as InteriorBakeado;
  // plantas[0] NO es siempre la planta baja: un edificio con bodega
  // (tieneBodega:true en tipos_edificio.json — casa_noble, taberna,
  // posada, casa_gremio, ayuntamiento...) trae la bodega en el índice 0
  // (bug real: cargaba el sótano como si fuera la entrada, con su propio
  // tamaño de rejilla — dejaba el resto del edificio fuera de la rejilla
  // de colisión entera). Buscar por `nivel` explícito, nunca por posición.
  const planta = interior.plantas.find((p) => p.nivel === nivel) ?? interior.plantas.find((p) => p.rol === "planta_baja") ?? interior.plantas[0];
  const salas = planta?.salas ?? [];
  if (salas.length === 0) throw new Error(`interior sin salas en la planta nivel=${nivel}: ${rutaArchivo}`);

  const puertas = planta.puertasConexion ?? [];
  const ancho = Math.max(...salas.map((s) => s.offsetX + s.resultado.ancho), ...puertas.map((p) => p.x + 1)) + 1;
  const alto = Math.max(...salas.map((s) => s.offsetY + s.resultado.largo), ...puertas.map((p) => p.y + 1)) + 1;
  const casillas = new Uint8Array(ancho * alto).fill(TIPO.SOLIDO); // fuera de toda sala = pared
  const velocidad = new Float32Array(ancho * alto).fill(1);

  const objetosSueltos = new Map<string, { itemId: string; x: number; y: number }>();
  for (const sala of salas) {
    const { offsetX, offsetY, resultado } = sala;
    for (let y = 0; y < resultado.largo; y++) {
      for (let x = 0; x < resultado.ancho; x++) {
        // sala orgánica (mazmorras): solo la máscara es suelo, el resto del
        // rectángulo se queda SOLIDO (ya lo está por el fill inicial) — sin
        // esto una cueva se habría pintado como un rectángulo perfecto.
        if (resultado.mascara && resultado.mascara[y * resultado.ancho + x] !== "1") continue;
        casillas[(offsetY + y) * ancho + (offsetX + x)] = TIPO.TIERRA;
      }
    }
    for (const item of resultado.colocados) {
      // objetos "sobre" (plato, libro, frasco_pocion...) NO tienen casilla
      // propia — se interactúa por la posición del mueble que los sostiene.
      for (const sub of item.sobre ?? []) {
        objetosSueltos.set(sub.instanceId, { itemId: sub.id, x: offsetX + item.x, y: offsetY + item.y });
      }
      if (!elementoEsSolido(item.id)) continue; // decorativo/clutter: no bloquea
      for (let y = 0; y < item.largo; y++) {
        for (let x = 0; x < item.ancho; x++) {
          const idx = (offsetY + item.y + y) * ancho + (offsetX + item.x + x);
          if (idx >= 0 && idx < casillas.length) casillas[idx] = TIPO.SOLIDO;
        }
      }
    }
  }

  // Puertas de conexión REALES entre salas (interiores/src/edificio.js):
  // sin esto cada sala quedaba pisable por dentro pero sin ningún hueco
  // que la conectara con la de al lado o el pasillo — jugador atascado en
  // su cuarto. Se despeja la puerta Y su umbral (los 4 vecinos): el
  // mobiliario se coloca sin saber todavía dónde caerá esta puerta (se
  // decide después, entre salas, no dentro de colocarSala) y a veces
  // termina justo encima — sin esto, un mueble podía tapar la única
  // conexión entre dos salas (bug real, encontrado con flood-fill).
  for (const puerta of planta.puertasConexion ?? []) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = puerta.x + dx, y = puerta.y + dy;
      if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
      casillas[y * ancho + x] = TIPO.TIERRA;
    }
  }

  // Aparece cerca del centro de la primera sala (v1: no hay forma explícita
  // de saber cuál conecta con la puerta exterior — ver GDD_Sistema_Puertas.md),
  // corregido a la casilla pisable más cercana: el centro geométrico exacto
  // a veces cae encima de un mueble colocado ahí a propósito (una mesa, un
  // hogar) — spawn dentro de un sólido dejaba al jugador aislado del resto
  // de la sala en el flood-fill (bug real, encontrado con la prueba).
  const primera = salas[0];
  const centroX = Math.round(primera.offsetX + primera.resultado.ancho / 2);
  const centroY = Math.round(primera.offsetY + primera.resultado.largo / 2);
  const spawn = casillaPisableMasCercana(casillas, ancho, alto, centroX, centroY);

  // Garantía final de conectividad: el mobiliario se coloca sala a sala sin
  // saber nada de las salas vecinas, así que un cúmulo de clutter puede
  // (raro, pero pasa — bug real encontrado aquí) sellar por accidente el
  // único acceso a una sala más allá del umbral de su puerta, aunque la
  // puerta en sí esté despejada. En vez de intentar predecir todos los
  // casos, se COMPRUEBA con flood-fill real desde el spawn y, si una sala
  // queda fuera, se abre un pasillo recto de una casilla hasta ella — más
  // vale un mueble desaparecido en un caso raro que un jugador atascado.
  garantizarConectividad(casillas, ancho, alto, spawn, salas);

  // Conectores verticales (escaleras/trampillas) que tocan ESTA planta —
  // se despeja su huella como TIERRA (por si algún mueble cercano invadió
  // la casilla) y se exponen con el nivel al que llevan, para que
  // InteriorRoom los trate como un portal más.
  const conectores: ConectorInteractivo[] = [];
  for (const c of interior.conectoresVerticales ?? []) {
    const [nivelAbajo, nivelArriba] = c.entreNiveles;
    let posicion: PosicionConector | null = null;
    let entradaDestino: PosicionConector | null = null;
    let destinoNivel: number | null = null;
    if (nivelAbajo === nivel) { posicion = c.posicionAbajo; entradaDestino = c.posicionArriba; destinoNivel = nivelArriba; }
    else if (nivelArriba === nivel) { posicion = c.posicionArriba; entradaDestino = c.posicionAbajo; destinoNivel = nivelAbajo; }
    if (!posicion || !entradaDestino || destinoNivel === null) continue;

    const [hw, hl] = c.huella;
    for (let y = 0; y < hl; y++) {
      for (let x = 0; x < hw; x++) {
        const idx = (posicion.y + y) * ancho + (posicion.x + x);
        if (idx >= 0 && idx < casillas.length) casillas[idx] = TIPO.TIERRA;
      }
    }
    conectores.push({
      x: posicion.x, y: posicion.y, huella: c.huella, tipoConectorId: c.tipoConectorId,
      destinoNivel,
      // centro de la huella, no la esquina: aparecer en la esquina exacta
      // de un conector 1x3 deja al jugador pegado al borde en vez de en
      // medio del hueco (misma huella a ambos lados del conector).
      entradaDestino: { x: entradaDestino.x + hw / 2, y: entradaDestino.y + hl / 2 },
    });
  }

  // Casillas pisables por tipoSalaId (vida en interiores, "no se
  // apelotonen"): VARIAS por sala (no solo el centro) — hasta 6 casillas
  // pisables reales dentro del rectángulo de la sala, para que varios NPCs
  // que coincidan ahí (varios inquilinos de un dormitorio comunal, la
  // familia entera en el salón) no queden todos en el mismo punto.
  // poblarInterior las reparte por turno rotatorio, así nunca se repiten.
  // Habitaciones alquilables/comprables (docs/GDD_Propiedades.md): solo los
  // 2 tipos de dormitorio de taberna/posada — dormitorios de vivienda
  // privada (casa_humilde/casa_noble) NO son propiedad independiente, son
  // parte del inmueble entero.
  const TIPOS_SALA_ALQUILABLE = new Set(["dormitorio_individual", "dormitorio_comunal"]);
  const salasPorTipo = new Map<string, { x: number; y: number }[]>();
  const salasIndexadas: SalaIndexada[] = [];
  const mueblesPorSala = new Map<string, MuebleInteractivo[]>();
  for (let salaIndex = 0; salaIndex < salas.length; salaIndex++) {
    const sala = salas[salaIndex];
    const tipoSalaId = (sala as unknown as { tipoSalaId?: string }).tipoSalaId;
    if (!tipoSalaId) continue;
    const puntos: { x: number; y: number }[] = [];
    const vistos = new Set<number>();
    const cx = Math.round(sala.offsetX + sala.resultado.ancho / 2);
    const cy = Math.round(sala.offsetY + sala.resultado.largo / 2);
    for (let y = sala.offsetY; y < sala.offsetY + sala.resultado.largo && puntos.length < 6; y++) {
      for (let x = sala.offsetX; x < sala.offsetX + sala.resultado.ancho && puntos.length < 6; x++) {
        const idx = y * ancho + x;
        if (casillas[idx] === TIPO.SOLIDO || vistos.has(idx)) continue;
        vistos.add(idx);
        puntos.push({ x, y });
      }
    }
    if (puntos.length === 0) puntos.push(casillaPisableMasCercana(casillas, ancho, alto, cx, cy));
    const lista = salasPorTipo.get(tipoSalaId) ?? [];
    lista.push(...puntos);
    salasPorTipo.set(tipoSalaId, lista);

    if (TIPOS_SALA_ALQUILABLE.has(tipoSalaId)) {
      salasIndexadas.push({ salaIndex, tipoSalaId, x: puntos[0].x, y: puntos[0].y });
    }

    // Sillas/camas REALES de esta sala (2026-09-08) — mismo `esCama`/
    // `esSilla` del catálogo que ya usa `construccion/catalogo.ts` para el
    // mobiliario del jugador. `tileInteraccion`, cuando el bake lo trae, es
    // la casilla LOCAL (a la sala) YA ROTADA de interacción — coordenada
    // ABSOLUTA dentro de la sala, no un delta que sumar a item.x/y (bug
    // real, encontrado probando contra un bake real: sumarlo dos veces
    // mandaba la "cama" fuera de la sala entera, y `caminoEntre` nunca
    // encontraba camino). Sin `tileInteraccion`, cae a la esquina x/y del
    // propio mueble (mismo criterio que el resto de piezas sin ese campo).
    const muebles: MuebleInteractivo[] = [];
    for (const item of sala.resultado.colocados) {
      const def = definicionDe(item.id);
      if (!def?.esCama && !def?.esSilla) continue;
      if (!item.instanceId) continue; // pieza sin instanceId propio: nada que reservar de forma estable
      const [tix, tiy] = item.tileInteraccion ?? [item.x, item.y];
      muebles.push({
        x: sala.offsetX + tix,
        y: sala.offsetY + tiy,
        instanceId: item.instanceId,
        esCama: !!def.esCama,
        esSilla: !!def.esSilla,
      });
    }
    if (muebles.length > 0) {
      const listaM = mueblesPorSala.get(tipoSalaId) ?? [];
      listaM.push(...muebles);
      mueblesPorSala.set(tipoSalaId, listaM);
    }
  }

  return {
    id: interior.id,
    tipoEdificioId: interior.tipoEdificioId ?? interior.tipoDungeonId ?? "",
    nivel,
    rol: planta.rol,
    ancho, alto, casillas, velocidad,
    spawnX: spawn.x + 0.5, spawnY: spawn.y + 0.5,
    conectores,
    spawnsEnemigos: planta.spawnsEnemigos ?? [],
    salasPorTipo,
    mueblesPorSala,
    salasIndexadas,
    objetosSueltos,
  };
}

/**
 * BFS 4-direcciones (coste uniforme, sin necesidad de Dijkstra) entre dos
 * casillas de la MISMA planta, para que un NPC camine de verdad entre
 * salas de su propio edificio (2026-09-08, GDD_Agentes_Moviles.md "vida en
 * interiores") — NO viola la regla "nada de A* en vivo" de `agentes.ts`
 * (esa regla es sobre el MAPA EXTERIOR, decenas de miles de casillas y
 * cientos de agentes simulados a la vez): un interior tiene, como mucho,
 * unos pocos miles de casillas, y esto solo se llama una vez por NPC
 * cuando su tramo de rutina cambia de objetivo (raro, cada varias horas de
 * juego), nunca en el tick de movimiento. `null` = sin camino real (sala
 * desconectada, no debería pasar tras `garantizarConectividad`, pero un
 * caller no debe asumirlo).
 *
 * Destino SÓLIDO (bug real encontrado probando contra un bake real de
 * `casa_humilde`, no hipotético): una cama es mobiliario grande, así que
 * su propia huella —incluida la casilla de `tileInteraccion`— bloquea el
 * paso en la rejilla de colisión (mismo criterio que cualquier mueble
 * grande, `elementoEsSolido`). El BFS busca camino hasta la casilla
 * TRANSITABLE más cercana al destino real y añade el destino como ÚLTIMO
 * paso "metiéndose" en él — igual que un jugador se tumba en su cama
 * caminando hasta el borde y acostándose encima, no flotando fuera.
 */
export function caminoEntre(
  interior: InteriorCargado,
  origen: { x: number; y: number },
  destino: { x: number; y: number },
): { x: number; y: number }[] | null {
  const { ancho, alto, casillas } = interior;
  // Math.floor, NUNCA Math.round: las posiciones del mundo son SIEMPRE
  // "casilla + 0.5" (centro de la casilla, convención de todo el proyecto)
  // — Math.round(n+0.5) redondea SIEMPRE hacia arriba en JS (Math.round(4.5)
  // === 5), así que recuperaba la casilla de al lado, nunca la real. Bug
  // real encontrado probando contra un spawn real (redondeaba a una
  // casilla sólida vecina y `caminoEntre` fallaba con null siempre).
  const ox = Math.floor(origen.x), oy = Math.floor(origen.y);
  const dx0 = Math.floor(destino.x), dy0 = Math.floor(destino.y);
  if (ox === dx0 && oy === dy0) return [];
  if (casillas[oy * ancho + ox] === TIPO.SOLIDO) return null;
  const destinoIdxReal = dy0 * ancho + dx0;
  const destinoSolido = casillas[destinoIdxReal] === TIPO.SOLIDO;
  // objetivo real del BFS: el propio destino si es transitable, o cualquiera
  // de sus 4 vecinos transitables si no lo es (entrar en la cama desde el
  // borde libre más cercano)
  const objetivos = new Set<number>();
  if (!destinoSolido) objetivos.add(destinoIdxReal);
  else {
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = dx0 + ddx, ny = dy0 + ddy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const nidx = ny * ancho + nx;
      if (casillas[nidx] !== TIPO.SOLIDO) objetivos.add(nidx);
    }
  }
  if (objetivos.size === 0) return null; // mueble rodeado de sólido por todos lados — no hay por dónde entrar

  const visitado = new Uint8Array(ancho * alto);
  const previo = new Int32Array(ancho * alto).fill(-1);
  const origenIdx = oy * ancho + ox;
  visitado[origenIdx] = 1;
  const cola: number[] = [origenIdx];
  let cabeza = 0;
  let alcanzado = -1;
  while (cabeza < cola.length) {
    const idx = cola[cabeza++];
    if (objetivos.has(idx)) { alcanzado = idx; break; }
    const x = idx % ancho, y = Math.floor(idx / ancho);
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ddx, ny = y + ddy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const nidx = ny * ancho + nx;
      if (visitado[nidx] || casillas[nidx] === TIPO.SOLIDO) continue;
      visitado[nidx] = 1;
      previo[nidx] = idx;
      cola.push(nidx);
    }
  }
  if (alcanzado < 0) return null;
  const camino: { x: number; y: number }[] = [];
  let paso = alcanzado;
  while (paso !== origenIdx) {
    camino.push({ x: paso % ancho, y: Math.floor(paso / ancho) });
    paso = previo[paso];
  }
  camino.reverse();
  if (destinoSolido) camino.push({ x: dx0, y: dy0 }); // último paso: entra en el mueble
  return camino;
}

function floodFill(casillas: Uint8Array, ancho: number, alto: number, inicio: { x: number; y: number }): Uint8Array {
  const visitado = new Uint8Array(ancho * alto);
  if (casillas[inicio.y * ancho + inicio.x] === TIPO.SOLIDO) return visitado;
  const cola: [number, number][] = [[inicio.x, inicio.y]];
  visitado[inicio.y * ancho + inicio.x] = 1;
  while (cola.length) {
    const [x, y] = cola.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const idx = ny * ancho + nx;
      if (visitado[idx] || casillas[idx] === TIPO.SOLIDO) continue;
      visitado[idx] = 1;
      cola.push([nx, ny]);
    }
  }
  return visitado;
}

function garantizarConectividad(
  casillas: Uint8Array,
  ancho: number,
  alto: number,
  spawn: { x: number; y: number },
  salas: SalaInterior[],
) {
  for (const sala of salas) {
    const visitado = floodFill(casillas, ancho, alto, spawn);
    const cx = sala.offsetX + Math.floor(sala.resultado.ancho / 2);
    const cy = sala.offsetY + Math.floor(sala.resultado.largo / 2);
    // ¿algún tile de ESTA sala ya es alcanzable? (no solo el centro: el
    // centro puede ser un mueble)
    let yaConectada = false;
    for (let y = sala.offsetY; y < sala.offsetY + sala.resultado.largo && !yaConectada; y++) {
      for (let x = sala.offsetX; x < sala.offsetX + sala.resultado.ancho; x++) {
        if (visitado[y * ancho + x]) { yaConectada = true; break; }
      }
    }
    if (yaConectada) continue;

    // punto alcanzable más cercano al centro de la sala aislada
    let mejor: { x: number; y: number } | null = null;
    let mejorDist = Infinity;
    for (let y = 0; y < alto; y++) {
      for (let x = 0; x < ancho; x++) {
        if (!visitado[y * ancho + x]) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d < mejorDist) { mejorDist = d; mejor = { x, y }; }
      }
    }
    if (!mejor) continue; // nada alcanzable en absoluto (no debería pasar)

    // pasillo recto en L, forzando TIERRA — feo pero garantiza el acceso
    let x = mejor.x, y = mejor.y;
    while (x !== cx) { x += x < cx ? 1 : -1; casillas[y * ancho + x] = TIPO.TIERRA; }
    while (y !== cy) { y += y < cy ? 1 : -1; casillas[y * ancho + x] = TIPO.TIERRA; }
  }
}

function casillaPisableMasCercana(
  casillas: Uint8Array,
  ancho: number,
  alto: number,
  x0: number,
  y0: number,
): { x: number; y: number } {
  const radioMax = Math.max(ancho, alto);
  for (let r = 0; r < radioMax; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
        if (casillas[y * ancho + x] !== TIPO.SOLIDO) return { x, y };
      }
    }
  }
  return { x: x0, y: y0 }; // sala enteramente sólida (no debería pasar): aparece ahí igualmente
}
