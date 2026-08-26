"use strict";

// Prueba visual isométrica 2.5D del prototipo de colocación
// (colocarElementos.js) — misma proyección validada al principio de la
// conversación de interiores (mockup "Sala Isométrica Ocluida"):
//   sx = (x-y)*cos(30°)*U
//   sy = -(x+y)*sin(30°)*U - z*UZ
// (0,0) queda como la esquina más cercana a cámara (abajo); (ancho,largo)
// como la esquina más lejana (arriba) — por eso se dibujan como muros
// sólidos los lados sur (y=largo-1) y este (x=ancho-1), que son los que
// quedan "detrás" desde ese punto de vista, dejando norte/oeste abiertos
// para poder ver el interior. La puerta (siempre en el lado sur en este
// prototipo) se recorta como hueco real en ese muro, no un simple marcador.

const fs = require("fs");
const path = require("path");
const { cargarCatalogos } = require("./catalogo");
const { colocarSala } = require("./colocarElementos");

const catalogos = cargarCatalogos();

const PRUEBAS = [
  { titulo: "cocina_comedor — completo (mesa+sillas coherente)", tipoSalaId: "cocina_comedor", riqueza: "humilde", amueblado: "completo", semilla: "test-coherencia" },
  { titulo: "dormitorio_doble — completo", tipoSalaId: "dormitorio_doble", riqueza: "modesta", amueblado: "completo", semilla: "prueba-01" },
  { titulo: "gran_salon — completo (noble, simétrico)", tipoSalaId: "gran_salon", riqueza: "noble", amueblado: "completo", semilla: "prueba-03" },
  { titulo: "taller — completo (yunque/fragua, tileInteraccion)", tipoSalaId: "taller", riqueza: "modesta", amueblado: "completo", semilla: "prueba-taller-02" },
  { titulo: "sala_alquimia — completo", tipoSalaId: "sala_alquimia", riqueza: "noble", amueblado: "completo", semilla: "prueba-alq-01" },
  { titulo: "capilla — completo (simétrico, religioso)", tipoSalaId: "capilla", riqueza: "modesta", amueblado: "completo", semilla: "prueba-capilla-01" },
  { titulo: "dormitorio_individual — vacío (amueblado:\"vacio\")", tipoSalaId: "dormitorio_individual", riqueza: "humilde", amueblado: "vacio", semilla: "prueba-vacio-01" },
];

const U = 26; // tamaño de unidad isométrica en px
const UZ = 22; // altura por nivel z en px
const ANG = Math.PI / 6; // 30°
const ALTURA_PARED = 2.4;

function proyectar(x, y, z) {
  const sx = (x - y) * Math.cos(ANG) * U;
  const sy = -(x + y) * Math.sin(ANG) * U - z * UZ;
  return [sx, sy];
}

function poligono(puntos, fill, opts = "") {
  const pts = puntos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `<polygon points="${pts}" fill="${fill}" ${opts}/>`;
}

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Caja isométrica simple (3 caras visibles: techo + 2 laterales que miran
// hacia cámara) para dibujar cualquier mueble a partir de su huella + una
// altura según su capa.
function cajaSVG(x, y, aw, al, h, colorBase, etiqueta) {
  const top = sombrear(colorBase, 1.15);
  const caraA = sombrear(colorBase, 0.85); // cara "norte" (y=fy)
  const caraB = sombrear(colorBase, 0.7); // cara "oeste" (x=fx) — algo más oscura
  const A0 = proyectar(x, y, 0), A1 = proyectar(x, y, h);
  const B0 = proyectar(x + aw, y, 0), B1 = proyectar(x + aw, y, h);
  const C0 = proyectar(x + aw, y + al, 0), C1 = proyectar(x + aw, y + al, h);
  const D0 = proyectar(x, y + al, 0), D1 = proyectar(x, y + al, h);
  let svg = "";
  svg += poligono([A0, B0, D0], "none"); // (evita warning de var sin usar en algún linter futuro)
  svg += poligono([A0, B0, B1, A1], caraA, 'stroke="#0006" stroke-width="0.6"'); // cara norte
  svg += poligono([A0, A1, D1, D0], caraB, 'stroke="#0006" stroke-width="0.6"'); // cara oeste
  svg += poligono([A1, B1, C1, D1], top, 'stroke="#0006" stroke-width="0.6"'); // techo de la pieza
  if (etiqueta) {
    const [lx, ly] = proyectar(x + aw / 2, y + al / 2, h);
    svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="7" fill="#000" text-anchor="middle" style="paint-order:stroke" stroke="#fff" stroke-width="2.5">${escaparXML(etiqueta.slice(0, 12))}</text>`;
  }
  return svg;
}

function escaparXML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Altura visual aproximada según capa/tipo — no es dato real del catálogo
// todavía (huella solo da ancho/largo), es solo para que la prueba se lea
// bien; cuando el catálogo tenga altura propia por elemento, se sustituye.
function alturaPara(item) {
  if (item.capa === "suciedad") return 0.05;
  if (item.capa === "iluminacion") return 0.3;
  if (["armario", "estanteria", "baul_tesoro"].some((k) => item.id.includes(k))) return 1.8;
  if (item.id.includes("mesa") || item.id.includes("encimera") || item.id.includes("mostrador")) return 0.8;
  if (item.id.includes("cama")) return 0.6;
  return 1.1;
}

function renderSalaSVG(resultado) {
  const { ancho, largo, materialSuelo, materialPared, puerta, colocados, colgados, techo } = resultado;
  const colorSuelo = catalogos.materiales[materialSuelo]?.colorDebug || "#c9b896";
  const colorPared = catalogos.materiales[materialPared]?.colorDebug || "#8a8a8a";

  // Límites de la escena en pantalla para fijar el viewBox.
  const esquinas = [proyectar(0, 0, 0), proyectar(ancho, 0, 0), proyectar(0, largo, 0), proyectar(ancho, largo, ALTURA_PARED)];
  const xs = esquinas.map((p) => p[0]);
  const ys = esquinas.map((p) => p[1]);
  const margen = 40;
  const minX = Math.min(...xs) - margen, maxX = Math.max(...xs) + margen;
  const minY = Math.min(...ys) - margen, maxY = Math.max(...ys) + margen + 20;
  const w = maxX - minX, h = maxY - minY;

  let cuerpo = "";

  // Suelo: un solo rombo (rectángulo del mundo proyectado).
  cuerpo += poligono([proyectar(0, 0, 0), proyectar(ancho, 0, 0), proyectar(ancho, largo, 0), proyectar(0, largo, 0)], colorSuelo, 'stroke="#0004" stroke-width="0.5"');

  // Muros sólidos: sur (y=largo, con hueco de puerta) y este (x=ancho) —
  // los que quedan "al fondo" desde esta cámara, dejando norte/oeste
  // abiertos para ver el interior. Un segmento de pared por tile, así el
  // hueco de la puerta es un recorte real, no un simple marcador.
  const colorParedOscuro = sombrear(colorPared, 0.75);
  for (let x = 0; x < ancho; x++) {
    if (puerta.lado === "sur" && x === puerta.x) continue; // hueco de la puerta
    const p0 = proyectar(x, largo, 0), p1 = proyectar(x + 1, largo, 0);
    const p2 = proyectar(x + 1, largo, ALTURA_PARED), p3 = proyectar(x, largo, ALTURA_PARED);
    cuerpo += poligono([p0, p1, p2, p3], colorParedOscuro, 'stroke="#0006" stroke-width="0.6"');
  }
  const colorParedClaro = sombrear(colorPared, 0.9);
  for (let y = 0; y < largo; y++) {
    const p0 = proyectar(ancho, y, 0), p1 = proyectar(ancho, y + 1, 0);
    const p2 = proyectar(ancho, y + 1, ALTURA_PARED), p3 = proyectar(ancho, y, ALTURA_PARED);
    cuerpo += poligono([p0, p1, p2, p3], colorParedClaro, 'stroke="#0006" stroke-width="0.6"');
  }

  // Mobiliario en suelo, ordenado por profundidad (x+y creciente = más
  // cerca de cámara = se dibuja después, por encima de lo lejano).
  const colocadosOrdenados = colocados.slice().sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const c of colocadosOrdenados) {
    cuerpo += cajaSVG(c.x, c.y, c.ancho, c.largo, alturaPara(c), c.colorDebug || "#999", c.id);
    if (c.sobre && c.sobre.length) {
      let dz = alturaPara(c);
      for (const s of c.sobre) {
        cuerpo += cajaSVG(c.x + c.ancho * 0.3, c.y + c.largo * 0.3, 0.3, 0.3, 0.15, s.colorDebug || "#ccc", "");
        dz += 0.15;
      }
    }
  }

  // Elementos colgados en pared — solo se ven los que caen en un muro
  // realmente dibujado (sur/este); los de norte/oeste quedan en el muro
  // abierto y se listan en el pie en vez de intentar dibujarlos flotando.
  const colgadosVisibles = colgados.filter((c) => c.lado === "sur" || c.lado === "este");
  for (const c of colgadosVisibles) {
    const zc = ALTURA_PARED * 0.55;
    const [px, py] = c.lado === "sur" ? proyectar(c.x + 0.5, largo, zc) : proyectar(ancho, c.y + 0.5, zc);
    cuerpo += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="${c.colorDebug || "#ccc"}" stroke="#000" stroke-width="0.7"/>`;
  }

  const puertaLabel = proyectar(puerta.x + 0.5, largo, 0);
  cuerpo += `<text x="${puertaLabel[0].toFixed(1)}" y="${(puertaLabel[1] + 14).toFixed(1)}" font-size="8" fill="#ccc" text-anchor="middle">puerta</text>`;

  const norteOeste = colgados.filter((c) => c.lado === "norte" || c.lado === "oeste").map((c) => c.id);
  const piePie = `techo: ${techo.map((t) => t.id).join(", ") || "—"}${norteOeste.length ? ` · en pared norte/oeste (no visible desde este ángulo): ${norteOeste.join(", ")}` : ""}`;

  return { svg: `<svg width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="${minX.toFixed(1)} ${minY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" xmlns="http://www.w3.org/2000/svg" font-family="monospace">${cuerpo}</svg>`, pie: piePie };
}

function construirHTML() {
  const bloques = PRUEBAS.map((p) => {
    const r = colocarSala({ tipoSalaId: p.tipoSalaId, catalogos, riqueza: p.riqueza, amueblado: p.amueblado, semilla: p.semilla });
    const { svg, pie } = renderSalaSVG(r);
    const nDecor = r.colocados.length + r.colgados.length;
    const catSala = catalogos.tiposSala[p.tipoSalaId];
    const statsTxt = Object.entries(r.estadisticas).map(([k, v]) => `${k}:${v}`).join(" ") || "—";
    return `
      <div class="sala">
        <h2>${escaparXML(p.titulo)}</h2>
        <p class="meta">${catSala.categoria}/${escaparXML(catSala.nombre)} · ${r.ancho}x${r.largo} tiles · suelo ${r.materialSuelo} · pared ${r.materialPared} · ${nDecor} piezas</p>
        ${svg}
        <p class="pie">${escaparXML(pie)}</p>
        <p class="stats">estadisticas: ${escaparXML(statsTxt)}</p>
      </div>`;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Prueba isométrica interiores</title>
  <style>
    body { background:#15151a; color:#eee; font-family: sans-serif; padding: 20px; }
    .grid { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
    .sala { background:#22222a; padding: 12px; border-radius: 8px; }
    h2 { font-size: 14px; margin: 0 0 4px; }
    .meta { font-size: 11px; color: #aaa; margin: 0 0 8px; }
    .pie { font-size: 10px; color: #888; margin-top: 6px; max-width: 420px; }
    .stats { font-size: 10px; color: #8ac9e0; margin-top: 2px; max-width: 420px; }
    svg { display: block; background: #2a2a32; border-radius: 4px; }
  </style></head><body>
  <h1>Prototipo de interiores — vista isométrica 2.5D</h1>
  <div class="grid">${bloques}</div>
  </body></html>`;
}

const salida = path.join("/tmp/claude-0/-home-user-Secret/75acf9b9-60f3-587e-9641-8725192b1416/scratchpad", "prueba-interiores-iso.html");
fs.writeFileSync(salida, construirHTML());
console.log("Escrito:", salida);
