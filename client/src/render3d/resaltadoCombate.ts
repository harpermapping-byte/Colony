import * as THREE from "three";

/**
 * Resaltado de la casilla táctica ocupada por cada combatiente (pedido
 * streamer 2026-09-06: "el player o los npc deben estar en el centro de la
 * casilla, y la casilla debe tener un colorcito o un tono diferente para
 * que se sepa en qué casilla está") — un plano de color por unidad ACTIVA,
 * sobre la rejilla ya dibujada por `sectorVisual.ts::crearRejillaTactica`
 * (y=0.02) pero por debajo de cualquier pie/objeto real. Solo tiene sentido
 * en la arena dedicada (`ArenaCombateRoom`, la única donde se dibuja esa
 * rejilla — `margenVisual>0` en `sectorVisual.ts`); en combate "en el
 * sitio" (mundo abierto/mazmorra) no hay ninguna rejilla que resaltar.
 */

const ALTURA_PLANO = 0.025;
const LADO_PLANO = 0.94; // ligeramente menor que 1 casilla, así se sigue viendo la línea de rejilla alrededor
const COLOR_BANDO_A = 0x4a90d9; // mi bando (jugador/aliados/compañero) — azulado
const COLOR_BANDO_B = 0xd94a4a; // bando contrario — rojizo

interface UnidadCombateVista {
  id: string;
  bando: string;
  gx: number;
  gy: number;
  estado: string;
}

interface CombateVista {
  gx0: number;
  gy0: number;
  unidades: { values(): IterableIterator<UnidadCombateVista> };
}

function crearPlano(): THREE.Mesh {
  const geometria = new THREE.PlaneGeometry(LADO_PLANO, LADO_PLANO);
  // depthTest:false a propósito — confirmado con un probe real en el
  // renderer de este proyecto (cámara ortográfica + WebGL software bajo
  // Playwright) que un decal CASI coplanar con el suelo (y=0.025 sobre
  // y=0) pierde el test de profundidad casi en todo su área contra el
  // propio plano de suelo (solo un borde de pocos píxeles sobrevivía) —
  // ni subir la altura a 0.3 ni un polygonOffset moderado lo arreglaban de
  // verdad. Mismo criterio que el cursor de casilla de cualquier táctico
  // por turnos (XCOM, Fire Emblem...): la marca de "aquí está la unidad"
  // se ve SIEMPRE encima del suelo, sin depender de si el motor decide que
  // el suelo gana el z-test ese frame.
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, depthTest: false });
  const malla = new THREE.Mesh(geometria, material);
  malla.rotation.x = -Math.PI / 2;
  malla.renderOrder = 5; // por encima de la rejilla táctica y del suelo, sea cual sea el orden de inserción real
  return malla;
}

export class ResaltadoCombate {
  private readonly grupo = new THREE.Group();
  private readonly planosPorUnidad = new Map<string, THREE.Mesh>();

  constructor(escena: { añadirEstatico(objeto: THREE.Object3D): void }) {
    escena.añadirEstatico(this.grupo);
  }

  /** Reconcilia un plano por unidad ACTIVA — crea/mueve/recolorea el que haga falta, quita los que ya no correspondan. Llamar en cada cambio de estado del combate (mismo criterio que `actualizarPanelCombate`). */
  actualizar(combate: CombateVista | undefined): void {
    if (!combate) return this.limpiar();
    const vistos = new Set<string>();
    for (const u of combate.unidades.values()) {
      if (u.estado !== "activo") continue;
      vistos.add(u.id);
      let plano = this.planosPorUnidad.get(u.id);
      if (!plano) {
        plano = crearPlano();
        this.planosPorUnidad.set(u.id, plano);
        this.grupo.add(plano);
      }
      plano.position.set(combate.gx0 + u.gx + 0.5, ALTURA_PLANO, combate.gy0 + u.gy + 0.5);
      (plano.material as THREE.MeshBasicMaterial).color.setHex(u.bando === "A" ? COLOR_BANDO_A : COLOR_BANDO_B);
    }
    for (const [id, plano] of this.planosPorUnidad) {
      if (vistos.has(id)) continue;
      this.grupo.remove(plano);
      plano.geometry.dispose();
      (plano.material as THREE.Material).dispose();
      this.planosPorUnidad.delete(id);
    }
  }

  /** Quita todos los planos — llamar al salir de la arena/combate. */
  limpiar(): void {
    for (const plano of this.planosPorUnidad.values()) {
      this.grupo.remove(plano);
      plano.geometry.dispose();
      (plano.material as THREE.Material).dispose();
    }
    this.planosPorUnidad.clear();
  }
}
