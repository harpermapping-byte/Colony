// Conquista de un asentamiento bandido (docs/GDD_Faccion_Bandidos.md §7).
// Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AlmacenDatos } from "../src/datos/bd";
import {
  asegurarAsentamientoBandido,
  conquistarAsentamiento,
  repoblarAsentamientoConquistado,
  marcarTropaMuertaYVerificarConquista,
} from "../src/mundo/economiaAsentamientos";

const RAIZ_REPO = path.resolve(__dirname, "..", "..");

function bakearAldeaHostilTemp(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { hornearCiudad } = require(path.join(RAIZ_REPO, "ciudades", "src", "index.js"));
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "conquista-test-"));
  hornearCiudad("asentamiento_hostil", "conquista-test-01", carpeta);
  return carpeta;
}

test("repoblarAsentamientoConquistado: escribe poblacion.json con ciudadanos civiles sobre la MISMA ciudad ya bakeada", async () => {
  const carpeta = bakearAldeaHostilTemp();
  try {
    const indiceAntes = fs.readFileSync(path.join(carpeta, "indice.json"), "utf8");
    const { ruta, npcs } = await repoblarAsentamientoConquistado(carpeta);
    assert.strictEqual(ruta, path.join(carpeta, "poblacion.json"));
    assert.ok(npcs > 0, "debería generar al menos un NPC con rutina");
    // El indice.json (edificios/muralla/terreno) NO se toca — solo se añade poblacion.json al lado
    assert.strictEqual(fs.readFileSync(path.join(carpeta, "indice.json"), "utf8"), indiceAntes);

    const poblacion = JSON.parse(fs.readFileSync(path.join(carpeta, "poblacion.json"), "utf8"));
    assert.strictEqual(poblacion.tierId, "asentamiento_hostil");
    assert.ok(Array.isArray(poblacion.npcs) && poblacion.npcs.length > 0);
    // Cada NPC trae lo que RegionRoom/GestorAgentes necesita para moverlo y pintarlo
    for (const npc of poblacion.npcs) {
      assert.ok(npc.rutina.length > 0);
      assert.ok(npc.vox?.ficha);
    }
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
  }
});

test("conquistarAsentamiento: bandido -> neutral, registra memoria del líder, repuebla; idempotente si ya era neutral", async () => {
  const bd = new AlmacenDatos(":memory:");
  const carpeta = bakearAldeaHostilTemp();
  try {
    const asentamiento = await bd.obtenerOCrearAsentamiento("aldea_1", "bandido");
    await conquistarAsentamiento(bd, asentamiento, carpeta);

    const [actualizado] = await bd.listarAsentamientos();
    assert.strictEqual(actualizado.bando, "neutral");
    assert.ok(fs.existsSync(path.join(carpeta, "poblacion.json")));

    const memorias = await bd.memoriaLiderReciente(5);
    assert.strictEqual(memorias.length, 1);
    assert.match(memorias[0].evento, /aldea_1.*ha caído/);

    // Segunda llamada sobre el ya-neutral: no debe volver a registrar memoria
    // ni regenerar población (idempotente de verdad, no solo "no revienta")
    fs.rmSync(path.join(carpeta, "poblacion.json"));
    await conquistarAsentamiento(bd, actualizado, carpeta);
    assert.strictEqual((await bd.memoriaLiderReciente(5)).length, 1);
    assert.strictEqual(fs.existsSync(path.join(carpeta, "poblacion.json")), false);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
    await bd.cerrar();
  }
});

test("marcarTropaMuertaYVerificarConquista: NO conquista hasta que muere la ÚLTIMA tropa viva", async () => {
  const bd = new AlmacenDatos(":memory:");
  const carpeta = bakearAldeaHostilTemp();
  try {
    await asegurarAsentamientoBandido(bd, "aldea_2"); // 7 tropas (1 lider + 2 guardia + 4 recluta)
    const tropas = await bd.listarTropas("aldea_2");
    assert.strictEqual(tropas.length, 7);

    for (const t of tropas.slice(0, 6)) {
      const r = await marcarTropaMuertaYVerificarConquista(bd, t.id, "aldea_2", carpeta);
      assert.strictEqual(r.conquistada, false);
    }
    assert.strictEqual((await bd.obtenerOCrearAsentamiento("aldea_2")).bando, "bandido");
    assert.strictEqual(fs.existsSync(path.join(carpeta, "poblacion.json")), false);

    // La ÚLTIMA tropa viva: ahora sí
    const ultima = tropas[6];
    const r = await marcarTropaMuertaYVerificarConquista(bd, ultima.id, "aldea_2", carpeta);
    assert.strictEqual(r.conquistada, true);
    assert.strictEqual((await bd.obtenerOCrearAsentamiento("aldea_2")).bando, "neutral");
    assert.ok(fs.existsSync(path.join(carpeta, "poblacion.json")));

    // Repetir sobre una tropa ya muerta (idempotente, no revienta ni reconquista)
    const r2 = await marcarTropaMuertaYVerificarConquista(bd, ultima.id, "aldea_2", carpeta);
    assert.strictEqual(r2.conquistada, false);
  } finally {
    fs.rmSync(carpeta, { recursive: true, force: true });
    await bd.cerrar();
  }
});
