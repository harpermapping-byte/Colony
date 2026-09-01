"use strict";

/**
 * Generador de libros (docs/GDD_Libreria.md, pedido 2026-09-01) — lee
 * `items/catalogo/librosContenido.json` (la única cosa que el streamer edita
 * a mano: título, categoría/oficio, páginas) y AÑADE a `items/catalogo/
 * items.json` la entrada mecánica que le falta a cada libro nuevo (nombre,
 * color de portada por categoría/oficio, tipo, peso/huella estándar de
 * cualquier libro) — nunca toca items.json a mano, mismo espíritu que
 * `nombreBonito.js` o los generadores de `taller-vox/`: se ejecuta offline,
 * una vez por cada libro nuevo que se añada al catálogo de contenido.
 *
 * Idempotente: un libro que YA tiene entrada en items.json no se toca de
 * nuevo (así el streamer puede rehacer el texto de un libro sin perder
 * cambios manuales que alguien haya hecho a su entrada de items.json,
 * aunque en la práctica no debería hacer falta tocarla nunca a mano).
 *
 * Uso: node items/catalogo/generarLibros.js
 */
const fs = require("fs");
const path = require("path");

const RUTA_CONTENIDO = path.join(__dirname, "librosContenido.json");
const RUTA_ITEMS = path.join(__dirname, "items.json");

// Un color de portada por oficio (docs/GDD_Libreria.md — pedido explícito:
// "cada oficio debe tener un color asignado a un libro") + uno para lore y
// otro para mecánica (fixed-text, "tutoriales, lore, normas, memes..." del
// pedido — se separan en dos colores en vez de compartir uno solo porque
// cuesta cero y ordena mejor la estantería) + uno para el libro en blanco
// del jugador (ese vive directo en items.json, no aquí, pero se documenta
// el mismo color por si algún día se generase también desde este archivo).
const COLOR_POR_OFICIO = {
  herrero: "#8a3a2a",
  carpintero: "#8a6a3a",
  ingeniero: "#5a6a7a",
  picapedrero: "#7a7a72",
  molinero: "#c9a85a",
  cazador: "#3a5a3a",
  cocinero: "#a84a3a",
  curandero: "#4a8a5a",
  curtidor: "#7a5a3a",
  joyero: "#7a3a8a",
};
const COLOR_LORE = "#2a3a6a";
const COLOR_MECANICA = "#2a7a7a";
const COLOR_JUGADOR = "#d8cfa0"; // referencia — el blanco del jugador se da de alta a mano en items.json, no por este generador

function colorDe(entrada) {
  if (entrada.categoria === "oficio") return COLOR_POR_OFICIO[entrada.oficio] ?? "#6a6a6a";
  if (entrada.categoria === "mecanica") return COLOR_MECANICA;
  return COLOR_LORE;
}

function main() {
  const contenido = JSON.parse(fs.readFileSync(RUTA_CONTENIDO, "utf8"));
  const textoItems = fs.readFileSync(RUTA_ITEMS, "utf8");
  const itemsExistentes = JSON.parse(textoItems);

  const ANCLA = '"puesto_mercado_jugador": {"nombre":"Puesto de Mercado de Jugador","tipo":"recurso","huella":[2,1],"peso":12,"apilable":false,"stackMax":1,"variantes":1,"colorDebug":"#b8863c","_nota":"docs/GDD_Mercado.md §12 — se craftea con \\"puesto_mercado_jugador_craft\\" (carpintero N2) y se coloca como mueble homónimo (requiereItemColocar), igual que silla_pino/mesa_comedor_pino."},';
  const posAncla = textoItems.indexOf(ANCLA);
  if (posAncla === -1) {
    console.error("No se encontró el ancla de inserción en items.json (¿se movió/editó la entrada puesto_mercado_jugador?). Aborto sin tocar nada.");
    process.exit(1);
  }

  const lineasNuevas = [];
  for (const [id, entrada] of Object.entries(contenido)) {
    if (id.startsWith("_")) continue;
    if (itemsExistentes[id]) continue; // ya generado antes — nunca se pisa
    if (!entrada.titulo || !Array.isArray(entrada.paginas) || entrada.paginas.length === 0) {
      console.error(`Libro "${id}" sin titulo o sin paginas — se omite.`);
      continue;
    }
    const objeto = {
      nombre: entrada.titulo,
      tipo: "libro",
      huella: [1, 1],
      peso: 0.3,
      apilable: false,
      stackMax: 1,
      variantes: 1,
      colorDebug: colorDe(entrada),
      categoriaLibro: entrada.categoria,
      ...(entrada.oficio ? { oficioLibro: entrada.oficio } : {}),
      _nota: `docs/GDD_Libreria.md — generado desde items/catalogo/librosContenido.json (${id}), no editar a mano.`,
    };
    lineasNuevas.push(`  "${id}": ${JSON.stringify(objeto)},`);
  }

  if (lineasNuevas.length === 0) {
    console.log("Nada nuevo que generar — items.json ya tiene entrada para todos los libros de librosContenido.json.");
    return;
  }

  const insercion = "\n" + lineasNuevas.join("\n");
  const nuevoTexto = textoItems.slice(0, posAncla + ANCLA.length) + insercion + textoItems.slice(posAncla + ANCLA.length);
  fs.writeFileSync(RUTA_ITEMS, nuevoTexto);
  console.log(`Generados ${lineasNuevas.length} libro(s) nuevo(s) en items.json:`, lineasNuevas.map((l) => l.trim().split('"')[1]).join(", "));
}

main();
