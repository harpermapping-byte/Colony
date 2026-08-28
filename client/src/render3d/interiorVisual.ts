/**
 * Render placeholder de un interior de edificio (docs/GDD_Sistema_Puertas.md)
 * — cajas de color por sala/mueble/pared, mismo criterio "todo el arte es
 * placeholder" que el resto del proyecto (colorDebug del catálogo). v1:
 * solo planta baja, paredes SIEMPRE visibles (sin oclusión dinámica estilo
 * Project Zomboid todavía — pendiente, ver GDD), con hueco en cada puerta
 * de conexión real entre salas.
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

export interface InteriorBakeado {
  id: string;
  tipoEdificioId: string;
  plantas: { nivel: number; rol: string; salas: SalaInterior[]; puertasConexion?: PuertaConexion[] }[];
}

const ALTO_MUEBLE = 0.6;
const ALTO_PARED = 2.4;
const GROSOR_PARED = 0.12;
const COLOR_PARED = "#b0a48c";

export function crearInteriorVisual(interior: InteriorBakeado): THREE.Group {
  const grupo = new THREE.Group();
  // plantas[0] NO es siempre la planta baja (edificios con bodega) — mismo
  // bug que se corrigió en el servidor, mismo criterio aquí.
  const planta = interior.plantas.find((p) => p.rol === "planta_baja") ?? interior.plantas[0];
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
