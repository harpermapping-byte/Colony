/**
 * Render placeholder de un interior de edificio (docs/GDD_Sistema_Puertas.md)
 * — cajas de color por sala/mueble, mismo criterio "todo el arte es
 * placeholder" que el resto del proyecto (colorDebug del catálogo). v1:
 * solo planta baja, sin paredes ni techo (se ve la planta desde arriba,
 * suficiente para demostrar "estás dentro" — el pulido es un hito aparte).
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
  plantas: { nivel: number; salas: SalaInterior[] }[];
}

const ALTO_MUEBLE = 0.6;

export function crearInteriorVisual(interior: InteriorBakeado): THREE.Group {
  const grupo = new THREE.Group();
  const salas = interior.plantas[0]?.salas ?? [];

  for (const sala of salas) {
    const { offsetX, offsetY, resultado } = sala;
    const suelo = new THREE.Mesh(
      new THREE.BoxGeometry(resultado.ancho, 0.1, resultado.largo),
      new THREE.MeshStandardMaterial({ color: colorDeSala(sala.tipoSalaId), roughness: 0.95, metalness: 0 }),
    );
    suelo.position.set(offsetX + resultado.ancho / 2, -0.05, offsetY + resultado.largo / 2);
    grupo.add(suelo);

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

// Color de suelo estable por tipo de sala (hash simple → tono), para
// distinguir salas a simple vista sin un catálogo de materiales todavía.
function colorDeSala(tipoSalaId: string): number {
  let h = 0;
  for (let i = 0; i < tipoSalaId.length; i++) h = (h * 31 + tipoSalaId.charCodeAt(i)) >>> 0;
  const color = new THREE.Color();
  color.setHSL((h % 360) / 360, 0.25, 0.55);
  return color.getHex();
}
