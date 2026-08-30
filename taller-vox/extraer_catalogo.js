"use strict";
// Regenera catalogo_extraido.json desde interiores/catalogo/elementos.json —
// mismo filtro que la fusión de "mueble" en server/src/construccion/catalogo.ts
// (excluye capa:"estructural" y specialModifier de ENEMIGO; exige `huella`),
// para que generar_modelos.js no dependa de un snapshot manual desfasado.
// Pedido 2026-08-30: además de los campos de siempre, ahora extrae
// `materialesCompatibles` y `variantesNombradas` (antes ausentes del
// snapshot, así que el generador de vóxeles no podía usarlos aunque el
// diseño ya los definía).
//
//   node extraer_catalogo.js

const fs = require("fs");
const path = require("path");

const RUTA_ELEMENTOS = path.join(__dirname, "..", "interiores", "catalogo", "elementos.json");
const RUTA_SALIDA = path.join(__dirname, "catalogo_extraido.json");

const bruto = JSON.parse(fs.readFileSync(RUTA_ELEMENTOS, "utf8"));
const salida = {};
let excluidosEstructural = 0, excluidosEnemigo = 0, excluidosSinHuella = 0;

for (const [id, d] of Object.entries(bruto)) {
  if (id.startsWith("_")) continue;
  if (d.capa === "estructural") { excluidosEstructural++; continue; }
  if (typeof d.specialModifier === "string" && d.specialModifier.includes("ENEMIGO")) { excluidosEnemigo++; continue; }
  if (!d.huella) { excluidosSinHuella++; continue; }
  salida[id] = {
    huella: d.huella,
    colorDebug: d.colorDebug,
    capa: d.capa,
    anchorType: d.anchorType,
    esContenedor: !!d.esContenedor,
    esSuperficie: !!d.esSuperficie,
    colocacion: d.colocacion || [],
    materialesCompatibles: d.materialesCompatibles || [],
    variantesNombradas: d.variantesNombradas || [],
  };
}

fs.writeFileSync(RUTA_SALIDA, JSON.stringify(salida, null, 2));
console.log(`Extraídas ${Object.keys(salida).length} piezas de ${Object.keys(bruto).length - 1} entradas de elementos.json`);
console.log(`Excluidas: ${excluidosEstructural} estructurales, ${excluidosEnemigo} enemigos, ${excluidosSinHuella} sin huella`);
