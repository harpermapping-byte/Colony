import { WorldScene } from "./render3d/worldScene";
import { crearPersonajeVoxel } from "./render3d/personajeVoxel";
import { cargarMapa, type MapaCargado } from "./mapa/cargarMapa";
import { crearTerreno } from "./render3d/terreno";
import { crearPropsBakeados } from "./render3d/propsBakeados";
import { terrenoEn, type ChunkBakeado } from "./mapa/formatoMapa";

/**
 * Demo LOCAL de un jugador: el mismo mundo bakeado y el mismo personaje
 * vóxel que el juego real (`game.ts`), pero sin servidor — el movimiento se
 * simula en el cliente con la misma velocidad que usa `HubRoom` (4 px por
 * tick a 30hz). Sirve para probar "cómo se siente" moverse por un mapa
 * bakeado sin levantar Colyseus: la usa la demo publicada como Artifact y
 * se puede abrir en local con `?demo=1`.
 *
 * Controles: WASD/flechas, y el evento `demo-direccion` (detail {x,y}) para
 * botones táctiles superpuestos.
 */

const COLOR_JUGADOR = "#f6ad55";
const PIXELES_POR_UNIDAD = 32;
const VELOCIDAD_PX_S = 4 * 30; // SPEED del servidor (4 px/tick) × 30 ticks/s

// Terrenos donde NO se hace aparecer al jugador (solo afecta al spawn de la
// demo — el movimiento sigue siendo libre porque no hay colisión todavía).
const TERRENO_NO_PISABLE = new Set(["agua", "agua_profunda", "lava", "roca_inaccesible"]);

/**
 * Primer tile pisable en espiral desde la entrada de la ciudad (o el centro
 * del mapa): la demo aparece en tierra firme aunque el punto exacto caiga
 * en un lago, como pasa en el mapa demo.
 */
function buscarSpawn(mapa: MapaCargado): { x: number; y: number } {
  const { indice, sectores } = mapa;
  const tamano = indice.tamanoChunk;
  const chunks = new Map<string, ChunkBakeado>();
  for (const sector of sectores) for (const [clave, chunk] of Object.entries(sector.chunks)) chunks.set(clave, chunk);

  const anchoCasillas = indice.anchoChunks * tamano;
  const altoCasillas = indice.altoChunks * tamano;
  const origen = indice.ciudad ?? { x: Math.floor(anchoCasillas / 2), y: Math.floor(altoCasillas / 2) };

  const pisable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= anchoCasillas || y >= altoCasillas) return false;
    const chunk = chunks.get(`${Math.floor(x / tamano)}_${Math.floor(y / tamano)}`);
    if (!chunk) return false;
    return !TERRENO_NO_PISABLE.has(terrenoEn(chunk, indice.leyendaTerreno, x % tamano, y % tamano));
  };

  for (let radio = 0; radio < Math.max(anchoCasillas, altoCasillas); radio++) {
    for (let dy = -radio; dy <= radio; dy++)
      for (let dx = -radio; dx <= radio; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radio) continue; // solo el anillo del radio actual
        if (pisable(origen.x + dx, origen.y + dy)) return { x: origen.x + dx, y: origen.y + dy };
      }
  }
  return origen;
}

export async function iniciarDemoLocal(contenedor: HTMLElement, nombreMapa = "demo") {
  const escena = new WorldScene(contenedor, contenedor.clientWidth || 800, contenedor.clientHeight || 600);
  window.addEventListener("resize", () => {
    escena.resize(contenedor.clientWidth || 800, contenedor.clientHeight || 600);
  });

  let maxPx = 48 * PIXELES_POR_UNIDAD;
  let maxPy = maxPx;
  let px = maxPx / 2, py = maxPy / 2; // arranque en el centro del mapa
  try {
    const mapa = await cargarMapa(`/assets/mapas/${nombreMapa}`);
    escena.añadirEstatico(crearTerreno(mapa));
    escena.añadirEstatico(await crearPropsBakeados(mapa));
    maxPx = mapa.indice.anchoChunks * mapa.indice.tamanoChunk * PIXELES_POR_UNIDAD;
    maxPy = mapa.indice.altoChunks * mapa.indice.tamanoChunk * PIXELES_POR_UNIDAD;
    const spawn = buscarSpawn(mapa);
    px = (spawn.x + 0.5) * PIXELES_POR_UNIDAD;
    py = (spawn.y + 0.5) * PIXELES_POR_UNIDAD;
  } catch (err) {
    console.error("No se pudo cargar el mapa bakeado:", err);
  }

  const rig = crearPersonajeVoxel({ colorTunica: COLOR_JUGADOR });
  escena.añadirEntidad("local", rig.objeto, px, py, "Tú");
  escena.seguirPunto(px, py, true);

  const teclas = new Set<string>();
  window.addEventListener("keydown", (e) => teclas.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => teclas.delete(e.key.toLowerCase()));
  let dirTactil = { x: 0, y: 0 };
  window.addEventListener("demo-direccion", ((e: CustomEvent) => {
    dirTactil = { x: e.detail?.x || 0, y: e.detail?.y || 0 };
  }) as EventListener);

  let tAnterior = performance.now();
  function bucle(tAhora: number) {
    const dt = Math.min((tAhora - tAnterior) / 1000, 0.1);
    tAnterior = tAhora;

    let x =
      (teclas.has("d") || teclas.has("arrowright") ? 1 : 0) - (teclas.has("a") || teclas.has("arrowleft") ? 1 : 0);
    let y = (teclas.has("s") || teclas.has("arrowdown") ? 1 : 0) - (teclas.has("w") || teclas.has("arrowup") ? 1 : 0);
    if (x === 0 && y === 0) {
      x = dirTactil.x;
      y = dirTactil.y;
    }

    const andando = x !== 0 || y !== 0;
    if (andando) {
      px = Math.min(maxPx, Math.max(0, px + x * VELOCIDAD_PX_S * dt));
      py = Math.min(maxPy, Math.max(0, py + y * VELOCIDAD_PX_S * dt));
      rig.orientar(x, y);
      escena.moverEntidad("local", px, py);
      escena.seguirPunto(px, py);
    }
    rig.objeto.position.set(px / PIXELES_POR_UNIDAD, 0, py / PIXELES_POR_UNIDAD);
    rig.actualizar(dt, andando);

    escena.actualizar(dt);
    escena.render();
    requestAnimationFrame(bucle);
  }
  requestAnimationFrame(bucle);
}
