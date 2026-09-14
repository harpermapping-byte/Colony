// Verificación AISLADA del bloqueo del hilo principal durante
// `crearPropsSector` (2026-09-13, investigación de "sigue habiendo lag en
// el mundo" tras trocear `crearTerrenoSector` — ver CHUNKS_POR_CESION_TERRENO
// y GRUPOS/PRESUPUESTO_MS_PROPS en sectorVisual.ts) — mismo patrón que
// patronSueloAislado.ts: sin servidor de juego, carga sectores REALES del
// mapa principal y mide el hueco máximo entre frames con un heartbeat de
// rAF, distinguiendo caché FRÍA (primera vez que se ve una especie) de
// caché CALIENTE (revisitar, todo ya cargado) — el caso frío es el que se
// dispara constantemente explorando terreno nuevo, el caliente es mucho
// más raro en la práctica real (el pool de sectores materializados-
// cacheados de `streamingSectores.ts` evita reconstruir un sector ya
// visitado reciente sin llamar a esta función de nuevo).
//
//   cd client && npx vite --port 5212
//   abrir http://localhost:5212/test/propsSectorAislado.html
//   (o usar client/test/propsSectorAisladoCaptura.mjs)
import { crearSectorVisual } from "../src/render3d/sectorVisual";
import type { IndiceMapa, SectorBakeado } from "../src/mapa/formatoMapa";

const marcasFrame: number[] = [];
function latidoFrame() {
  marcasFrame.push(performance.now());
  requestAnimationFrame(latidoFrame);
}
requestAnimationFrame(latidoFrame);
function huecoMaximoEntre(desde: number, hasta: number): number {
  // Incluye los huecos de BORDE (desde->primera marca, última marca->hasta):
  // si el bloqueo dura más que la ventana entera puede haber 0 o 1 marcas
  // DENTRO de [desde,hasta] — sin esto el hueco real quedaría subestimado a
  // 0, justo el caso más grave (bug real encontrado el mismo día).
  const enVentana = marcasFrame.filter((m) => m >= desde && m <= hasta);
  const puntos = [desde, ...enVentana, hasta];
  let maximo = 0;
  for (let i = 1; i < puntos.length; i++) maximo = Math.max(maximo, puntos[i] - puntos[i - 1]);
  return maximo;
}

const base = "/assets/mapas/principal";
const indice: IndiceMapa = await (await fetch(`${base}/indice.json`)).json();
const pad = (n: number) => String(n).padStart(3, "0");

async function cargarYMedir(sx: number, sy: number, etiqueta: string) {
  const sector: SectorBakeado = await (await fetch(`${base}/sector_${pad(sx)}_${pad(sy)}.json`)).json();
  const t0 = performance.now();
  await crearSectorVisual(indice, sector);
  const t1 = performance.now();
  await new Promise((r) => requestAnimationFrame(r));
  const totalMs = t1 - t0;
  const huecoMs = huecoMaximoEntre(t0, t1);
  (window as any).__ultimoResultado = { totalMs, huecoMs };
  console.log(`${etiqueta} sector ${sx}_${sy}: total=${totalMs.toFixed(1)}ms hueco_max=${huecoMs.toFixed(1)}ms`);
}

// 1a: cache fría (glb reales por red, primera vez que se ve el sector).
// 2a: MISMO sector otra vez — todo cacheado (entityLoader/faunaDecorativaPool).
// 3a: otro sector distinto — parcialmente caliente (especies compartidas).
await cargarYMedir(9, 1, "1a carga (frio)");
await cargarYMedir(9, 1, "2a carga MISMO sector (CALIENTE)");
await cargarYMedir(3, 6, "otro sector distinto (parcialmente caliente)");
(window as any).__listo = true;
