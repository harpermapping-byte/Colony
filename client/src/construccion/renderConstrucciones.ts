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
    this.piezas.set(c.id, { datos: c, malla: instancia, esPropia: false });
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
  tintarSuelo(construccionId: number, agua: number, fertilizante: number): void {
    const pieza = this.piezas.get(construccionId);
    if (!pieza) return;
    const nivel = Math.max(0, Math.min(1, (agua + fertilizante) / 200));
    const oscuro = new THREE.Color("#241a10");
    const claro = new THREE.Color("#c9b48a");
    const color = claro.clone().lerp(oscuro, nivel);
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
