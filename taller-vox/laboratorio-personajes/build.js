"use strict";
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const bundle = fs.readFileSync(path.join(dir, "bundle.js"), "utf8").replace(/<\/script>/gi, "<\\/script>");
const glb = fs.readFileSync(path.join(dir, "..", "vox", "personaje.glb"));
const html = fs.readFileSync(path.join(dir, "template.html"), "utf8")
  .replace("{{GLB_B64}}", glb.toString("base64"))
  .replace("{{BUNDLE}}", () => bundle);
fs.writeFileSync(path.join(dir, "laboratorio_personajes.html"), html);
console.log("laboratorio_personajes.html:", (html.length / 1024).toFixed(0), "KB");
