/**
 * Carga `baker/catalogo/animales.json` y lo reduce a lo que
 * `faunaSalvajeSector.ts`/`faunaSalvajeViva.ts` necesitan — un objeto
 * plano por especie con solo los campos de reproducción (ver
 * docs/GDD_Agentes_Moviles.md, pedido 2026-08-30). Las crías (sin
 * `tamanoReproduccion` ni `poblacionInfinita`) se omiten a propósito: no
 * participan en el apareamiento.
 */
import * as fs from "fs";
import { CatalogoEspecies } from "./faunaSalvajeSector";

interface EntradaCatalogoBaker {
  tamanoReproduccion?: "pequeno" | "mediano" | "grande";
  poneHuevos?: boolean;
  poblacionInfinita?: boolean;
  dieta?: "herbivoro" | "carnivoro" | "omnivoro";
  criaId?: string;
  criasPorCamada?: number;
}

export function cargarCatalogoFaunaSalvaje(rutaAnimalesJson: string): CatalogoEspecies {
  const raw = JSON.parse(fs.readFileSync(rutaAnimalesJson, "utf8")) as Record<string, EntradaCatalogoBaker>;
  const catalogo: CatalogoEspecies = {};
  for (const [id, datos] of Object.entries(raw)) {
    if (id.startsWith("_nota") || !datos || typeof datos !== "object") continue;
    if (datos.poblacionInfinita) {
      // dieta no se usa nunca en población infinita (no pasan por hambre/sed) — valor de relleno.
      catalogo[id] = { tamanoReproduccion: "pequeno", poneHuevos: false, dieta: "omnivoro", poblacionInfinita: true };
      continue;
    }
    if (!datos.tamanoReproduccion) continue; // cría, o especie sin catalogar todavía: no reproduce
    catalogo[id] = {
      tamanoReproduccion: datos.tamanoReproduccion,
      poneHuevos: !!datos.poneHuevos,
      dieta: datos.dieta ?? "omnivoro",
      criaId: datos.criaId,
      criasPorCamada: datos.criasPorCamada,
    };
  }
  return catalogo;
}
