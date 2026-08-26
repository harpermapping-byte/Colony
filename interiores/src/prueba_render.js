"use strict";

// Prueba visual del prototipo de colocación (colocarElementos.js) — genera
// unas pocas salas de ejemplo y las dibuja en planta (vista desde arriba,
// colores colorDebug del catálogo) para poder ver de un vistazo si el
// catálogo se está usando bien: reglas de colocación, riqueza, amueblado.
// No es el motor final (la forma de la sala sigue siendo un rectángulo, no
// WFC) — es la pieza mínima para probar de verdad lo que ya hay.

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { colocarSala } = require("./colocarElementos");

const catalogos = cargarCatalogos();

const PRUEBAS = [
  { titulo: "dormitorio_doble — vacío", tipoSalaId: "dormitorio_doble", riqueza: "modesta", amueblado: "vacio", semilla: "prueba-01" },
  { titulo: "dormitorio_doble — fijo", tipoSalaId: "dormitorio_doble", riqueza: "modesta", amueblado: "fijo", semilla: "prueba-01" },
  { titulo: "dormitorio_doble — completo", tipoSalaId: "dormitorio_doble", riqueza: "modesta", amueblado: "completo", semilla: "prueba-01" },
  { titulo: "cocina_comedor — completo", tipoSalaId: "cocina_comedor", riqueza: "humilde", amueblado: "completo", semilla: "prueba-02" },
  { titulo: "gran_salon — completo (noble)", tipoSalaId: "gran_salon", riqueza: "noble", amueblado: "completo", semilla: "prueba-03" },
];

const TILE = 28; // px por casilla en el SVG

function escaparXML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSalaSVG(resultado) {
  const { ancho, largo, materialSuelo, materialPared, puerta, colocados, colgados, techo } = resultado;
  const w = ancho * TILE;
  const h = largo * TILE;
  const colorSuelo = catalogos.materiales[materialSuelo]?.colorDebug || "#c9b896";
  const colorPared = catalogos.materiales[materialPared]?.colorDebug || "#8a8a8a";

  let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" font-family="monospace">`;
  // Suelo interior
  svg += `<rect x="0" y="0" width="${w}" height="${h}" fill="${colorPared}"/>`;
  svg += `<rect x="${TILE}" y="${TILE}" width="${w - 2 * TILE}" height="${h - 2 * TILE}" fill="${colorSuelo}"/>`;
  // Puerta (hueco en el muro)
  svg += `<rect x="${(puerta.x - 0.5) * TILE}" y="${puerta.y === largo - 1 ? h - TILE : 0}" width="${TILE * 2}" height="${TILE}" fill="${colorSuelo}"/>`;
  svg += `<text x="${puerta.x * TILE}" y="${puerta.y === largo - 1 ? h - 4 : TILE - 4}" font-size="9" fill="#333" text-anchor="middle">puerta</text>`;

  // Mobiliario en suelo (huella real)
  for (const c of colocados) {
    const x = c.x * TILE;
    const y = c.y * TILE;
    const cw = c.ancho * TILE;
    const ch = c.largo * TILE;
    svg += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" fill="${c.colorDebug || "#999"}" stroke="#222" stroke-width="1" rx="3"/>`;
    svg += `<text x="${x + cw / 2}" y="${y + ch / 2}" font-size="7" fill="#000" text-anchor="middle" dominant-baseline="middle">${escaparXML(c.id.slice(0, 10))}</text>`;
    if (c.sobre && c.sobre.length) {
      svg += `<text x="${x + cw / 2}" y="${y + ch / 2 + 9}" font-size="6" fill="#333" text-anchor="middle">+${c.sobre.map((s) => s.id).join(",").slice(0, 20)}</text>`;
    }
  }

  // Elementos colgados en pared (marcador pequeño sobre el muro)
  for (const c of colgados) {
    const x = c.x * TILE + TILE / 2;
    const y = c.y * TILE + TILE / 2;
    svg += `<circle cx="${x}" cy="${y}" r="6" fill="${c.colorDebug || "#999"}" stroke="#222" stroke-width="1"/>`;
  }

  svg += `<text x="4" y="12" font-size="9" fill="#000">techo: ${techo.map((t) => t.id).join(", ") || "(ninguno)"}</text>`;
  svg += `</svg>`;
  return svg;
}

function construirHTML() {
  const bloques = PRUEBAS.map((p) => {
    const r = colocarSala({ tipoSalaId: p.tipoSalaId, catalogos, riqueza: p.riqueza, amueblado: p.amueblado, semilla: p.semilla });
    const nDecor = r.colocados.length + r.colgados.length;
    const nSuperficie = r.colocados.reduce((s, c) => s + (c.sobre ? c.sobre.length : 0), 0);
    return `
      <div class="sala">
        <h2>${escaparXML(p.titulo)}</h2>
        <p class="meta">${r.ancho}x${r.largo} tiles · suelo ${r.materialSuelo} · pared ${r.materialPared} · ${nDecor} piezas${nSuperficie ? ` + ${nSuperficie} objetos de superficie` : ""}</p>
        ${renderSalaSVG(r)}
      </div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Prueba colocarElementos</title>
  <style>
    body { background:#1a1a1a; color:#eee; font-family: sans-serif; padding: 20px; }
    .grid { display: flex; flex-wrap: wrap; gap: 24px; }
    .sala { background:#242424; padding: 12px; border-radius: 8px; }
    h2 { font-size: 14px; margin: 0 0 4px; }
    .meta { font-size: 11px; color: #aaa; margin: 0 0 8px; }
    svg { display: block; background: #333; }
  </style></head><body>
  <h1>Prototipo de colocación de interiores — prueba real</h1>
  <div class="grid">${bloques}</div>
  </body></html>`;
}

const salida = path.join("/tmp/claude-0/-home-user-Secret/75acf9b9-60f3-587e-9641-8725192b1416/scratchpad", "prueba-interiores.html");
fs.writeFileSync(salida, construirHTML());
console.log("Escrito:", salida);
