"use strict";
// Herramientas geométricas del bakeador orgánico de ciudades. Todo trabaja
// en CASILLAS (floats permitidos) sobre el mismo plano top-down del motor:
// x→este, y→sur, origen arriba-izquierda.

// --- Poisson disk sampling (dardos con rechazo) -----------------------------
// Genera puntos con distancia mínima `rmin` dentro de la zona que acepte
// `valido(x,y)`. Con rechazo simple basta: las ciudades son pequeñas y el
// bake es offline — la elegancia de la rejilla de Bridson no compensa aquí.
function muestrearPoisson(rnd, { ancho, alto, rmin, maxPuntos, valido, intentos = 40 }) {
  const puntos = [];
  const rmin2 = rmin * rmin;
  let fallosSeguidos = 0;
  while (puntos.length < maxPuntos && fallosSeguidos < intentos * maxPuntos) {
    const x = rnd() * ancho;
    const y = rnd() * alto;
    if (!valido(x, y)) { fallosSeguidos++; continue; }
    let libre = true;
    for (const p of puntos) {
      const dx = p.x - x, dy = p.y - y;
      if (dx * dx + dy * dy < rmin2) { libre = false; break; }
    }
    if (!libre) { fallosSeguidos++; continue; }
    puntos.push({ x, y });
    fallosSeguidos = 0;
  }
  return puntos;
}

// Cola de prioridad binaria (min-heap) por f — mismo patrón que
// baker/src/caminos.js:ColaPrioridad (no exportada de ahí, se repite aquí:
// son ~25 líneas sin dependencias, y las dos búsquedas trabajan sobre
// esquemas de rejilla distintos). Sin esto, extraer el nodo de menor f es
// un recorrido lineal de TODO el conjunto abierto en cada paso — O(n) por
// extracción en vez de O(log n) (encontrado en la auditoría de rendimiento
// de 2026-09-02: el comentario de más abajo llevaba tiempo afirmando
// "inserción binaria" que el código nunca hacía de verdad).
class ColaPrioridad {
  constructor() {
    this.datos = []; // [{ id, f }]
  }
  get size() {
    return this.datos.length;
  }
  insertar(id, f) {
    this.datos.push({ id, f });
    let i = this.datos.length - 1;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (this.datos[padre].f <= this.datos[i].f) break;
      [this.datos[padre], this.datos[i]] = [this.datos[i], this.datos[padre]];
      i = padre;
    }
  }
  extraerMinimo() {
    const min = this.datos[0];
    const ultimo = this.datos.pop();
    if (this.datos.length > 0) {
      this.datos[0] = ultimo;
      let i = 0;
      while (true) {
        const izq = 2 * i + 1;
        const der = 2 * i + 2;
        let menor = i;
        if (izq < this.datos.length && this.datos[izq].f < this.datos[menor].f) menor = izq;
        if (der < this.datos.length && this.datos[der].f < this.datos[menor].f) menor = der;
        if (menor === i) break;
        [this.datos[menor], this.datos[i]] = [this.datos[i], this.datos[menor]];
        i = menor;
      }
    }
    return min;
  }
}

// --- A* sobre rejilla con coste por casilla ---------------------------------
// 8 vecinos (diagonal √2) y coste devuelto por `costeDe(x,y)` (Infinity =
// intransitable). Los caminos "esquivan" colinas y ríos porque subir y
// mojarse CUESTA, no porque estén prohibidos — si aún así compensa cruzar
// agua, esa casilla será un puente. `maxNodosExplorados` (mismo criterio que
// baker/src/caminos.js) es la red de seguridad si el destino resulta
// inalcanzable: sin tope, la búsqueda explora el mapa entero antes de
// rendirse.
function aEstrella(ancho, alto, inicio, fin, costeDe, maxNodosExplorados = 200000) {
  const clave = (x, y) => y * ancho + x;
  const gScore = new Map([[clave(inicio.x, inicio.y), 0]]);
  const desde = new Map();
  const h = (x, y) => Math.hypot(x - fin.x, y - fin.y);
  const cola = new ColaPrioridad();
  cola.insertar(clave(inicio.x, inicio.y), h(inicio.x, inicio.y));
  const cerrado = new Set();
  const VECINOS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
  ];

  let explorados = 0;
  while (cola.size > 0) {
    const { id: kActual } = cola.extraerMinimo();
    if (cerrado.has(kActual)) continue; // entrada obsoleta del heap (no hay decrease-key), se ignora
    cerrado.add(kActual);
    explorados++;
    if (explorados > maxNodosExplorados) return null;

    const actual = { x: kActual % ancho, y: Math.floor(kActual / ancho) };
    if (actual.x === fin.x && actual.y === fin.y) {
      const camino = [{ x: fin.x, y: fin.y }];
      let k = kActual;
      while (desde.has(k)) {
        k = desde.get(k);
        camino.push({ x: k % ancho, y: Math.floor(k / ancho) });
      }
      return camino.reverse();
    }
    for (const [dx, dy, paso] of VECINOS) {
      const nx = actual.x + dx, ny = actual.y + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
      const kVecino = clave(nx, ny);
      if (cerrado.has(kVecino)) continue;
      const coste = costeDe(nx, ny);
      if (!isFinite(coste)) continue;
      const g = gScore.get(kActual) + paso * coste;
      if (g >= (gScore.get(kVecino) ?? Infinity)) continue;
      desde.set(kVecino, kActual);
      gScore.set(kVecino, g);
      cola.insertar(kVecino, g + h(nx, ny));
    }
  }
  return null; // sin ruta
}

// --- polígonos --------------------------------------------------------------
function puntoEnPoligono(px, py, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i], b = poligono[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

function distanciaASegmento(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

// Recorre las casillas cuyo centro queda a <= grosor/2 del segmento y llama
// a pintar(x, y). Es el rasterizador de murallas/caminos vectoriales.
function rasterizarSegmento(a, b, grosor, ancho, alto, pintar) {
  const margen = grosor / 2 + 1;
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - margen));
  const x1 = Math.min(ancho - 1, Math.ceil(Math.max(a.x, b.x) + margen));
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - margen));
  const y1 = Math.min(alto - 1, Math.ceil(Math.max(a.y, b.y) + margen));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (distanciaASegmento(x + 0.5, y + 0.5, a, b) <= grosor / 2) pintar(x, y);
}

// Rasteriza un rectángulo ROTADO (centro, semiejes, ángulo en radianes):
// las fachadas de los edificios apuntan al camino, no a los ejes del mapa.
function rasterizarRectRotado(cx, cy, semiAncho, semiAlto, angulo, ancho, alto, pintar) {
  const cos = Math.cos(-angulo), sin = Math.sin(-angulo);
  const radio = Math.hypot(semiAncho, semiAlto) + 1;
  const x0 = Math.max(0, Math.floor(cx - radio)), x1 = Math.min(ancho - 1, Math.ceil(cx + radio));
  const y0 = Math.max(0, Math.floor(cy - radio)), y1 = Math.min(alto - 1, Math.ceil(cy + radio));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
      if (Math.abs(lx) <= semiAncho && Math.abs(ly) <= semiAlto) pintar(x, y);
    }
}

module.exports = {
  muestrearPoisson,
  aEstrella,
  puntoEnPoligono,
  distanciaASegmento,
  rasterizarSegmento,
  rasterizarRectRotado,
};
