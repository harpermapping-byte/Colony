"use strict";

// Empaquetado tipo BSP de una lista de rectángulos YA DIMENSIONADOS (no
// parte de un rectángulo vacío que subdividir con reglas de arquitectura —
// eso sigue pendiente, GDD_Bakeador_Interiores sección 2 — los tamaños de
// cada sala ya los decide `colocarSala` antes de llegar aquí) en una
// disposición 2D compacta: agrupa la lista por mitades recursivamente,
// alternando el eje de unión (lado a lado / apilado) a cada nivel, con 1
// casilla real de separación entre cualquier par de cajas — mismo
// invariante que el resto de `edificio.js` ("el muro no ocupa casilla
// propia", `colocarElementos.js`). Sustituye la fila 1D de `generarPlanta`
// SOLO para el caso "sin pasillo": con pasillo, la columna vertebral sigue
// siendo la estrategia de siempre (más simple y ya probada), sin tocar.
//
// Alineación SIEMPRE a la esquina superior-izquierda de cada caja (nunca
// centrada): no es solo más simple, es lo que GARANTIZA matemáticamente
// que cada par de cajas hermanas en el árbol queda con solape real en el
// eje perpendicular (mínimo min(dimA, dimB) >= 1) — con centrado, un
// redondeo desafortunado podría dejar dos hermanas sin solape real y por
// tanto sin forma de punzar una puerta entre ellas. Con esquina fija, la
// primera hoja (la más "arriba-izquierda") de cada mitad del árbol siempre
// queda pegada a la primera hoja de la otra mitad — conectividad
// garantizada por construcción, verificada con `paresAdyacentes` sobre la
// lista plana de resultados, no sobre el árbol (no hace falta recorrerlo
// dos veces).

const GAP = 1;

function construirArbolBSP(items, profundidad = 0) {
  if (items.length === 1) return { tipo: "hoja", item: items[0] };
  const mitad = Math.ceil(items.length / 2);
  const grupoA = items.slice(0, mitad);
  const grupoB = items.slice(mitad);
  const eje = profundidad % 2 === 0 ? "h" : "v"; // h = lado a lado (eje X), v = apilado (eje Y)
  return { tipo: "nodo", eje, a: construirArbolBSP(grupoA, profundidad + 1), b: construirArbolBSP(grupoB, profundidad + 1) };
}

function calcularTamano(nodo) {
  if (nodo.tipo === "hoja") {
    nodo._tam = { ancho: nodo.item.ancho, largo: nodo.item.largo };
    return nodo._tam;
  }
  const tamA = calcularTamano(nodo.a);
  const tamB = calcularTamano(nodo.b);
  nodo._tam = nodo.eje === "h"
    ? { ancho: tamA.ancho + GAP + tamB.ancho, largo: Math.max(tamA.largo, tamB.largo) }
    : { ancho: Math.max(tamA.ancho, tamB.ancho), largo: tamA.largo + GAP + tamB.largo };
  return nodo._tam;
}

function posicionar(nodo, offsetX, offsetY) {
  if (nodo.tipo === "hoja") {
    nodo.item.offsetX = offsetX;
    nodo.item.offsetY = offsetY;
    return;
  }
  const { a, b, eje } = nodo;
  const tamA = a._tam;
  if (eje === "h") {
    posicionar(a, offsetX, offsetY);
    posicionar(b, offsetX + tamA.ancho + GAP, offsetY);
  } else {
    posicionar(a, offsetX, offsetY);
    posicionar(b, offsetX, offsetY + tamA.largo + GAP);
  }
}

// Empaqueta `items` (cada uno con {ancho,largo} ya fijados; cada objeto
// recibe offsetX/offsetY añadidos in situ) y devuelve el tamaño total del
// rectángulo que los contiene a todos.
function empaquetarBSP(items) {
  if (items.length === 0) return { ancho: 0, largo: 0 };
  const arbol = construirArbolBSP(items);
  const tamTotal = calcularTamano(arbol);
  posicionar(arbol, 0, 0);
  return { ancho: tamTotal.ancho, largo: tamTotal.largo };
}

// Pares de items realmente adyacentes tras `empaquetarBSP` (hueco de
// exactamente 1 casilla + solape real en el eje perpendicular) — no hace
// falta recorrer el árbol para esto: con el invariante de separación
// constante (GAP=1) y alineación de esquina fija en todos los niveles,
// cualquier par de cajas que quedaron "tocándose" a través de ese hueco de
// 1 casilla lo está de verdad, venga del nivel del árbol que venga. Cada
// entrada trae el rango exacto de solape para que quien llame pueda
// punzar la puerta con el mismo criterio de margen que ya usa
// `generarHabitacionCompuestaL` (abertura ancha, no una sola casilla).
function paresAdyacentes(items) {
  const pares = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i];
      const B = items[j];
      if (B.offsetX === A.offsetX + A.ancho + GAP || A.offsetX === B.offsetX + B.ancho + GAP) {
        const [izq, der] = B.offsetX > A.offsetX ? [A, B] : [B, A];
        const inicio = Math.max(izq.offsetY, der.offsetY);
        const fin = Math.min(izq.offsetY + izq.largo, der.offsetY + der.largo);
        if (fin > inicio) pares.push({ a: izq, b: der, eje: "h", limite: izq.offsetX + izq.ancho, inicio, fin });
      }
      if (B.offsetY === A.offsetY + A.largo + GAP || A.offsetY === B.offsetY + B.largo + GAP) {
        const [arriba, abajo] = B.offsetY > A.offsetY ? [A, B] : [B, A];
        const inicio = Math.max(arriba.offsetX, abajo.offsetX);
        const fin = Math.min(arriba.offsetX + arriba.ancho, abajo.offsetX + abajo.ancho);
        if (fin > inicio) pares.push({ a: arriba, b: abajo, eje: "v", limite: arriba.offsetY + arriba.largo, inicio, fin });
      }
    }
  }
  return pares;
}

module.exports = { empaquetarBSP, paresAdyacentes };
