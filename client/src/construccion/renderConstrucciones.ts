/**
 * Render de lo CONSTRUIDO por los jugadores (GDD_Construccion §6): mantiene
 * el espejo local de construcciones a partir de los mensajes del protocolo
 * (§4). Caja placeholder inmediata (`colorDebug` del catálogo, huella
 * rotada, cara superior un punto más clara para que la silueta se lea desde
 * la cámara isométrica) — sustituida por el `.glb` real en cuanto
 * `entityLoader` lo resuelve (misma convención `assets/interiores/<objeto>_01.glb`
 * que ya usa `taller-vox/generar_modelos.js` para el mobiliario bakeado de
 * `interiores/`, pedido 2026-09-03: "hicimos bakeador de muebles... para que
 * se usara en estos casos"). Excepción: lo PLANTABLE (bancal/maceta) se
 * queda SIEMPRE con la caja de dos tonos — `tintarSuelo()` pinta agua/
 * fertilizante en su cara superior, y un modelo real no tiene ahí ningún
 * hueco que teñir.
 *
 * También sirve de ESPEJO de ocupación para el fantasma del constructor:
 * casillas ocupadas (clave numérica y*anchoMapa+x) y conteo por propiedad
 * para el topeProps — feedback instantáneo; la verdad final es del servidor.
 */
import * as THREE from "three";
import type { WorldScene } from "../render3d/worldScene";
import { obtenerConstruible, huellaRotada, ALTURA_CATEGORIA, type CategoriaConstruible } from "./catalogoConstruccion";
import { obtenerPlantilla } from "../render3d/entityLoader";
import type { CategoriaAsset } from "../render3d/assetCatalog";
import itemsJson from "../../../items/catalogo/items.json";

// Solo color y huella de inventario: es lo único que hace falta para dibujar
// un ítem EXPUESTO sobre una estantería/vitrina/maniquí como un prop pequeño
// (docs/GDD_Construccion.md §9) hasta que carga su .glb real (§9.7).
const ITEMS = itemsJson as unknown as Record<string, { colorDebug?: string; huella?: [number, number]; tipo?: string }>;

/** Luz de una lámpara/candelabro colocado por un jugador (`capa:"iluminacion"`) — misma tonalidad cálida que las lámparas bakeadas de `interiorVisual.ts`. */
const COLOR_LUZ_MUEBLE = 0xffb066;
const INTENSIDAD_LUZ_MUEBLE = 1.1;
const ALCANCE_LUZ_MUEBLE = 6;
/** Altura de la luz sobre el suelo — un candelabro de pie/araña ilumina desde arriba del mueble, no desde su base. */
const ALTURA_LUZ_MUEBLE = 1.4;

/** Mensaje "construccion:nueva" / entrada de "construcciones:lista" (contrato §4). */
export interface ConstruccionRed {
  id: number;
  propiedad: string;
  objeto: string;
  categoria: CategoriaConstruible;
  x: number; // casilla global de la esquina noroeste de la huella YA rotada
  y: number;
  rot: number;
  variante: number;
  /** Expositores (docs/GDD_Construccion.md §9): itemIds del contenido a dibujar encima — solo viene en muebles `expositor`; el servidor lo refresca con `construccion:expuestos`. */
  expuestos?: string[];
}

// Id llegado del servidor que no está en los catálogos del bundle (cliente
// desfasado): caja magenta 1x1 para que cante, nunca un crash.
const COLOR_DESCONOCIDO = "#b05ad8";

export class RenderConstrucciones {
  // `esPropia`: true = geometría/material creados aquí (placeholder box),
  // hay que dispose-arlos al quitar la pieza. false = clon de la plantilla
  // .glb compartida de `entityLoader` (misma cache que vegetación/rocas/
  // interiores bakeados) — dispose-arla rompería el resto de instancias
  // vivas de ese mismo modelo, solo se quita de la escena (gratis).
  private readonly piezas = new Map<number, { datos: ConstruccionRed; malla: THREE.Object3D; esPropia: boolean }>();
  private readonly ocupadas = new Set<number>();
  // Mobiliario del carpintero (docs/GDD_Construccion.md §9): luz real de
  // lámparas/candelabros colocados y props de lo expuesto en estanterías/
  // vitrinas/maniquíes — viven APARTE de la malla del mueble porque esa malla
  // se sustituye por el .glb real cuando carga (sustituirPorModeloRealSiExiste)
  // y no queremos perderlos ni recrearlos en ese momento.
  private readonly luces = new Map<number, THREE.PointLight>();
  private readonly expuestos = new Map<number, { itemIds: string[]; grupo: THREE.Group; version: number }>();
  private versionExpuestos = 0;

  constructor(
    private readonly escena: WorldScene,
    private readonly anchoMapa: number,
  ) {}

  /** "construcciones:lista" al entrar: estado completo (sustituye lo que hubiera). */
  aplicarLista(lista: ConstruccionRed[]): void {
    for (const id of [...this.piezas.keys()]) this.aplicarQuitada(id);
    for (const c of lista) this.aplicarNueva(c);
  }

  /** "construccion:nueva": alguien (quizá yo) colocó algo — el broadcast es la confirmación. */
  aplicarNueva(c: ConstruccionRed): void {
    if (this.piezas.has(c.id)) this.aplicarQuitada(c.id); // reenvío defensivo: no duplicar mallas
    const malla = this.crearMallaPlaceholder(c);
    this.piezas.set(c.id, { datos: c, malla, esPropia: true });
    this.escena.añadirEstatico(malla);
    for (const clave of this.clavesHuella(c)) this.ocupadas.add(clave);

    const construible = obtenerConstruible(c.objeto);
    if (construible?.iluminacion) this.encenderLuz(c);
    if (c.expuestos) this.actualizarExpuestos(c.id, c.expuestos);
    if (!construible?.plantable) void this.sustituirPorModeloRealSiExiste(c, malla);
  }

  /** "construccion:quitada": recogida por su dueño — fuera de escena con dispose real. */
  aplicarQuitada(id: number): void {
    const pieza = this.piezas.get(id);
    if (!pieza) return;
    this.piezas.delete(id);
    for (const clave of this.clavesHuella(pieza.datos)) this.ocupadas.delete(clave);
    this.escena.quitarEstatico(pieza.malla);
    if (pieza.esPropia) this.disposeMallaPropia(pieza.malla as THREE.Mesh);
    const luz = this.luces.get(id);
    if (luz) { this.escena.quitarEstatico(luz); luz.dispose(); this.luces.delete(id); }
    this.quitarExpuestos(id);
  }

  /** Lámpara/candelabro colocado (docs/GDD_Construccion.md §9): una luz puntual cálida sobre el centro de su huella — coste acotado, son unas pocas por parcela, nunca una por prop del mapa. */
  private encenderLuz(c: ConstruccionRed): void {
    const construible = obtenerConstruible(c.objeto);
    const [w, h] = construible ? huellaRotada(construible.huella, c.rot) : [1, 1];
    const luz = new THREE.PointLight(COLOR_LUZ_MUEBLE, INTENSIDAD_LUZ_MUEBLE, ALCANCE_LUZ_MUEBLE, 2);
    luz.position.set(c.x + w / 2, ALTURA_LUZ_MUEBLE, c.y + h / 2);
    luz.castShadow = false;
    this.escena.añadirEstatico(luz);
    this.luces.set(c.id, luz);
  }

  /**
   * "construccion:expuestos" (y el campo `expuestos` de nueva/lista): dibuja
   * el contenido de un expositor como props pequeños sobre la tapa del
   * mueble. Cada ítem sale al instante como una caja de su color de catálogo
   * (feedback inmediato, igual que la caja placeholder del propio mueble) y
   * se sustituye por su `.glb` real en cuanto carga (§9.7: armas de
   * `assets/armas/`, herramientas de `assets/herramientas/`, el resto de
   * `assets/objetos/` — `taller-vox/generar_objetos.js`); si no existe
   * modelo para ese id, la caja se queda para siempre, nunca rompe nada.
   * Puramente visual: la rejilla real sigue en el panel del cofre.
   */
  actualizarExpuestos(construccionId: number, itemIds: string[]): void {
    this.quitarExpuestos(construccionId);
    const pieza = this.piezas.get(construccionId);
    if (!pieza || itemIds.length === 0) return;
    const c = pieza.datos;
    pieza.datos = { ...c, expuestos: itemIds };
    const construible = obtenerConstruible(c.objeto);
    const [w, h] = construible ? huellaRotada(construible.huella, c.rot) : [1, 1];
    // la tapa real del mueble: caja placeholder o .glb, lo que haya ahora mismo
    const caja = new THREE.Box3().setFromObject(pieza.malla);
    const topY = Number.isFinite(caja.max.y) ? caja.max.y : ALTURA_CATEGORIA[c.categoria] ?? 0.8;

    const grupo = new THREE.Group();
    // Versión por refresco: un .glb que termine de cargar DESPUÉS de que el
    // expositor se haya vuelto a dibujar (otro ítem metido/sacado, o el
    // mueble sustituido por su modelo real) no debe colarse en el grupo viejo.
    const version = ++this.versionExpuestos;
    this.expuestos.set(construccionId, { itemIds, grupo, version });
    this.escena.añadirEstatico(grupo);
    const columnas = Math.max(1, Math.min(itemIds.length, Math.round(w * 4)));
    const filas = Math.ceil(itemIds.length / columnas);
    const pasoX = w / (columnas + 1);
    const pasoZ = h / (filas + 1);
    const margenSuperior = 0.02;
    itemIds.forEach((itemId, i) => {
      const entrada = ITEMS[itemId];
      const alargado = (entrada?.huella?.[1] ?? 1) >= 2; // espadas/hachas/lanzas de pie
      const ancho = Math.min(0.16, pasoX * 0.7);
      const alto = alargado ? 0.55 : 0.18;
      const fondo = Math.min(0.16, pasoZ * 0.7);
      const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(entrada?.colorDebug || COLOR_DESCONOCIDO), roughness: 0.7, metalness: entrada?.tipo === "arma" ? 0.4 : 0 });
      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(ancho, alto, fondo), material);
      const col = i % columnas, fila = Math.floor(i / columnas);
      const px = c.x + pasoX * (col + 1);
      const pz = c.y + pasoZ * (fila + 1);
      placeholder.position.set(px, topY + margenSuperior + alto / 2, pz);
      placeholder.castShadow = false;
      placeholder.receiveShadow = true;
      placeholder.userData.construccionId = c.id; // clic sobre un prop = clic sobre el mueble
      // geometría/material creados aquí → se disponen al quitar (los clones
      // del .glb comparten la plantilla cacheada y NUNCA se disponen)
      placeholder.userData.propioDelSector = true;
      grupo.add(placeholder);
      void this.sustituirPropExpuesto(construccionId, version, grupo, placeholder, itemId, entrada, {
        px, pz, topY: topY + margenSuperior,
        anchoMax: Math.min(0.3, pasoX * 0.85),
        fondoMax: Math.min(0.3, pasoZ * 0.85),
        alargado,
      });
    });
  }

  /**
   * Cambia la caja de color de UN ítem expuesto por su `.glb` real (§9.7).
   * Escala por caja delimitadora para que cualquier modelo quepa en el hueco
   * que le toca sobre la tapa (~0.25 casillas), apoyado por su base; las
   * armas/herramientas (huella alargada) pueden subir más — quedan de pie
   * contra el panel, el resto tumbado/pequeño.
   */
  private async sustituirPropExpuesto(
    construccionId: number,
    version: number,
    grupo: THREE.Group,
    placeholder: THREE.Mesh,
    itemId: string,
    entrada: { tipo?: string } | undefined,
    sitio: { px: number; pz: number; topY: number; anchoMax: number; fondoMax: number; alargado: boolean },
  ): Promise<void> {
    const categoria: CategoriaAsset = entrada?.tipo === "arma" ? "armas" : entrada?.tipo === "herramienta" ? "herramientas" : "objetos";
    const plantilla = await obtenerPlantilla(categoria, itemId, { tipo: "numerada", indice: 0 });
    if (!plantilla) return; // sin modelo para este id: se queda la caja
    const vivo = this.expuestos.get(construccionId);
    if (!vivo || vivo.version !== version || placeholder.parent !== grupo) return; // el expositor se redibujó mientras cargaba

    const instancia = plantilla.clone(true);
    const caja = new THREE.Box3().setFromObject(instancia);
    const tam = new THREE.Vector3();
    caja.getSize(tam);
    if (!(tam.x > 0 && tam.y > 0 && tam.z > 0)) return;
    const altoMax = sitio.alargado ? 0.6 : 0.28;
    const escala = Math.min(sitio.anchoMax / tam.x, sitio.fondoMax / tam.z, altoMax / tam.y);
    instancia.scale.setScalar(escala);
    const centro = new THREE.Vector3();
    caja.getCenter(centro);
    // centrado en XZ sobre el hueco y apoyado por su base sobre la tapa
    instancia.position.set(sitio.px - centro.x * escala, sitio.topY - caja.min.y * escala, sitio.pz - centro.z * escala);
    instancia.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = true;
      o.userData.construccionId = construccionId;
    });
    instancia.userData.propioDelSector = false;

    grupo.remove(placeholder);
    this.disposeMallaPropia(placeholder);
    grupo.add(instancia);
  }

  /** Sonda de test: itemIds dibujados ahora mismo sobre un expositor, cuántos props tiene su grupo y cuántos de ellos ya son el `.glb` real (no la caja de color). */
  expuestosVisibles(construccionId: number): { itemIds: string[]; props: number; conModelo: number } | null {
    const e = this.expuestos.get(construccionId);
    if (!e) return null;
    const conModelo = e.grupo.children.filter((h) => !h.userData.propioDelSector).length;
    return { itemIds: [...e.itemIds], props: e.grupo.children.length, conModelo };
  }

  /** Sonda de test: ¿esta construcción tiene una luz real encendida (lámpara/candelabro colocado)? */
  tieneLuz(construccionId: number): boolean {
    return this.luces.has(construccionId);
  }

  private quitarExpuestos(construccionId: number): void {
    const actual = this.expuestos.get(construccionId);
    if (!actual) return;
    this.expuestos.delete(construccionId);
    this.escena.quitarEstatico(actual.grupo);
    for (const hijo of actual.grupo.children) {
      // solo las cajas de color son nuestras; un clon del .glb comparte
      // geometría/material con la plantilla cacheada de entityLoader
      if (hijo.userData.propioDelSector) this.disposeMallaPropia(hijo as THREE.Mesh);
    }
  }

  private disposeMallaPropia(malla: THREE.Mesh): void {
    malla.geometry.dispose();
    const materiales = Array.isArray(malla.material) ? malla.material : [malla.material];
    // el material de lados se repite en el array: dispose es idempotente
    for (const m of materiales) m.dispose();
  }

  /** Sustituye la caja placeholder por el `.glb` real en cuanto `entityLoader` lo resuelve — no-op si ya no existe o ya se reemplazó mientras cargaba (mismo criterio "referencia exacta" que evita una condición de carrera con un `aplicarQuitada`/reenvío de por medio). */
  private async sustituirPorModeloRealSiExiste(c: ConstruccionRed, placeholder: THREE.Object3D): Promise<void> {
    const plantilla = await obtenerPlantilla("interiores", c.objeto, { tipo: "numerada", indice: 0 });
    if (!plantilla) return; // sin .glb todavía (taller-vox pendiente para este id) — se queda la caja
    const actual = this.piezas.get(c.id);
    if (!actual || actual.malla !== placeholder) return;

    const construible = obtenerConstruible(c.objeto);
    const [w, h] = construible ? huellaRotada(construible.huella, c.rot) : [1, 1];
    const instancia = plantilla.clone(true);
    // Centrada en la misma huella YA rotada que ocupa la caja (mismo
    // convenio de posición que el servidor: x,y = esquina noroeste de esa
    // huella) — el modelo, a diferencia de la caja, sí tiene una cara
    // "de frente" real, así que además se gira físicamente.
    instancia.position.set(c.x + w / 2, 0, c.y + h / 2);
    // rot server: 0..3, pasos de 90° horario (huellaRotada). Sin ninguna
    // construcción rotada todavía en la Test Zone para verificar el
    // sentido a ojo — si un mueble real sale "mirando" al revés al probar
    // uno con rot!=0, invertir el signo aquí.
    instancia.rotation.y = -THREE.MathUtils.degToRad(c.rot * 90);
    instancia.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    instancia.userData.construccionId = c.id;

    this.escena.quitarEstatico(placeholder);
    this.disposeMallaPropia(placeholder as THREE.Mesh);
    this.escena.añadirEstatico(instancia);
    this.piezas.set(c.id, { datos: actual.datos, malla: instancia, esPropia: false });
    // los props expuestos se apoyaban en la tapa de la caja placeholder —
    // el .glb real tiene otra altura, se recolocan sobre la nueva tapa
    const expuestos = this.expuestos.get(c.id);
    if (expuestos) this.actualizarExpuestos(c.id, expuestos.itemIds);
  }

  /** ¿Hay ya una construcción pisando esta casilla? (para el fantasma). */
  ocupada(x: number, y: number): boolean {
    return this.ocupadas.has(y * this.anchoMapa + x);
  }

  /** Datos crudos (x,y,rot,objeto...) de una construcción por id — p.ej. para calcular la posición de un asiento (docs/GDD_Mesas_Minijuego.md). */
  datosDe(id: number): ConstruccionRed | undefined {
    return this.piezas.get(id)?.datos;
  }

  /** ids de TODAS las construcciones vivas de un `objeto` de catálogo exacto — p.ej. para que un test ubique la mesa_ajedrez recién colocada sin adivinar su id. */
  idsDeObjeto(objeto: string): number[] {
    const ids: number[] = [];
    for (const { datos } of this.piezas.values()) if (datos.objeto === objeto) ids.push(datos.id);
    return ids;
  }

  /** Construcciones vivas en una propiedad (para el espejo del topeProps). */
  contarPorPropiedad(propiedadId: string): number {
    let n = 0;
    for (const { datos } of this.piezas.values()) if (datos.propiedad === propiedadId) n++;
    return n;
  }

  /** ¿Ya hay una construcción viva con este `objeto` de catálogo? Espejo local del tope "uno por asentamiento" de los proyectos especiales del jarl (colocadorPlantillas.ts) — la verdad final la decide el servidor. */
  existeObjeto(objeto: string): boolean {
    for (const { datos } of this.piezas.values()) if (datos.objeto === objeto) return true;
    return false;
  }

  cantidad(): number {
    return this.piezas.size;
  }

  /** Todas las mallas de construcciones vivas — para raycasting de clic sobre objeto (menuInteraccion.ts, docs/GDD_Instrumentos.md). */
  mallas(): THREE.Object3D[] {
    return [...this.piezas.values()].map((p) => p.malla);
  }

  /** Datos de catálogo/red de la construcción dueña de esta malla (o de un hijo suyo), o null si no es ninguna de las nuestras — mismo `userData.construccionId` marcado en crearMalla. */
  datosDeMalla(objeto: THREE.Object3D | null): ConstruccionRed | null {
    let o: THREE.Object3D | null = objeto;
    while (o) {
      if (typeof o.userData.construccionId === "number") {
        return this.piezas.get(o.userData.construccionId)?.datos ?? null;
      }
      o = o.parent;
    }
    return null;
  }

  /** Agricultura (docs/GDD_Agricultura.md): tiñe la tapa de un bancal/maceta según agua/fertilizante 0-100 — oscuro = buen suelo, marrón clarito = seco/pobre. No-op si la pieza no existe (ya se quitó, o el jugador está en otro mapa). */
  tintarSuelo(construccionId: number, agua: number, fertilizante: number, tierra = 0, tierraNecesaria = 0): void {
    const pieza = this.piezas.get(construccionId);
    if (!pieza) return;
    const nivel = Math.max(0, Math.min(1, (agua + fertilizante) / 200));
    const oscuro = new THREE.Color("#241a10");
    const claro = new THREE.Color("#c9b48a");
    // §9: una maceta sin su tierra se ve VACÍA (gris del recipiente), nunca
    // como suelo seco — así se distingue "falta tierra" de "falta regar".
    const color = tierraNecesaria > 0 && tierra < tierraNecesaria ? new THREE.Color("#9a9088") : claro.clone().lerp(oscuro, nivel);
    // Siempre la caja de dos tonos (lo plantable nunca se sustituye por
    // .glb real, ver aplicarNueva) — el cast es seguro.
    const materiales = (pieza.malla as THREE.Mesh).material as THREE.MeshStandardMaterial[];
    materiales[2].color.copy(color); // índice 2 = tapa (mismo orden que crearMallaPlaceholder)
  }

  /** Construcción PLANTABLE más cercana a (x,y) dentro de `radio` — mismo criterio "sin UI de targeting" que coger/portal:usar. */
  plantableMasCercana(x: number, y: number, radio: number): number | null {
    return this.masCercanaDeObjeto((datos) => !!obtenerConstruible(datos.objeto)?.plantable, x, y, radio);
  }

  /** Asiento genérico (silla/banco/taburete/mecedora/sofa/trono, docs/GDD_Personaje.md §3.6bis) más cercano a (x,y) — mismo criterio que `plantableMasCercana`. No filtra por ocupado: el servidor es quien lo rechaza si ya hay alguien sentado. */
  asientoMasCercano(x: number, y: number, radio: number): number | null {
    return this.masCercanaDeObjeto((datos) => !!obtenerConstruible(datos.objeto)?.esAsiento, x, y, radio);
  }

  /** Construcción con este `objeto` de catálogo exacto más cercana a (x,y) dentro de `radio` (p.ej. "mesa_injertos") — mismo criterio de auto-apuntado por proximidad. */
  deObjetoMasCercana(objeto: string, x: number, y: number, radio: number): number | null {
    return this.masCercanaDeObjeto((datos) => datos.objeto === objeto, x, y, radio);
  }

  /** Cocina (docs/GDD_Cocina.md) — la estación de cocina (hoguera o vasija) más cercana, con su metadata de catálogo ya resuelta para que el cliente sepa qué UI mostrar sin una segunda consulta. */
  cocinaMasCercana(x: number, y: number, radio: number): { id: number; cocina: NonNullable<ReturnType<typeof obtenerConstruible>>["cocina"] } | null {
    const id = this.masCercanaDeObjeto((datos) => !!obtenerConstruible(datos.objeto)?.cocina, x, y, radio);
    if (id == null) return null;
    const pieza = this.piezas.get(id);
    const cocina = pieza && obtenerConstruible(pieza.datos.objeto)?.cocina;
    return cocina ? { id, cocina } : null;
  }

  /** Cualquier construcción viva más cercana, sin filtrar por objeto — usado por el panel del reclutador (docs/GDD_NPCs_Contratables.md) para "asignar la mesa a la que estoy pegado" sin que el jugador tenga que escribir un id a mano. */
  masCercanaCualquiera(x: number, y: number, radio: number): number | null {
    return this.masCercanaDeObjeto(() => true, x, y, radio);
  }

  private masCercanaDeObjeto(filtro: (datos: ConstruccionRed) => boolean, x: number, y: number, radio: number): number | null {
    let mejorId: number | null = null;
    let mejorDist = radio;
    for (const { datos, malla } of this.piezas.values()) {
      if (!filtro(datos)) continue;
      const d = Math.hypot(malla.position.x - x, malla.position.z - y);
      if (d < mejorDist) { mejorDist = d; mejorId = datos.id; }
    }
    return mejorId;
  }

  private clavesHuella(c: ConstruccionRed): number[] {
    const construible = obtenerConstruible(c.objeto);
    const [w, h] = construible ? huellaRotada(construible.huella, c.rot) : [1, 1];
    const claves: number[] = [];
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) claves.push((c.y + dy) * this.anchoMapa + (c.x + dx));
    return claves;
  }

  private crearMallaPlaceholder(c: ConstruccionRed): THREE.Mesh {
    const construible = obtenerConstruible(c.objeto);
    const [w, h] = construible ? huellaRotada(construible.huella, c.rot) : [1, 1];
    const altura = ALTURA_CATEGORIA[c.categoria] ?? 0.8;
    const color = new THREE.Color(construible?.colorDebug || COLOR_DESCONOCIDO);

    const lados = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
    const tapa = new THREE.MeshStandardMaterial({
      color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.22),
      roughness: 0.9,
      metalness: 0,
    });
    // BoxGeometry agrupa caras en orden +x,-x,+y,-y,+z,-z: la tapa es el índice 2
    const malla = new THREE.Mesh(new THREE.BoxGeometry(w, altura, h), [lados, lados, tapa, lados, lados, lados]);
    // anclada por su esquina noroeste en (x, y) casillas — el centro de la
    // caja queda a media huella (mismo convenio que valida el servidor)
    malla.position.set(c.x + w / 2, altura / 2, c.y + h / 2);
    malla.castShadow = true;
    malla.receiveShadow = true;
    malla.userData.construccionId = c.id; // para el raycasting de clic (menuInteraccion.ts)
    return malla;
  }
}
