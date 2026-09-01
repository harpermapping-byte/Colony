/**
 * Render de objetos físicos sueltos en el mundo (`state.objetosMundo`,
 * docs/GDD_Ganaderia.md §12) — el mismo `ObjetoMundoSchema` que ya usa el
 * servidor para soltar manualmente, el overflow de pociones/crafteo/loot de
 * cadáver y, desde la ampliación de ganadería, los huevos puestos por
 * gallinas/ocas. Hasta esta pasada el cliente no pintaba NADA de esto — ni
 * un solo objeto soltado del juego tenía malla, en ningún flujo — así que
 * esto no es solo "el render de los huevos", es el render GENÉRICO que le
 * faltaba a `objetosMundo` entero. Mismo patrón EXACTO que
 * `construccion/renderConstrucciones.ts` (Map local + añadirEstatico/
 * quitarEstatico + `mallas()`/`datosDeMalla()` para el raycast de clic de
 * `menuInteraccion.ts`), pero sin huella/rotación: un objeto suelto es
 * siempre 1x1, caja pequeña `colorDebug` del catálogo de items.
 */
import * as THREE from "three";
import type { WorldScene } from "../render3d/worldScene";
import { crearPlaceholder } from "../render3d/placeholder";
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItemObjetoMundo {
  nombre?: string;
  colorDebug?: string;
}
const ITEMS: Record<string, EntradaItemObjetoMundo> = itemsJson as unknown as Record<string, EntradaItemObjetoMundo>;

/** Entrada de `state.objetosMundo` (`ObjetoMundoSchema`, HubState.ts) — id = clave del MapSchema. */
export interface ObjetoMundoRed {
  id: string;
  x: number;
  y: number;
  itemId: string;
  cantidad: number;
}

// Mismo criterio que renderConstrucciones: id de catálogo que el cliente no
// reconoce (desfase de build) -> caja magenta que cante, nunca un crash.
const COLOR_DESCONOCIDO = "#b05ad8";
// Pequeño a propósito: un objeto suelto no debe leerse como mueble/construcción.
const TAMANO = 0.35;

export class RenderObjetosMundo {
  private readonly piezas = new Map<string, { datos: ObjetoMundoRed; malla: THREE.Object3D }>();

  constructor(private readonly escena: WorldScene) {}

  aplicarNueva(o: ObjetoMundoRed): void {
    if (this.piezas.has(o.id)) this.aplicarQuitada(o.id); // reenvío defensivo, mismo criterio que renderConstrucciones
    const malla = this.crearMalla(o);
    this.piezas.set(o.id, { datos: o, malla });
    this.escena.añadirEstatico(malla);
  }

  aplicarQuitada(id: string): void {
    const pieza = this.piezas.get(id);
    if (!pieza) return;
    this.piezas.delete(id);
    this.escena.quitarEstatico(pieza.malla);
    const malla = pieza.malla as THREE.Mesh;
    malla.geometry?.dispose();
    const material = malla.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
  }

  /** Nombre legible del ítem (catálogo `items.json`, ya trae `nombre` calculado — CLAUDE.md §2) para el menú de interacción. */
  nombreDe(itemId: string): string {
    return ITEMS[itemId]?.nombre ?? itemId;
  }

  /** Todas las mallas de objetos sueltos vivos — se combinan con `RenderConstrucciones.mallas()` en el mismo raycast de clic (game.ts). */
  mallas(): THREE.Object3D[] {
    return [...this.piezas.values()].map((p) => p.malla);
  }

  /** Datos del objeto suelto dueño de esta malla, o null si no es uno de los nuestros — mismo `userData` + recorrido hacia arriba que `RenderConstrucciones.datosDeMalla`. */
  datosDeMalla(objeto: THREE.Object3D | null): ObjetoMundoRed | null {
    let o: THREE.Object3D | null = objeto;
    while (o) {
      if (typeof o.userData.objetoMundoId === "string") {
        return this.piezas.get(o.userData.objetoMundoId)?.datos ?? null;
      }
      o = o.parent;
    }
    return null;
  }

  private crearMalla(o: ObjetoMundoRed): THREE.Object3D {
    const color = ITEMS[o.itemId]?.colorDebug ?? COLOR_DESCONOCIDO;
    // crearPlaceholder ya ancla por la base (y = alto/2) — solo hace falta
    // situar la casilla (x,z), no volver a sumar media altura.
    const malla = crearPlaceholder(color, TAMANO, TAMANO, TAMANO);
    malla.position.x = o.x;
    malla.position.z = o.y;
    malla.userData.objetoMundoId = o.id; // para el raycasting de clic (menuInteraccion.ts)
    return malla;
  }
}
