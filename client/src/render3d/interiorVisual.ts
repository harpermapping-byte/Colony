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
  capa?: string;
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
const COLOR_PASILLO = "#9c8f74"; // suelo del hueco de 1 casilla entre puertas — sin esto se veía un agujero sin suelo

// Antorchas/candelabros (capa "iluminacion" de interiores/catalogo/elementos.json)
// ya se colocaban en el bake, pero se pintaban como un mueble más — sin luz
// de verdad, un interior quedaba a oscuras de noche (el ciclo día/noche solo
// mueve la luz ambiente/sol exterior, que no llega dentro de un edificio con
// paredes). Siempre encendidas (una antorcha no se apaga de día): cada pieza
// de esta capa suma además un THREE.PointLight cálido sobre su posición.
const ALTO_LUZ = 1.6;
const COLOR_LUZ = 0xffb066;
const INTENSIDAD_LUZ = 1.3;
const ALCANCE_LUZ = 6;

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
      const cx = offsetX + item.x + item.ancho / 2;
      const cz = offsetY + item.y + item.largo / 2;
      caja.position.set(cx, ALTO_MUEBLE / 2, cz);
      grupo.add(caja);

      if (item.capa === "iluminacion") {
        const luz = new THREE.PointLight(COLOR_LUZ, INTENSIDAD_LUZ, ALCANCE_LUZ, 2);
        luz.position.set(cx, ALTO_LUZ, cz);
        grupo.add(luz);
      }
    }
  }

  // Suelo de cada puerta de conexión: el hueco entre dos salas (o entre una
  // sala y el pasillo) es de 1 casilla — colocarSala.puerta cae justo AHÍ,
  // fuera del rectángulo de cualquier sala, así que ningún `suelo` de la
  // sala lo pintaba: se veía un agujero sin piso entre las dos habitaciones
  // en vez de un pasillito real (bug visual reportado). La colisión del
  // servidor ya despejaba esa casilla y sus 4 vecinas (interiorColision.ts)
  // — aquí solo falta el plano que se ve.
  const matPasillo = new THREE.MeshStandardMaterial({ color: COLOR_PASILLO, roughness: 0.95, metalness: 0 });
  for (const puerta of puertas) {
    const suelo = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), matPasillo);
    suelo.position.set(puerta.x + 0.5, -0.05, puerta.y + 0.5);
    grupo.add(suelo);
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
