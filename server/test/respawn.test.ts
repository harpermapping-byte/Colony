// Tests de personaje/respawn.ts (docs/GDD_Muerte_Respawn.md, pedido
// 2026-08-30). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { resolverRespawn } from "../src/personaje/respawn";
import { Propiedad, Construccion, IAlmacenDatos } from "../src/datos/bd";
import { EntradaConstruible } from "../src/construccion/catalogo";

function bdFalsa(propiedades: [string, Propiedad][], construcciones: Construccion[]): IAlmacenDatos {
  return {
    cargarPropiedades: async () => new Map(propiedades),
    listarConstrucciones: async () => construcciones,
  } as unknown as IAlmacenDatos;
}

function propiedad(overrides: Partial<Propiedad> = {}): Propiedad {
  return { tipo: "parcela", asentamiento: "aldea_1", dueno: "Ragnar", modoTenencia: null, precioFarycoins: null, periodoHoras: null, expiraEn: null, ...overrides };
}

function construccion(overrides: Partial<Construccion> = {}): Construccion {
  return { id: 1, propiedad: "p1", objeto: "cama_individual", categoria: "mueble", x: 10, y: 20, rot: 0, variante: 0, extra: null, ...overrides };
}

const CATALOGO_CON_CAMA = new Map<string, EntradaConstruible>([
  ["cama_individual", { esCama: true } as EntradaConstruible],
  ["pesas_entrenamiento", {} as EntradaConstruible],
]);

test("resolverRespawn: sin ninguna propiedad, cae al Hub", async () => {
  const bd = bdFalsa([], []);
  const destino = await resolverRespawn(bd, CATALOGO_CON_CAMA, "Ragnar");
  assert.deepStrictEqual(destino, { tipo: "hub" });
});

test("resolverRespawn: con propiedad pero SIN cama construida, cae al Hub", async () => {
  const bd = bdFalsa([["p1", propiedad()]], [construccion({ objeto: "pesas_entrenamiento" })]);
  const destino = await resolverRespawn(bd, CATALOGO_CON_CAMA, "Ragnar");
  assert.deepStrictEqual(destino, { tipo: "hub" });
});

test("resolverRespawn: con cama en una región, respawnea justo ahí", async () => {
  const bd = bdFalsa([["p1", propiedad({ asentamiento: "aldea_1" })]], [construccion({ x: 15.5, y: 22.5 })]);
  const destino = await resolverRespawn(bd, CATALOGO_CON_CAMA, "Ragnar");
  assert.deepStrictEqual(destino, { tipo: "region", mapaId: "aldea_1", x: 15.5, y: 22.5 });
});

test("resolverRespawn: una propiedad de OTRO jugador no cuenta, aunque tenga cama", async () => {
  const bd = bdFalsa([["p1", propiedad({ dueno: "Lagertha" })]], [construccion()]);
  const destino = await resolverRespawn(bd, CATALOGO_CON_CAMA, "Ragnar");
  assert.deepStrictEqual(destino, { tipo: "hub" });
});

test("resolverRespawn: nombre insensible a mayúsculas", async () => {
  const bd = bdFalsa([["p1", propiedad({ dueno: "RAGNAR" })]], [construccion()]);
  const destino = await resolverRespawn(bd, CATALOGO_CON_CAMA, "ragnar");
  assert.strictEqual(destino.tipo, "region");
});
