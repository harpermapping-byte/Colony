"use strict";

/**
 * Generador de libros (docs/GDD_Libreria.md, pedido 2026-09-01) — lee
 * `items/catalogo/librosContenido.json` (la única cosa que el streamer edita
 * a mano: título, categoría/oficio, páginas) y mantiene sincronizada en
 * `items/catalogo/items.json` la entrada MECÁNICA de cada libro (nombre,
 * color de portada por categoría/oficio, tipo, peso/huella estándar de
 * cualquier libro) — nunca toca items.json a mano, mismo espíritu que
 * `nombreBonito.js` o los generadores de `taller-vox/`: se ejecuta offline,
 * cada vez que se añade o edita un libro en el catálogo de contenido.
 *
 * - Libro NUEVO (id que no existe en items.json todavía) → se AÑADE.
 * - Libro YA generado antes por este script (se reconoce por su `_nota`,
 *   ver `esGeneradoPorEsteScript`) → se REESCRIBE si `titulo`/`categoria`/
 *   `oficio` cambiaron (nombre/color al día); si nada cambió, la línea ni se
 *   toca. El TEXTO de las páginas nunca vive aquí — el cliente lo lee
 *   directo de `librosContenido.json` (panelLibro.ts), así que editar
 *   `paginas` en el archivo de contenido ya es instantáneo SIN ejecutar
 *   este script; solo título/categoría/oficio necesitan una pasada.
 * - Cualquier entrada de items.json que NO lleve esa `_nota` (p.ej.
 *   `libro_en_blanco_jugador`, dado de alta a mano) nunca se toca, aunque
 *   comparta el mismo id — protección extra, no debería poder pasar.
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

const NOTA_GENERADO = "docs/GDD_Libreria.md — generado desde items/catalogo/librosContenido.json";

function esGeneradoPorEsteScript(entradaItems) {
  return typeof entradaItems?._nota === "string" && entradaItems._nota.startsWith(NOTA_GENERADO);
}

function objetoDe(id, entrada) {
  return {
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
    _nota: `${NOTA_GENERADO} (${id}), no editar a mano.`,
  };
}

function main() {
  const contenido = JSON.parse(fs.readFileSync(RUTA_CONTENIDO, "utf8"));
  let textoItems = fs.readFileSync(RUTA_ITEMS, "utf8");
  const itemsExistentes = JSON.parse(textoItems);

  const ANCLA = '"puesto_mercado_jugador": {"nombre":"Puesto de Mercado de Jugador","tipo":"recurso","huella":[2,1],"peso":12,"apilable":false,"stackMax":1,"variantes":1,"colorDebug":"#b8863c","_nota":"docs/GDD_Mercado.md §12 — se craftea con \\"puesto_mercado_jugador_craft\\" (carpintero N2) y se coloca como mueble homónimo (requiereItemColocar), igual que silla_pino/mesa_comedor_pino."},';
  const posAncla = textoItems.indexOf(ANCLA);
  if (posAncla === -1) {
    console.error("No se encontró el ancla de inserción en items.json (¿se movió/editó la entrada puesto_mercado_jugador?). Aborto sin tocar nada.");
    process.exit(1);
  }

  const lineasNuevas = [];
  const actualizados = [];
  const omitidos = [];
  for (const [id, entrada] of Object.entries(contenido)) {
    if (id.startsWith("_")) continue;
    if (!entrada.titulo || !Array.isArray(entrada.paginas) || entrada.paginas.length === 0) {
      console.error(`Libro "${id}" sin titulo o sin paginas — se omite.`);
      continue;
    }

    const existente = itemsExistentes[id];
    if (!existente) {
      lineasNuevas.push(`  "${id}": ${JSON.stringify(objetoDe(id, entrada))},`);
      continue;
    }
    if (!esGeneradoPorEsteScript(existente)) {
      omitidos.push(id); // entrada dada de alta a mano (p.ej. libro_en_blanco_jugador) — nunca se toca
      continue;
    }
    const objetoNuevo = objetoDe(id, entrada);
    if (JSON.stringify(objetoNuevo) === JSON.stringify(existente)) continue; // sin cambios reales, no tocar la línea

    // Reescribe la línea EXACTA de esta entrada, sin reformatear el resto del fichero.
    const patron = new RegExp(`^ {2}"${id}": \\{.*\\},$`, "m");
    if (!patron.test(textoItems)) {
      console.error(`No se encontró la línea de "${id}" en items.json con el formato esperado — se omite para no arriesgar el fichero.`);
      continue;
    }
    textoItems = textoItems.replace(patron, `  "${id}": ${JSON.stringify(objetoNuevo)},`);
    actualizados.push(id);
  }

  if (lineasNuevas.length > 0) {
    const insercion = "\n" + lineasNuevas.join("\n");
    textoItems = textoItems.slice(0, posAncla + ANCLA.length) + insercion + textoItems.slice(posAncla + ANCLA.length);
  }

  if (lineasNuevas.length === 0 && actualizados.length === 0) {
    console.log("Nada que generar ni actualizar — items.json ya coincide con librosContenido.json.");
    return;
  }

  fs.writeFileSync(RUTA_ITEMS, textoItems);
  if (lineasNuevas.length > 0) console.log(`Nuevos: ${lineasNuevas.map((l) => l.trim().split('"')[1]).join(", ")}`);
  if (actualizados.length > 0) console.log(`Actualizados: ${actualizados.join(", ")}`);
  if (omitidos.length > 0) console.log(`Omitidos (no generados por este script, dados de alta a mano): ${omitidos.join(", ")}`);
}

main();
