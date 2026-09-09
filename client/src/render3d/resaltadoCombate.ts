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

const ALTURA_PLANO = 0.05;
const LADO_PLANO = 0.94; // ligeramente menor que 1 casilla, así se sigue viendo la línea de rejilla alrededor
const COLOR_BANDO_A = 0x4a90d9; // mi bando (jugador/aliados/compañero) — azulado
const COLOR_BANDO_B = 0xd94a4a; // bando contrario — rojizo
// Casillas alcanzables con el PA actual (pedido streamer 2026-09-09:
// "saldrian en verde... segun PA" — antes solo te enterabas de que una
// casilla no era alcanzable por el rechazo del servidor TRAS clicar).
// Opacidad más baja que las de unidad (0.4): son muchas a la vez y no deben
// competir visualmente con quién está en qué casilla, que es la info más
// importante.
const COLOR_ALCANZABLE = 0x5ad96a;
const OPACIDAD_ALCANZABLE = 0.22;

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

function crearPlano(opacidad = 0.4): THREE.Mesh {
  const geometria = new THREE.PlaneGeometry(LADO_PLANO, LADO_PLANO);
  // BUG REAL corregido 2026-09-06 (pedido streamer: "el jugador debe verse
  // por encima del cuadro de color") — el primer intento usaba
  // `depthTest:false` para ganar SIEMPRE al suelo (un decal casi coplanar,
  // y=0.025 sobre y=0, perdía el z-test casi en toda su área bajo el
  // renderer de este proyecto) pero eso lo hacía pintarse encima de
  // CUALQUIER cosa, jugador incluido, en vez de solo encima del suelo — el
  // propio jugador quedaba tapado por su propia casilla resaltada.
  // Arreglo real: `depthTest:true` (para que la geometría de verdad más
  // cercana a cámara, como el jugador, siga ganando con normalidad) +
  // `polygonOffset` fuerte (empuja el VALOR de profundidad escrito, no la
  // posición — gana al suelo coplanar por el margen de offset, que es
  // órdenes de magnitud menor que la altura real de un jugador de pie, así
  // que nunca "engaña" al test contra algo genuinamente por encima).
  // Confirmado con un probe real: factor/units moderados (±4) no bastaban
  // bajo este renderer, ±50 sí cubre la casilla entera contra el suelo
  // manteniendo la oclusión correcta contra cualquier cosa por encima.
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: opacidad,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -50,
    polygonOffsetUnits: -50,
  });
  const malla = new THREE.Mesh(geometria, material);
  malla.rotation.x = -Math.PI / 2;
  malla.renderOrder = 1; // por encima de la rejilla táctica (líneas a y=0.02) — el depthTest real decide el resto
  return malla;
}

export class ResaltadoCombate {
  private readonly grupo = new THREE.Group();
  private readonly planosPorUnidad = new Map<string, THREE.Mesh>();
  // Casillas alcanzables (verde) — mapa APARTE, clave "gx,gy" en vez de id
  // de unidad; grupo propio para poder limpiarlas de golpe sin tocar los
  // planos de unidad (se recalculan con más frecuencia: cada turno propio y
  // cada movimiento/ataque propio, mientras que los de unidad solo cambian
  // con la posición/bando/estado real de cada combatiente).
  private readonly grupoAlcanzables = new THREE.Group();
  private readonly planosAlcanzables = new Map<string, THREE.Mesh>();

  constructor(escena: { añadirEstatico(objeto: THREE.Object3D): void }) {
    escena.añadirEstatico(this.grupo);
    escena.añadirEstatico(this.grupoAlcanzables);
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

  /**
   * Reconcilia las casillas alcanzables en verde (respuesta real del
   * servidor a `combate:alcanzables` — NUNCA calculado en el cliente, así
   * lo que se pinta es exactamente lo que `combate:mover` aceptaría, sin
   * poder desincronizarse de la validación real). `casillas=[]` limpia todo
   * (turno ajeno, sin PA, aturdido...).
   */
  actualizarAlcanzables(gx0: number, gy0: number, casillas: { gx: number; gy: number }[]): void {
    const vistos = new Set<string>();
    for (const { gx, gy } of casillas) {
      const clave = `${gx},${gy}`;
      vistos.add(clave);
      let plano = this.planosAlcanzables.get(clave);
      if (!plano) {
        plano = crearPlano(OPACIDAD_ALCANZABLE);
        (plano.material as THREE.MeshBasicMaterial).color.setHex(COLOR_ALCANZABLE);
        this.planosAlcanzables.set(clave, plano);
        this.grupoAlcanzables.add(plano);
      }
      plano.position.set(gx0 + gx + 0.5, ALTURA_PLANO, gy0 + gy + 0.5);
    }
    for (const [clave, plano] of this.planosAlcanzables) {
      if (vistos.has(clave)) continue;
      this.grupoAlcanzables.remove(plano);
      plano.geometry.dispose();
      (plano.material as THREE.Material).dispose();
      this.planosAlcanzables.delete(clave);
    }
  }

  /** Quita todos los planos (unidad + alcanzables) — llamar al salir de la arena/combate. */
  limpiar(): void {
    for (const plano of this.planosPorUnidad.values()) {
      this.grupo.remove(plano);
      plano.geometry.dispose();
      (plano.material as THREE.Material).dispose();
    }
    this.planosPorUnidad.clear();
    this.actualizarAlcanzables(0, 0, []);
  }
}
