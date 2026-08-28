import * as path from "path";

const RAIZ_REPO = path.resolve(__dirname, "..", "..", "..");

/** `mapaId` -> carpeta bakeada bajo assets/mapas/ (misma convención que
 * usa el cliente vía VITE_RUTA_MAPA=/assets/mapas/<mapaId>). */
export function rutaDeMapaId(mapaId: string): string {
  return path.join(RAIZ_REPO, "assets", "mapas", mapaId);
}
