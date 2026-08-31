/**
 * Render de lo CONSTRUIDO por los jugadores (GDD_Construccion §6): mantiene
 * el espejo local de construcciones a partir de los mensajes del protocolo
 * (§4) y una caja placeholder por construcción — `colorDebug` del catálogo,
 * huella rotada, cara superior un punto más clara para que la silueta se
 * lea desde la cámara isométrica. El `.glb` real entrará por `entityLoader`
 * (misma convención de assets) sin tocar este flujo.
 *
 * También sirve de ESPEJO de ocupación para el fantasma del constructor:
 * casillas ocupadas (clave numérica y*anchoMapa+x) y conteo por propiedad
 * para el topeProps — feedback instantáneo; la verdad final es del servidor.
 */
import * as THREE from "three";
import type { WorldScene } from "../render3d/worldScene";
import { obtenerConstruible, huellaRotada, ALTURA_CATEGORIA, type CategoriaConstruible } from "./catalogoConstruccion";

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
  private readonly piezas = new Map<number, { datos: ConstruccionRed; malla: THREE.Mesh }>();
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
    const malla = this.crearMalla(c);
    this.piezas.set(c.id, { datos: c, malla });
    this.escena.añadirEstatico(malla);
    for (const clave of this.clavesHuella(c)) this.ocupadas.add(clave);
  }

  /** "construccion:quitada": recogida por su dueño — fuera de escena con dispose real. */
  aplicarQuitada(id: number): void {
    const pieza = this.piezas.get(id);
    if (!pieza) return;
    this.piezas.delete(id);
    for (const clave of this.clavesHuella(pieza.datos)) this.ocupadas.delete(clave);
    this.escena.quitarEstatico(pieza.malla);
    pieza.malla.geometry.dispose();
    const materiales = Array.isArray(pieza.malla.material) ? pieza.malla.material : [pieza.malla.material];
    // el material de lados se repite en el array: dispose es idempotente
    for (const m of materiales) m.dispose();
  }

  /** ¿Hay ya una construcción pisando esta casilla? (para el fantasma). */
  ocupada(x: number, y: number): boolean {
    return this.ocupadas.has(y * this.anchoMapa + x);
  }

  /** Construcciones vivas en una propiedad (para el espejo del topeProps). */
  contarPorPropiedad(propiedadId: string): number {
    let n = 0;
    for (const { datos } of this.piezas.values()) if (datos.propiedad === propiedadId) n++;
    return n;
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
    const materiales = pieza.malla.material as THREE.MeshStandardMaterial[];
    materiales[2].color.copy(color); // índice 2 = tapa (mismo orden que crearMalla)
  }

  /** Construcción PLANTABLE más cercana a (x,y) dentro de `radio` — mismo criterio "sin UI de targeting" que coger/portal:usar. */
  plantableMasCercana(x: number, y: number, radio: number): number | null {
    return this.masCercanaDeObjeto((datos) => !!obtenerConstruible(datos.objeto)?.plantable, x, y, radio);
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

  private crearMalla(c: ConstruccionRed): THREE.Mesh {
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
