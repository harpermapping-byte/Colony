/**
 * Herramienta de test (NO forma parte del servidor): adelanta N pulsos
 * REALES de `ejecutarTickEconomia` contra una BD sqlite ya sembrada, sin
 * esperar los 10 minutos reales entre pulso y pulso — para que un E2E
 * pueda comprobar "qué pasa si pasan muchos turnos" (docs/GDD_Faccion_Bandidos.md
 * §6) sin tener el servidor corriendo a la vez contra el mismo archivo
 * (evita escrituras concurrentes de dos procesos sobre el mismo sqlite).
 *   npx tsx test/_ejecutarTicksEconomia.ts <rutaBd> <numTicks>
 */
import { crearAlmacenDatos } from "../src/datos/bd";
import { ejecutarTickEconomia } from "../src/mundo/economiaAsentamientos";

async function main() {
  const [rutaBd, numTicksStr] = process.argv.slice(2);
  const numTicks = Number(numTicksStr);
  if (!rutaBd || !Number.isFinite(numTicks) || numTicks <= 0) {
    throw new Error("uso: _ejecutarTicksEconomia.ts <rutaBd> <numTicks>");
  }
  const bd = await crearAlmacenDatos(rutaBd);
  for (let i = 0; i < numTicks; i++) await ejecutarTickEconomia(bd);
  console.log(`${numTicks} pulso(s) de economía aplicados sobre ${rutaBd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
