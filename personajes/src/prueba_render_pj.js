"use strict";

// Galería visual del generador de personajes: 8 individuos de los 4 NPCs
// de prueba, cada uno con su morfología, piel, pelo, barba y ojos salidos
// del generador determinista — para comprobar DE UN VISTAZO que hay
// variedad real (alturas, anchuras, calvos/melenas/coletas, canosos...).
// Misma proyección isométrica que ropa/src/prueba_render_voxel.js.
// Uso: node personajes/src/prueba_render_pj.js
// PNG:  NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node personajes/src/prueba_render_png.js

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { generarPersonaje, ajustarColor } = require("./generarPersonaje");

const catalogos = cargarCatalogos();

const PRUEBAS = [
  { npcId: "aldeano", semilla: "npc-001" },
  { npcId: "aldeano", semilla: "npc-002" },
  { npcId: "aldeano", semilla: "npc-003" },
  { npcId: "herrero", semilla: "npc-001" },
  { npcId: "herrero", semilla: "npc-002" },
  { npcId: "guardia", semilla: "npc-001" },
  { npcId: "guardia", semilla: "npc-002" },
  { npcId: "anciano_sabio", semilla: "npc-001" },
];

const U = 150;
const ANG = Math.PI / 6;

function proyectar(x, y, z) {
  return [(x - z) * Math.cos(ANG) * U, -(x + z) * Math.sin(ANG) * U - y * U];
}

function cara(puntos, color) {
  const pts = puntos.map(([x, y, z]) => proyectar(x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ");
  return `<polygon points="${pts}" fill="${color}" stroke="${color}" stroke-width="0.5"/>`;
}

// Caja centrada en (cx, cz), apoyada en y0, dibujada con las tres caras
// visibles de la isométrica (top / derecha / frente).
function caja(cx, y0, cz, w, h, d, color) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y1 = y0 + h;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  return (
    cara([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], color) +
    cara([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], ajustarColor(color, -0.14)) +
    cara([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], ajustarColor(color, -0.26))
  );
}

// Un personaje entero (cuerpo desnudo con su piel — la ropa auto vendrá del
// catálogo de prendas cuando esté completo) + pelo/barba/ojos. Las piezas
// se recogen con su posición y se ordenan al final con el criterio del
// pintor (más lejos de cámara primero: menor x+z; a igualdad, de abajo a
// arriba) — sin esto los brazos/torso se pisan mal entre sí.
function dibujarPersonaje({ ficha, voxelesCabeza, cuerpo }) {
  const piel = ficha.rasgos.pielColor.hex;
  const piezas = [];
  const pieza = (cx, y0, cz, w, h, d, color) => piezas.push({ cx, y0, cz, svg: caja(cx, y0, cz, w, h, d, color) });

  // Piernas / torso / brazos / manos / cabeza — mismas cajas y pivotes que
  // rigHumanoide.ts, con las medidas YA morfadas de este individuo.
  const p = cuerpo;
  const hombroY = p.altoPierna + p.altoTorso + p.brazo.pivoteYOffset;
  pieza(-p.pierna.offsetX, 0, 0, p.pierna.w, p.altoPierna, p.pierna.d, piel);
  pieza(p.pierna.offsetX, 0, 0, p.pierna.w, p.altoPierna, p.pierna.d, piel);
  pieza(0, p.altoPierna, 0, p.torso.w, p.altoTorso, p.torso.d, ajustarColor(piel, -0.04));
  for (const lado of [-1, 1]) {
    const bx = lado * p.brazo.offsetX;
    pieza(bx, hombroY - p.brazo.mangaH, 0, p.brazo.mangaW, p.brazo.mangaH, p.brazo.mangaD, piel);
    pieza(bx, hombroY - p.brazo.mangaH - p.brazo.manoH, 0, p.brazo.manoW, p.brazo.manoH, p.brazo.manoD, piel);
  }
  const cuelloY = p.altoPierna + p.altoTorso;
  pieza(0, cuelloY, 0, p.ladoCabeza, p.ladoCabeza, p.ladoCabeza, piel);

  // Ojos sobre la cara frontal (+z), como los pinta el rig del cliente.
  const ojo = p.ladoCabeza * 0.16;
  for (const lado of [-1, 1]) {
    pieza(lado * p.ladoCabeza * 0.22, cuelloY + p.ladoCabeza * 0.55, p.ladoCabeza / 2 + 0.01, ojo, ojo, 0.015, ficha.rasgos.ojosColor.hex);
  }

  // Pelo y barba: vóxeles del generador colgando del pivote cabeza (=cuello).
  const celda = p.ladoCabeza / 6;
  for (const v of voxelesCabeza) {
    pieza(v.x, cuelloY + v.y - celda / 2, v.z, celda, celda, celda, v.color);
  }

  piezas.sort((a, b) => (a.cx + a.cz) - (b.cx + b.cz) || a.y0 - b.y0);
  return piezas.map((pz) => pz.svg).join("\n");
}

function renderGaleria() {
  const columnas = PRUEBAS.map((prueba, i) => {
    const resultado = generarPersonaje(prueba.npcId, { ...prueba, catalogos });
    const f = resultado.ficha;
    const dx = 60 + i * 190;
    const etiqueta = [
      `${f.npcId} (${prueba.semilla})`,
      `${f.sexo} · a=${f.morfologia.altura} c=${f.morfologia.corpulencia}`,
      `${f.rasgos.peloEstilo}/${f.rasgos.barbaEstilo} · ${f.rasgos.peloColor.id}`,
      `piel ${f.rasgos.pielColor.id} · ojos ${f.rasgos.ojosColor.id}`,
    ];
    console.log(etiqueta.join(" | "));
    const textos = etiqueta
      .map((linea, j) => `<text x="0" y="${86 + j * 13}" fill="#bbb" font-family="monospace" font-size="10" text-anchor="middle">${linea}</text>`)
      .join("");
    return `<g transform="translate(${dx}, 340)">${dibujarPersonaje(resultado)}${textos}</g>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500" viewBox="0 0 1600 500">
  <rect width="1600" height="500" fill="#1b1b22"/>
  <text x="16" y="28" fill="#eee" font-family="monospace" font-size="15">Generador de personajes — 8 individuos de 4 NPCs (deterministas por semilla)</text>
  ${columnas.join("\n")}
</svg>`;

  const salida = path.join(__dirname, "..", "output", "galeria_npcs.svg");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, svg, "utf8");
  console.log(`galería -> ${salida}`);
}

if (require.main === module) renderGaleria();

module.exports = { renderGaleria, PRUEBAS };
