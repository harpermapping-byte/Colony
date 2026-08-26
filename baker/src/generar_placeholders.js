#!/usr/bin/env node
"use strict";

// Genera un archivo PNG real por cada entrada del catálogo (y cada
// variante), en assets/ — para que haya algo físico que localizar y
// sustituir por arte de verdad, no solo colores de depuración en código.
// No dibuja nada bonito a propósito: son placeholders, cuanto más simple
// mejor, lo importante es que exista el archivo con el nombre correcto.

const fs = require("fs");
const path = require("path");
const { codificarPNG } = require("./png");

function cargarJSON(ruta) {
  return JSON.parse(fs.readFileSync(ruta, "utf8"));
}

function hexARGB(hex) {
  const limpio = (hex || "#888888").replace("#", "");
  return {
    r: parseInt(limpio.substring(0, 2), 16),
    g: parseInt(limpio.substring(2, 4), 16),
    b: parseInt(limpio.substring(4, 6), 16),
  };
}

function aclarar({ r, g, b }, factor) {
  return {
    r: Math.min(255, Math.round(r + (255 - r) * factor)),
    g: Math.min(255, Math.round(g + (255 - g) * factor)),
    b: Math.min(255, Math.round(b + (255 - b) * factor)),
  };
}

function crearImagenTile(color, tamano) {
  const rgba = Buffer.alloc(tamano * tamano * 4);
  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      const borde = x === 0 || y === 0 || x === tamano - 1 || y === tamano - 1;
      const i = (y * tamano + x) * 4;
      rgba[i] = borde ? Math.max(0, color.r - 30) : color.r;
      rgba[i + 1] = borde ? Math.max(0, color.g - 30) : color.g;
      rgba[i + 2] = borde ? Math.max(0, color.b - 30) : color.b;
      rgba[i + 3] = 255;
    }
  }
  return codificarPNG(tamano, tamano, rgba);
}

function crearImagenCirculo(color, tamano) {
  const rgba = Buffer.alloc(tamano * tamano * 4, 0); // transparente fuera del círculo
  const cx = tamano / 2;
  const cy = tamano / 2;
  const radio = tamano / 2 - 1;
  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      const i = (y * tamano + x) * 4;
      if (d <= radio) {
        const esBorde = d >= radio - 1.5;
        rgba[i] = esBorde ? Math.max(0, color.r - 40) : color.r;
        rgba[i + 1] = esBorde ? Math.max(0, color.g - 40) : color.g;
        rgba[i + 2] = esBorde ? Math.max(0, color.b - 40) : color.b;
        rgba[i + 3] = 255;
      }
    }
  }
  return codificarPNG(tamano, tamano, rgba);
}

function escribir(rutaRelativa, buffer) {
  const rutaAbs = path.join(__dirname, "..", "..", "assets", rutaRelativa);
  fs.mkdirSync(path.dirname(rutaAbs), { recursive: true });
  fs.writeFileSync(rutaAbs, buffer);
  return rutaRelativa;
}

function main() {
  const carpetaCatalogo = path.join(__dirname, "..", "catalogo");
  let total = 0;

  // Terrenos: una textura de tile por tipo (32x32).
  const terrenos = cargarJSON(path.join(carpetaCatalogo, "terrenos.json"));
  for (const [id, datos] of Object.entries(terrenos)) {
    const color = hexARGB(datos.colorDebug);
    escribir(`terrenos/${id}.png`, crearImagenTile(color, 32));
    total++;
  }

  // Vegetación, animales, rocas: un círculo por variante de cada especie.
  const categorias = [
    ["vegetacion", "vegetacion.json"],
    ["animales", "animales.json"],
    ["rocas", "rocas.json"],
  ];
  for (const [carpeta, archivo] of categorias) {
    const catalogo = cargarJSON(path.join(carpetaCatalogo, archivo));
    for (const [id, datos] of Object.entries(catalogo)) {
      if (id.startsWith("_")) continue;
      const colorBase = hexARGB(datos.colorDebug);
      const numVariantes = datos.variantes || 1;
      for (let v = 1; v <= numVariantes; v++) {
        // Variantes ligeramente distintas de tono, solo para que se
        // distingan a simple vista mientras sigan siendo placeholders.
        const color = aclarar(colorBase, (v - 1) * 0.08);
        escribir(`${carpeta}/${id}_${String(v).padStart(2, "0")}.png`, crearImagenCirculo(color, 24));
        total++;
      }
    }
  }

  console.log(`Generados ${total} archivos de placeholder en assets/`);
}

main();
