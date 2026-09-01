/**
 * Carga `personajes/catalogo/animales_rig.json` y lo reduce a lo único que
 * hace falta en el servidor para monturas (docs/GDD_Monturas.md, pedido
 * 2026-08-30): qué especies son `montable` y a qué velocidad. El resto del
 * catálogo (esqueleto/proporciones/rasgos/colores) es SOLO del generador
 * visual (`personajes/src/generarAnimal.js`) — cero duplicado aquí, mismo
 * criterio que `catalogoCombateFauna.ts` con `baker/catalogo/animales.json`.
 */
import * as fs from "fs";
import * as path from "path";

export interface DatosMontura {
  montable: boolean;
  /** casillas/seg — solo tiene sentido si montable es true. */
  velocidadMontura: number;
}

export type CatalogoMonturas = Record<string, DatosMontura>;

interface EntradaCatalogoRig {
  montable?: boolean;
  velocidadMontura?: number;
  /** docs/GDD_Generador_Personajes.md "Trío macho/hembra/cría" (2026-09-02):
   * una hembra/cachorro puede heredar el rig entero de otra especie en vez
   * de duplicarlo — `montable`/`velocidadMontura` viven en ese mismo bloque
   * heredado, así que hay que resolverlo igual que ya hace generarAnimal.js
   * o una yegua/cerda (mismo animal que caballo/cerdo, solo cambia el sexo)
   * se quedaría fuera del catálogo de monturas sin razón real. Una cría
   * (`esCria:true`) NUNCA hereda `montable` — aunque el adulto lo sea, no
   * tiene sentido montar un potro/lechón.
   */
  heredaDe?: string;
  esCria?: boolean;
}

const RUTA_DEFECTO = path.join(__dirname, "..", "..", "..", "personajes", "catalogo", "animales_rig.json");

export function cargarCatalogoMonturas(ruta: string = RUTA_DEFECTO): CatalogoMonturas {
  const raw = JSON.parse(fs.readFileSync(ruta, "utf8")) as Record<string, EntradaCatalogoRig>;
  const catalogo: CatalogoMonturas = {};
  for (const [id, datosPropios] of Object.entries(raw)) {
    if (id.startsWith("_") || !datosPropios || typeof datosPropios !== "object") continue;
    let datos = datosPropios;
    if (datos.heredaDe && !datos.esCria) {
      const base = raw[datos.heredaDe];
      if (base && typeof base === "object") datos = { ...base, ...datos };
    }
    if (!datos.montable) continue;
    catalogo[id] = { montable: true, velocidadMontura: datos.velocidadMontura ?? 4 };
  }
  return catalogo;
}
