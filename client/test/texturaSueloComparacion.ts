// Comparación AISLADA de 3 técnicas de render del SUELO (pregunta streamer
// 2026-09-11: "¿creamos texturas de bioma para el suelo y las aplicamos?" —
// tras explicar que hoy el suelo es color plano por casilla, pidió "ver
// ambas antes de decidir"). Mismo patrón que orillasAislado.ts/
// siluetaAislada.ts: sin servidor de juego, 3 escenas Three.js pequeñas
// lado a lado en la misma página, MISMOS colores reales del catálogo
// (`colorTerreno`, `baker/catalogo/terrenos.json`) y el mismo ángulo
// isométrico fijo que usa el juego (`worldScene.ts::posicionarCamaraIsometrica`).
//
// Layout sintético compartido por los 3 paneles (rectángulos simples a
// propósito — el objetivo es comparar la TÉCNICA de render, no simular un
// bioma splatting de producción): roca en la esquina superior-izquierda,
// agua en la inferior-derecha, un camino horizontal cruzando el centro,
// césped en el resto.
//
// A) ACTUAL (lo que ya hay en el juego): 1 color plano por casilla, tal
//    cual `crearTerrenoSector` en sectorVisual.ts.
// B) PATRÓN HORNEADO: mismo sistema de HOY (un único canvas por sector,
//    NearestFilter, sin UV repetido) pero con más resolución por casilla
//    y un patrón de ruido/motas dibujado a mano en vez de un color sólido
//    — cero cambio de arquitectura, mismo coste (una textura, un draw call).
// C) TEXTURA REAL REPETIDA POR GPU: el MISMO patrón de B (para comparar
//    la TÉCNICA, no el arte) pero como una textura pequeña de verdad con
//    `RepeatWrapping`, mapeada por UV sobre un plano por región — así se ve
//    si el patrón es de verdad "seamless" (sin costuras en la repetición)
//    o no.
//
//   cd client && npx vite --port 5211
//   abrir http://localhost:5211/test/texturaSueloComparacion.html?mitad=6
//   (o usar client/test/texturaSueloComparacionCaptura.mjs para capturas)
import * as THREE from "three";
import { colorTerreno } from "../src/render3d/catalogoVisual";

type TerrenoId = "cesped" | "camino" | "agua" | "roca";

const params = new URLSearchParams(location.search);
const MITAD = Number(params.get("mitad") ?? 6); // unidades de mundo visibles en el eje corto / 2 — TAMANO_MUNDO_VISIBLE real del juego es 16 (mitad=8); más bajo = más zoom para ver el detalle del patrón
const ANCHO_TILES = 32;
const ALTO_TILES = 20;
const PX_POR_TILE_B = 10; // resolución del patrón horneado (B) — 1px/tile es lo que hay HOY (panel A)
const PX_TEXTURA_C = 16; // tamaño del tile-fuente "de verdad" para el repetido por GPU (C)

function tipoEn(gx: number, gy: number): TerrenoId {
  if (gx < 9 && gy < 6) return "roca";
  if (gx >= ANCHO_TILES - 11 && gy >= ALTO_TILES - 8) return "agua";
  const medio = Math.floor(ALTO_TILES / 2);
  if (gy >= medio - 1 && gy <= medio + 1) return "camino";
  return "cesped";
}

// PRNG mulberry32 inlineado — mismo criterio ya usado en crearFichaVoxel.ts/
// generarAnimalVoxel.ts para no cruzar un require() de Node al bundle.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(gx: number, gy: number, sal: number): number {
  return ((gx * 374761393 + gy * 668265263 + sal * 2246822519) >>> 0) ^ 0x9e3779b9;
}
function aclarar(c: THREE.Color, cantidad: number): THREE.Color {
  return c.clone().lerp(new THREE.Color(1, 1, 1), Math.max(0, cantidad));
}
function oscurecer(c: THREE.Color, cantidad: number): THREE.Color {
  return c.clone().lerp(new THREE.Color(0, 0, 0), Math.max(0, cantidad));
}

/**
 * Dibuja UN bloque `tam`x`tam` con el patrón de un bioma en `ctx`, esquina
 * superior-izquierda en (x0,y0). `semilla` decide el ruido — llamarla con la
 * MISMA semilla en B (por casilla del mapa grande) y en C (semilla fija, es
 * el tile-fuente único) es lo que hace que el arte comparado sea idéntico:
 * lo único que cambia entre B y C es CÓMO se coloca ese arte, no el arte en sí.
 */
function dibujarPatronBioma(ctx: CanvasRenderingContext2D, tipo: TerrenoId, x0: number, y0: number, tam: number, semilla: number) {
  const rng = mulberry32(semilla);
  const base = new THREE.Color(colorTerreno(tipo));
  // relleno base con variación de tono píxel a píxel (mottled) — el mismo
  // recurso barato para las 4 texturas, la diferencia real está en los
  // detalles que se añaden encima.
  for (let py = 0; py < tam; py++) {
    for (let px = 0; px < tam; px++) {
      const variacion = (rng() - 0.5) * 0.12;
      const c = variacion >= 0 ? aclarar(base, variacion) : oscurecer(base, -variacion);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(x0 + px, y0 + py, 1, 1);
    }
  }
  if (tipo === "cesped") {
    // briznas: trazos verticales cortos más claros
    const brizas = Math.max(2, Math.round(tam * 0.6));
    for (let i = 0; i < brizas; i++) {
      const bx = x0 + Math.floor(rng() * tam);
      const by = y0 + Math.floor(rng() * tam);
      const largo = 1 + Math.floor(rng() * Math.max(1, tam * 0.25));
      ctx.fillStyle = `#${aclarar(base, 0.22).getHexString()}`;
      ctx.fillRect(bx, by, 1, Math.min(largo, tam - (by - y0)));
    }
    // florecillas aisladas, poco frecuentes
    const flores = Math.round(tam * tam * 0.01);
    const coloresFlor = ["#ffffff", "#e8c842", "#d44242"];
    for (let i = 0; i < flores; i++) {
      ctx.fillStyle = coloresFlor[Math.floor(rng() * coloresFlor.length)];
      ctx.fillRect(x0 + Math.floor(rng() * tam), y0 + Math.floor(rng() * tam), 1, 1);
    }
  } else if (tipo === "camino") {
    // guijarros: blobs de 2x2 más oscuros
    const guijarros = Math.max(1, Math.round(tam * tam * 0.02));
    for (let i = 0; i < guijarros; i++) {
      const gx = x0 + Math.floor(rng() * (tam - 1));
      const gy = y0 + Math.floor(rng() * (tam - 1));
      ctx.fillStyle = `#${oscurecer(base, 0.3 + rng() * 0.2).getHexString()}`;
      ctx.fillRect(gx, gy, 2, 2);
    }
  } else if (tipo === "agua") {
    // ondas: bandas horizontales sutiles moduladas por seno
    for (let py = 0; py < tam; py++) {
      const onda = Math.sin((py / tam) * Math.PI * 2 + semilla) * 0.06;
      ctx.fillStyle = `#${(onda >= 0 ? aclarar(base, onda) : oscurecer(base, -onda)).getHexString()}`;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x0, y0 + py, tam, 1);
      ctx.globalAlpha = 1;
    }
  } else if (tipo === "roca") {
    // mampostería: rejilla de juntas más oscuras, offset a hiladas alternas
    const junta = Math.max(1, Math.round(tam / 8));
    ctx.fillStyle = `#${oscurecer(base, 0.35).getHexString()}`;
    for (let hilada = 0; hilada * (tam / 4) < tam; hilada++) {
      const y = y0 + Math.round(hilada * (tam / 4));
      ctx.fillRect(x0, y, tam, junta);
      const offsetX = (hilada % 2) * Math.round(tam / 4);
      for (let vx = offsetX; vx < tam; vx += Math.round(tam / 2)) {
        ctx.fillRect(x0 + vx, y, junta, Math.round(tam / 4));
      }
    }
  }
}

function crearEtiqueta(texto: string): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = texto;
  div.style.cssText = "color:#fff;font:13px monospace;padding:4px 0;text-align:center;background:#111;";
  return div;
}

function crearRenderer(ancho: number, alto: number): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(ancho, alto);
  renderer.shadowMap.enabled = false;
  return renderer;
}

// Misma cámara isométrica fija que worldScene.ts::posicionarCamaraIsometrica.
function crearCamaraIso(ancho: number, alto: number, mitad: number, foco: THREE.Vector3): THREE.OrthographicCamera {
  const altoMundo = mitad * (alto / ancho);
  const camara = new THREE.OrthographicCamera(-mitad, mitad, altoMundo, -altoMundo, 0.1, 500);
  camara.position.set(foco.x + 20, 20, foco.z + 20);
  camara.lookAt(foco);
  camara.updateProjectionMatrix();
  return camara;
}

function escenaBase(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ea0c8);
  const luz = new THREE.DirectionalLight(0xffffff, 1.1);
  luz.position.set(30, 60, 20);
  scene.add(luz);
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  return scene;
}

function panelA(): THREE.Group {
  const grupo = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = ANCHO_TILES;
  canvas.height = ALTO_TILES;
  const ctx = canvas.getContext("2d")!;
  for (let gy = 0; gy < ALTO_TILES; gy++) {
    for (let gx = 0; gx < ANCHO_TILES; gx++) {
      ctx.fillStyle = colorTerreno(tipoEn(gx, gy));
      ctx.fillRect(gx, gy, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(ANCHO_TILES, ALTO_TILES),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  malla.rotation.x = -Math.PI / 2;
  malla.position.set(ANCHO_TILES / 2, 0, ALTO_TILES / 2);
  grupo.add(malla);
  return grupo;
}

function panelB(): THREE.Group {
  const grupo = new THREE.Group();
  const anchoPx = ANCHO_TILES * PX_POR_TILE_B;
  const altoPx = ALTO_TILES * PX_POR_TILE_B;
  const canvas = document.createElement("canvas");
  canvas.width = anchoPx;
  canvas.height = altoPx;
  const ctx = canvas.getContext("2d")!;
  for (let gy = 0; gy < ALTO_TILES; gy++) {
    for (let gx = 0; gx < ANCHO_TILES; gx++) {
      dibujarPatronBioma(ctx, tipoEn(gx, gy), gx * PX_POR_TILE_B, gy * PX_POR_TILE_B, PX_POR_TILE_B, hashSeed(gx, gy, 1));
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(ANCHO_TILES, ALTO_TILES),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  malla.rotation.x = -Math.PI / 2;
  malla.position.set(ANCHO_TILES / 2, 0, ALTO_TILES / 2);
  grupo.add(malla);
  return grupo;
}

/** Un plano rectangular por región de bioma, UV repetido `anchoTiles`x`altoTiles` veces sobre el MISMO tile-fuente pequeño — repetido de verdad por la GPU, no horneado. */
function planoRegionRepetida(tipo: TerrenoId, gx0: number, gy0: number, anchoTiles: number, altoTiles: number): THREE.Mesh {
  const fuente = document.createElement("canvas");
  fuente.width = PX_TEXTURA_C;
  fuente.height = PX_TEXTURA_C;
  const ctxFuente = fuente.getContext("2d")!;
  dibujarPatronBioma(ctxFuente, tipo, 0, 0, PX_TEXTURA_C, hashSeed(0, 0, tipo.charCodeAt(0)));
  const tex = new THREE.CanvasTexture(fuente);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.repeat.set(anchoTiles, altoTiles);
  const malla = new THREE.Mesh(
    new THREE.PlaneGeometry(anchoTiles, altoTiles),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }),
  );
  malla.rotation.x = -Math.PI / 2;
  malla.position.set(gx0 + anchoTiles / 2, 0.001, gy0 + altoTiles / 2); // +0.001: evita z-fighting con el césped de base
  return malla;
}

function panelC(): THREE.Group {
  const grupo = new THREE.Group();
  // Base de césped cubriendo TODO el rectángulo, y encima las 3 regiones
  // reales (roca/agua/camino) tapando su zona — mismo layout que tipoEn().
  grupo.add(planoRegionRepetida("cesped", 0, 0, ANCHO_TILES, ALTO_TILES));
  grupo.add(planoRegionRepetida("roca", 0, 0, 9, 6));
  grupo.add(planoRegionRepetida("agua", ANCHO_TILES - 11, ALTO_TILES - 8, 11, 8));
  const medio = Math.floor(ALTO_TILES / 2);
  grupo.add(planoRegionRepetida("camino", 0, medio - 1, ANCHO_TILES, 3));
  return grupo;
}

async function render(contenedor: HTMLElement, titulo: string, construirGrupo: () => THREE.Group) {
  const envoltorio = document.createElement("div");
  envoltorio.appendChild(crearEtiqueta(titulo));
  const anchoPx = 500;
  const altoPx = Math.round((anchoPx * ALTO_TILES) / ANCHO_TILES) + 60;
  const renderer = crearRenderer(anchoPx, altoPx);
  envoltorio.appendChild(renderer.domElement);
  contenedor.appendChild(envoltorio);

  const scene = escenaBase();
  scene.add(construirGrupo());
  const foco = new THREE.Vector3(ANCHO_TILES / 2, 0, ALTO_TILES / 2);
  const camara = crearCamaraIso(anchoPx, altoPx, MITAD, foco);
  renderer.render(scene, camara);
}

const raiz = document.createElement("div");
raiz.style.cssText = "display:flex;gap:6px;background:#111;padding:8px;";
document.body.appendChild(raiz);

await render(raiz, "A) ACTUAL — color plano por casilla", panelA);
await render(raiz, "B) patrón horneado (mismo sistema de hoy)", panelB);
await render(raiz, "C) textura real repetida por GPU", panelC);

(window as any).__listo = true;
