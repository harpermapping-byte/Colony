/**
 * Convierte el interior YA bakeado de un edificio (interiores/src/edificio.js,
 * el mismo JSON que ciudades/ escribe en `<rutaMapa>/interiores/<edificio>.json`)
 * en la rejilla de colisión que usa la simulación — mismo patrón que
 * mundo/mapaColision.ts para el exterior, pero a escala de habitación.
 *
 * v1 (docs/GDD_Sistema_Puertas.md): solo la PLANTA BAJA (plantas[0]) — subir
 * de piso queda pendiente, ver conectoresVerticales en el JSON.
 */

import * as fs from "fs";
import { MundoColision, TIPO } from "./colisiones";
import { cargarCatalogoConstruible } from "../construccion/catalogo";

interface ElementoColocado {
  id: string;
  x: number;
  y: number;
  ancho: number;
  largo: number;
}

interface SalaInterior {
  offsetX: number;
  offsetY: number;
  resultado: {
    ancho: number;
    largo: number;
    puerta: { lado: string; x: number; y: number };
    colocados: ElementoColocado[];
  };
}

interface InteriorBakeado {
  id: string;
  tipoEdificioId: string;
  plantas: { nivel: number; salas: SalaInterior[] }[];
}

export interface InteriorCargado extends MundoColision {
  id: string;
  /** casilla de aparición al entrar (dentro de la primera sala de la planta baja) */
  spawnX: number;
  spawnY: number;
}

export function cargarInterior(rutaArchivo: string): InteriorCargado {
  const interior = JSON.parse(fs.readFileSync(rutaArchivo, "utf8")) as InteriorBakeado;
  const salas = interior.plantas[0]?.salas ?? [];
  if (salas.length === 0) throw new Error(`interior sin salas en planta baja: ${rutaArchivo}`);

  const ancho = Math.max(...salas.map((s) => s.offsetX + s.resultado.ancho)) + 1;
  const alto = Math.max(...salas.map((s) => s.offsetY + s.resultado.largo)) + 1;
  const casillas = new Uint8Array(ancho * alto).fill(TIPO.SOLIDO); // fuera de toda sala = pared
  const velocidad = new Float32Array(ancho * alto).fill(1);

  const catalogoConstruible = cargarCatalogoConstruible();

  for (const sala of salas) {
    const { offsetX, offsetY, resultado } = sala;
    for (let y = 0; y < resultado.largo; y++) {
      for (let x = 0; x < resultado.ancho; x++) {
        casillas[(offsetY + y) * ancho + (offsetX + x)] = TIPO.TIERRA;
      }
    }
    for (const item of resultado.colocados) {
      if (!catalogoConstruible.get(item.id)?.colision) continue; // decorativo: no bloquea
      for (let y = 0; y < item.largo; y++) {
        for (let x = 0; x < item.ancho; x++) {
          const idx = (offsetY + item.y + y) * ancho + (offsetX + item.x + x);
          if (idx >= 0 && idx < casillas.length) casillas[idx] = TIPO.SOLIDO;
        }
      }
    }
  }

  // aparece en el centro de la primera sala (v1: no hay forma explícita de
  // saber cuál conecta con la puerta exterior — ver GDD_Sistema_Puertas.md)
  const primera = salas[0];
  const spawnX = primera.offsetX + primera.resultado.ancho / 2;
  const spawnY = primera.offsetY + primera.resultado.largo / 2;

  return { id: interior.id, ancho, alto, casillas, velocidad, spawnX, spawnY };
}
