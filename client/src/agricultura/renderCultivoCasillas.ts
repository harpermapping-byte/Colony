/**
 * Render de las casillas de cultivo de campo abierto (docs/GDD_Agricultura.md,
 * `state.cultivosCasilla`, 2026-09-11): tierra labrada = losa marrón a ras de
 * suelo; sembrada = la misma losa + un brote (dos planos cruzados) que crece
 * con el porcentaje real de maduración, calculado en el cliente con el
 * catálogo público (`items.json::cultivo.diasCrecimiento`) y el día de mundo
 * — misma regla que usa el servidor para aceptar `cultivoCasilla:cosechar`,
 * así el jugador VE cuándo puede cosechar en vez de probar a ciegas.
 *
 * Geometrías/materiales compartidos por TODAS las casillas (una losa puede
 * repetirse cientos de veces en una granja real) — solo se instancia un
 * Object3D ligero por casilla, y se reconstruye únicamente cuando cambia su
 * "tramo" visual (estado o cuarto de crecimiento), nunca por frame.
 */
import * as THREE from "three";
import itemsJson from "../../../items/catalogo/items.json";

interface EntradaItem { cultivo?: { diasCrecimiento?: number } }
const ITEMS = itemsJson as unknown as Record<string, EntradaItem>;

const GEO_LOSA = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
const MAT_LOSA = new THREE.MeshLambertMaterial({ color: 0x5a3a1e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const GEO_BROTE = new THREE.PlaneGeometry(0.5, 1).translate(0, 0.5, 0); // anclado por la base, escalado en Y según crecimiento
const MAT_BROTE = new THREE.MeshLambertMaterial({ color: 0x4a9a35, side: THREE.DoubleSide });
const MAT_MADURO = new THREE.MeshLambertMaterial({ color: 0xc9b537, side: THREE.DoubleSide });

export interface CasillaCultivoVista {
  x: number;
  y: number;
  estado: string; // "labrada" | "sembrada"
  semillaId: string;
  diaPlantado: number;
}

/** 0..1 de maduración (1 = cosechable), o null si no está sembrada / sin dato de catálogo. */
export function progresoCultivo(c: CasillaCultivoVista, diaMundo: number): number | null {
  if (c.estado !== "sembrada" || !c.semillaId) return null;
  const dias = ITEMS[c.semillaId]?.cultivo?.diasCrecimiento;
  if (!dias || dias <= 0) return null;
  return Math.max(0, Math.min(1, (diaMundo - c.diaPlantado) / dias));
}

/** Tramo visual: sirve para no reconstruir el objeto si nada visible cambió. */
export function tramoVisual(c: CasillaCultivoVista, diaMundo: number): string {
  const p = progresoCultivo(c, diaMundo);
  if (p === null) return c.estado;
  return p >= 1 ? "maduro" : `brote${Math.floor(p * 4)}`;
}

export function construirVisualCasilla(c: CasillaCultivoVista, diaMundo: number): THREE.Object3D {
  const grupo = new THREE.Group();
  const losa = new THREE.Mesh(GEO_LOSA, MAT_LOSA);
  losa.position.y = 0.02;
  losa.receiveShadow = true;
  grupo.add(losa);
  const p = progresoCultivo(c, diaMundo);
  if (p !== null) {
    const alto = 0.15 + 0.55 * p;
    for (const ang of [0, Math.PI / 2]) {
      const brote = new THREE.Mesh(GEO_BROTE, p >= 1 ? MAT_MADURO : MAT_BROTE);
      brote.scale.y = alto;
      brote.rotation.y = ang;
      brote.position.y = 0.02;
      grupo.add(brote);
    }
  }
  return grupo;
}

export class RenderCultivoCasillas {
  private readonly vivas = new Map<string, { datos: CasillaCultivoVista; tramo: string }>();

  constructor(
    private readonly escena: { añadirEntidad(id: string, objeto: THREE.Object3D, x: number, y: number): void; quitarEntidad(id: string): void },
    private readonly diaMundo: () => number,
  ) {}

  poner(id: string, datos: CasillaCultivoVista): void {
    const tramo = tramoVisual(datos, this.diaMundo());
    const previa = this.vivas.get(id);
    if (previa && previa.tramo === tramo && previa.datos.x === datos.x && previa.datos.y === datos.y) { previa.datos = datos; return; }
    this.vivas.set(id, { datos, tramo });
    this.escena.añadirEntidad(`cultivo_${id}`, construirVisualCasilla(datos, this.diaMundo()), datos.x + 0.5, datos.y + 0.5);
  }

  quitar(id: string): void {
    if (!this.vivas.delete(id)) return;
    this.escena.quitarEntidad(`cultivo_${id}`);
  }

  /** Reevalúa el crecimiento de las sembradas (llamar cada pocos segundos, el día de mundo avanza despacio). */
  actualizarCrecimiento(): void {
    for (const [id, v] of this.vivas) if (v.datos.estado === "sembrada") this.poner(id, v.datos);
  }

  /** Estado conocido de una casilla concreta, para el menú del suelo / sondas de test. */
  casillaEn(x: number, y: number): CasillaCultivoVista | null {
    for (const v of this.vivas.values()) if (v.datos.x === x && v.datos.y === y) return v.datos;
    return null;
  }

  todas(): CasillaCultivoVista[] {
    return [...this.vivas.values()].map((v) => v.datos);
  }
}
