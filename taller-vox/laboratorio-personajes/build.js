"use strict";
// Ensambla laboratorio_personajes.html: template + bundle de three.js + los
// PJ de prueba embebidos en base64. Antes de compilar hay que generar los
// personajes con `node ../generar_pj.js test` (crea ../vox/pj*.glb y su
// índice con los metadatos de cada uno).
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const voxDir = path.join(dir, "..", "vox");
const bundle = fs.readFileSync(path.join(dir, "bundle.js"), "utf8").replace(/<\/script>/gi, "<\\/script>");

const indice = JSON.parse(fs.readFileSync(path.join(voxDir, "pjs_test.json"), "utf8"));
const pjs = indice.map((pj) => ({
  ...pj,
  b64: fs.readFileSync(path.join(voxDir, pj.id + ".glb")).toString("base64"),
}));

const html = fs.readFileSync(path.join(dir, "template.html"), "utf8")
  .replace("{{PJS_JSON}}", () => JSON.stringify(pjs))
  .replace("{{BUNDLE}}", () => bundle);
fs.writeFileSync(path.join(dir, "laboratorio_personajes.html"), html);
console.log("laboratorio_personajes.html:", (html.length / 1024).toFixed(0), "KB,", pjs.length, "personajes embebidos");
