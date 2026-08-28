/**
 * Render placeholder de un interior de edificio (docs/GDD_Sistema_Puertas.md)
 * — cajas de color por sala/mueble/pared, mismo criterio "todo el arte es
 * placeholder" que el resto del proyecto (colorDebug del catálogo). v2:
 * la planta a pintar la elige `nivel` (por defecto planta baja); paredes
 * SIEMPRE visibles (sin oclusión dinámica estilo Project Zomboid todavía
 * — pendiente, ver GDD), con hueco en cada puerta de conexión real entre
 * salas de la MISMA planta, y un marcador propio (distinto de un mueble)
 * en cada escalera/trampilla que suba o baje de planta.
 */
import * as THREE from "three";

interface ElementoColocado {
  id: string;
  x: number;
  y: number;
  ancho: number;
  largo: number;
  colorDebug?: string;
}

interface PuertaConexion {
  x: number;
  y: number;
}

interface SalaInterior {
  tipoSalaId: string;
  offsetX: number;
  offsetY: number;
  resultado: {
    ancho: number;
    largo: number;
    colocados: ElementoColocado[];
  };
}

interface ConectorVertical {
  tipoConectorId: string;
  entreNiveles: [number, number];
  posicionAbajo: { x: number; y: number };
  posicionArriba: { x: number; y: number };
  huella: [number, number];
}

export interface InteriorBakeado {
  id: string;
  tipoEdificioId: string;
  plantas: { nivel: number; rol: string; salas: SalaInterior[]; puertasConexion?: PuertaConexion[] }[];
  conectoresVerticales?: ConectorVertical[];
}

const ALTO_MUEBLE = 0.6;
const ALTO_PARED = 2.4;
const GROSOR_PARED = 0.12;
const COLOR_PARED = "#b0a48c";
const ALTO_CONECTOR = 0.9;
const COLOR_CONECTOR = "#c9a227"; // distinto de cualquier mueble: es un portal, no decoración

export function crearInteriorVisual(interior: InteriorBakeado, nivel = 0): THREE.Group {
  const grupo = new THREE.Group();
  // plantas[0] NO es siempre la planta baja (edificios con bodega) — mismo
  // bug que se corrigió en el servidor, mismo criterio aquí. `nivel` decide
  // qué planta se pinta (0 = planta baja si no se especifica otra).
  const planta = interior.plantas.find((p) => p.nivel === nivel) ?? interior.plantas.find((p) => p.rol === "planta_baja") ?? interior.plantas[0];
  const salas = planta?.salas ?? [];
  const puertas = planta?.puertasConexion ?? [];
  const esPuerta = (x: number, y: number) => puertas.some((p) => p.x === x && p.y === y);

  const matPared = new THREE.MeshStandardMaterial({ color: COLOR_PARED, roughness: 0.95, metalness: 0 });
  const geoParedH = new THREE.BoxGeometry(1, ALTO_PARED, GROSOR_PARED);
  const geoParedV = new THREE.BoxGeometry(GROSOR_PARED, ALTO_PARED, 1);

  for (const sala of salas) {
    const { offsetX, offsetY, resultado } = sala;
    const suelo = new THREE.Mesh(
      new THREE.BoxGeometry(resultado.ancho, 0.1, resultado.largo),
      new THREE.MeshStandardMaterial({ color: colorDeSala(sala.tipoSalaId), roughness: 0.95, metalness: 0 }),
    );
    suelo.position.set(offsetX + resultado.ancho / 2, -0.05, offsetY + resultado.largo / 2);
    grupo.add(suelo);

    // Paredes casilla a casilla, con hueco donde haya una puerta de
    // conexión real (interiores/src/edificio.js) — norte nunca la tiene
    // (las salas de una fila se alinean por el muro sur, GDD_Sistema_Puertas).
    for (let x = offsetX; x < offsetX + resultado.ancho; x++) {
      añadirSiNoEsPuerta(grupo, geoParedH, matPared, x + 0.5, offsetY, esPuerta(x, offsetY - 1));
      añadirSiNoEsPuerta(grupo, geoParedH, matPared, x + 0.5, offsetY + resultado.largo, esPuerta(x, offsetY + resultado.largo));
    }
    for (let y = offsetY; y < offsetY + resultado.largo; y++) {
      añadirSiNoEsPuerta(grupo, geoParedV, matPared, offsetX, y + 0.5, esPuerta(offsetX - 1, y));
      añadirSiNoEsPuerta(grupo, geoParedV, matPared, offsetX + resultado.ancho, y + 0.5, esPuerta(offsetX + resultado.ancho, y));
    }

    for (const item of resultado.colocados) {
      const caja = new THREE.Mesh(
        new THREE.BoxGeometry(item.ancho, ALTO_MUEBLE, item.largo),
        new THREE.MeshStandardMaterial({ color: item.colorDebug ?? "#8a6a4a", roughness: 0.9, metalness: 0 }),
      );
      caja.position.set(offsetX + item.x + item.ancho / 2, ALTO_MUEBLE / 2, offsetY + item.y + item.largo / 2);
      grupo.add(caja);
    }
  }

  // Escaleras/trampillas que tocan esta planta — mismo cálculo de "a qué
  // lado del conector le toca esta planta" que interiorColision.ts en el
  // servidor: color/altura propios para que se note que es un TP, no
  // decoración normal.
  const matConector = new THREE.MeshStandardMaterial({ color: COLOR_CONECTOR, roughness: 0.7, metalness: 0.1 });
  for (const c of interior.conectoresVerticales ?? []) {
    const [nivelAbajo, nivelArriba] = c.entreNiveles;
    const posicion = nivelAbajo === nivel ? c.posicionAbajo : nivelArriba === nivel ? c.posicionArriba : null;
    if (!posicion) continue;
    const [hw, hl] = c.huella;
    const caja = new THREE.Mesh(new THREE.BoxGeometry(hw, ALTO_CONECTOR, hl), matConector);
    caja.position.set(posicion.x + hw / 2, ALTO_CONECTOR / 2, posicion.y + hl / 2);
    grupo.add(caja);
  }

  return grupo;
}

function añadirSiNoEsPuerta(
  grupo: THREE.Group,
  geometria: THREE.BoxGeometry,
  material: THREE.Material,
  x: number,
  z: number,
  esHueco: boolean,
) {
  if (esHueco) return;
  const caja = new THREE.Mesh(geometria, material);
  caja.position.set(x, ALTO_PARED / 2, z);
  grupo.add(caja);
}

// Color de suelo estable por tipo de sala (hash simple → tono), para
// distinguir salas a simple vista sin un catálogo de materiales todavía.
function colorDeSala(tipoSalaId: string): number {
  let h = 0;
  for (let i = 0; i < tipoSalaId.length; i++) h = (h * 31 + tipoSalaId.charCodeAt(i)) >>> 0;
  const color = new THREE.Color();
  color.setHSL((h % 360) / 360, 0.25, 0.55);
  return color.getHex();
}
