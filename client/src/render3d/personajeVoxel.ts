import * as THREE from "three";
import { crearRigHumanoide, type RigHumanoide } from "./rigHumanoide";
import { mallasPorPivote, type VoxelExportado } from "./voxelMalla";

/**
 * Materializa un personaje COMPLETO del generador (personajes/ + ropa/):
 * el rig humanoide con su morfología y colores de la ficha, el pelo/barba
 * vóxel colgando del pivote `cabeza`, y cada prenda fusionada y colgada del
 * pivote que declaran sus vóxeles (torso/piernas/brazos/cabeza) — heredan
 * la animación gratis, tal y como se diseñó. Este módulo es el "vestirse"
 * que faltaba del circuito: catálogo → generador → JSON → NPC andando.
 */

export interface FichaPersonaje {
  npcId: string;
  sexo: string;
  morfologia: { altura?: number; corpulencia?: number; sexo?: "hombre" | "mujer" };
  rasgos: {
    peloColor: { hex: string };
    pielColor: { hex: string };
    ojosColor: { hex: string };
  };
}

export interface PersonajeExportado {
  ficha: FichaPersonaje;
  voxelesCabeza: VoxelExportado[];
  ropa: { prendaId: string; materialId: string; voxeles: VoxelExportado[] }[];
}

export function crearPersonajeVoxel(datos: PersonajeExportado): RigHumanoide {
  const { ficha } = datos;
  const rig = crearRigHumanoide({
    // el "color de túnica" del placeholder pasa a ser piel: el cuerpo va
    // desnudo debajo y la ropa vóxel real se pinta encima
    colorTunica: ficha.rasgos.pielColor.hex,
    colorPiel: ficha.rasgos.pielColor.hex,
    colorPelo: ficha.rasgos.peloColor.hex,
    colorOjos: ficha.rasgos.ojosColor.hex,
    morfologia: ficha.morfologia,
  });

  const todos: VoxelExportado[] = [...datos.voxelesCabeza];
  for (const prenda of datos.ropa) todos.push(...prenda.voxeles);

  if (datos.voxelesCabeza.length) {
    // el pelo vóxel real sustituye a la "gorra" placeholder del rig
    rig.objeto.getObjectByName("peloPlaceholder")?.removeFromParent();
  }

  for (const [pivote, malla] of mallasPorPivote(todos)) {
    const nodo = rig.objeto.getObjectByName(pivote);
    if (!nodo) {
      console.warn(`personajeVoxel: el rig no tiene pivote "${pivote}" — vóxeles descartados`);
      continue;
    }
    nodo.add(malla);
  }

  return rig;
}
