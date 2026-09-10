/**
 * Puente TS→JS del creador de personaje del jugador (docs/GDD_Personaje.md,
 * pedido streamer 2026-09-10) — mismo patrón de cross-require entre
 * carpetas top-level ya usado por `mundo/catalogoEnemigos.ts` (ahí para un
 * `.json`, aquí para un módulo ejecutable): TypeScript no tipa nada dentro
 * de `personajes/src/generarFichaJugador.js`, así que este archivo es la
 * ÚNICA frontera con `any` — todo lo que sale de aquí hacia el resto del
 * servidor ya viene con forma conocida.
 *
 * Esta es la fuente de verdad SERVER-SIDE: valida la elección del jugador
 * contra el catálogo real (rasgos.json) y nunca confía en el tipo de lo que
 * mande el cliente — la ruta HTTP que la llama (`auth/rutasAuthJugador.ts`)
 * es pública, misma lección que el bug crítico de 2026-09-10 (GDD_Cuentas
 * §5quater). El cliente tiene su PROPIO port en TypeScript
 * (`client/src/personaje/crearFichaVoxel.ts`) solo para la vista previa en
 * vivo del creador, sin ida y vuelta al servidor por cada clic — la ficha
 * que de verdad se persiste y se ve en el mundo siempre sale de AQUÍ.
 */
const generarFichaJugadorJs: (
  eleccion: EleccionPersonajeJugador,
  semillaEstable: string,
) => FichaJugadorGenerada = require("../../../personajes/src/generarFichaJugador.js").generarFichaJugador;

export interface EleccionPersonajeJugador {
  sexo?: string;
  peloEstilo?: string;
  barbaEstilo?: string;
  peloColorId?: string;
  pielColorId?: string;
  ojosColorId?: string;
  altura?: number;
  corpulencia?: number;
}

interface ColorConId {
  id: string;
  hex: string;
}

// Forma exacta que espera client/src/render3d/personajeVoxel.ts
// (PersonajeExportado.ficha/.voxelesCabeza) — `cuerpo` no tiene consumidor
// en el cliente hoy (mismo contrato que generarPersonaje.js, se descarta al
// persistir, ver rutasAuthJugador.ts).
export interface FichaJugadorGenerada {
  ficha: {
    npcId: string;
    sexo: string;
    morfologia: { altura: number; corpulencia: number; sexo: string };
    rasgos: {
      peloEstilo: string;
      barbaEstilo: string;
      peloColor: ColorConId;
      pielColor: ColorConId;
      ojosColor: ColorConId;
    };
    ropa: unknown[];
  };
  voxelesCabeza: unknown[];
  cuerpo: unknown;
}

/**
 * Valida y construye la ficha REAL de un personaje elegido por el jugador.
 * `semillaEstable` es solo cosmético (jitter de color de vóxel
 * determinista) — normalmente el nombre de la cuenta.
 */
export function generarFichaJugador(eleccion: EleccionPersonajeJugador, semillaEstable: string): FichaJugadorGenerada {
  return generarFichaJugadorJs(eleccion, semillaEstable);
}
