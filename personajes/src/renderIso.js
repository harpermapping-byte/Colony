"use strict";

// Mini-render isométrico SVG compartido por las galerías de prueba de
// personajes/ (PJs y animales) — misma proyección que interiores y ropa.
// REGLA (pactada con el streamer): toda caja se dibuja con sus 6 caras,
// las lejanas a cámara primero — nada se ve hueco desde ningún ángulo.

const U = 150;
const ANG = Math.PI / 6;

function proyectar(x, y, z) {
  return [(x - z) * Math.cos(ANG) * U, -(x + z) * Math.sin(ANG) * U - y * U];
}

function ajustarColor(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const aj = (c) => Math.max(0, Math.min(255, Math.round(c + factor * 255)));
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => aj(c).toString(16).padStart(2, "0")).join("");
}

function cara(puntos, color) {
  const pts = puntos.map(([x, y, z]) => proyectar(x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ");
  return `<polygon points="${pts}" fill="${color}" stroke="${color}" stroke-width="0.5"/>`;
}

// Caja centrada en (cx, cz), apoyada en y0, con TODAS sus caras.
function caja(cx, y0, cz, w, h, d, color) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y1 = y0 + h;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  return (
    // caras lejanas a cámara (izquierda, trasera, inferior) — cierran la silueta
    cara([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], ajustarColor(color, -0.34)) +
    cara([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], ajustarColor(color, -0.3)) +
    cara([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], ajustarColor(color, -0.38)) +
    // caras visibles de la isométrica (top / derecha / frente)
    cara([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], color) +
    cara([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], ajustarColor(color, -0.14)) +
    cara([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], ajustarColor(color, -0.26))
  );
}

module.exports = { proyectar, cara, caja, ajustarColor };
