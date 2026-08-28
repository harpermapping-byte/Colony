// Tests del diálogo de NPCs (docs/GDD_IA_NPCs.md): fallback entre
// proveedores, similitud coseno, anti-repetición y orquestación completa —
// todo con proveedores FALSOS inyectados (sin red real). Ejecutar: npm test.
import { test } from "node:test";
import * as assert from "node:assert";
import { IProveedorIA, IProveedorEmbeddings, ProveedorIAConRespaldo } from "../src/ia/proveedor";
import { similitudCoseno, MemoriaConversaciones } from "../src/ia/memoria";
import { GestorConversacionesNpc } from "../src/ia/npcChat";

function proveedorFalso(nombre: string, comportamiento: (mensaje: string) => string): IProveedorIA {
  return {
    nombre,
    async generarTexto(_systemPrompt, mensaje) {
      return comportamiento(mensaje);
    },
  };
}

function proveedorQueFalla(nombre: string, error: string): IProveedorIA {
  return {
    nombre,
    async generarTexto() {
      throw new Error(error);
    },
  };
}

test("similitudCoseno: vectores idénticos dan 1, ortogonales dan 0", () => {
  assert.strictEqual(similitudCoseno([1, 0], [1, 0]), 1);
  assert.strictEqual(similitudCoseno([1, 0], [0, 1]), 0);
  assert.ok(similitudCoseno([1, 1], [1, 0]) > 0.5);
});

test("ProveedorIAConRespaldo: usa el principal si funciona", async () => {
  const principal = proveedorFalso("principal", () => "respuesta del principal");
  const respaldo = proveedorFalso("respaldo", () => "respuesta del respaldo");
  const conRespaldo = new ProveedorIAConRespaldo(principal, respaldo);
  assert.strictEqual(await conRespaldo.generarTexto("sys", "hola"), "respuesta del principal");
});

test("ProveedorIAConRespaldo: cae al respaldo si el principal falla (cuota agotada, red...)", async () => {
  const principal = proveedorQueFalla("gemini", "429 quota exceeded");
  const respaldo = proveedorFalso("groq", () => "respuesta del respaldo");
  const conRespaldo = new ProveedorIAConRespaldo(principal, respaldo);
  assert.strictEqual(await conRespaldo.generarTexto("sys", "hola"), "respuesta del respaldo");
});

test("ProveedorIAConRespaldo: si los dos fallan, propaga el error del respaldo", async () => {
  const principal = proveedorQueFalla("gemini", "caído");
  const respaldo = proveedorQueFalla("groq", "también caído");
  const conRespaldo = new ProveedorIAConRespaldo(principal, respaldo);
  await assert.rejects(() => conRespaldo.generarTexto("sys", "hola"), /también caído/);
});

test("MemoriaConversaciones: guarda por (npc, jugador) y recorta al máximo", () => {
  const memoria = new MemoriaConversaciones();
  assert.deepStrictEqual(memoria.ultimasRespuestas("herrero", "Ragnar"), []);
  for (let i = 0; i < 6; i++) memoria.registrar("herrero", "Ragnar", `frase ${i}`);
  const historial = memoria.ultimasRespuestas("herrero", "Ragnar");
  assert.strictEqual(historial.length, 4); // MAX_HISTORIAL
  assert.deepStrictEqual(historial, ["frase 2", "frase 3", "frase 4", "frase 5"]);
  // otro jugador con el mismo NPC no comparte historial
  assert.deepStrictEqual(memoria.ultimasRespuestas("herrero", "Bjorn"), []);
});

test("GestorConversacionesNpc.hablar: mete contexto del mundo, personalidad y conocimiento del NPC en el prompt", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt, mensaje) {
      systemPromptRecibido = systemPrompt;
      return `[respuesta a "${mensaje}"]`;
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined);
  const respuesta = await gestor.hablar("herrero", "Ragnar", "¿me forjas una espada?");

  assert.strictEqual(respuesta, '[respuesta a "¿me forjas una espada?"]');
  assert.match(systemPromptRecibido, /medieval/); // contexto general del mundo
  assert.match(systemPromptRecibido, /brusco pero honesto/); // personalidad del herrero
  assert.match(systemPromptRecibido, /Forja herramientas/); // conocimiento del herrero
});

test("GestorConversacionesNpc.hablar: la segunda vez pide no repetir la respuesta anterior", async () => {
  let ultimoPrompt = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      ultimoPrompt = systemPrompt;
      return "¡Buenos días, forastero!";
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined);
  await gestor.hablar("aldeano", "Lagertha", "hola");
  assert.doesNotMatch(ultimoPrompt, /no repitas/i);

  await gestor.hablar("aldeano", "Lagertha", "hola de nuevo");
  assert.match(ultimoPrompt, /no repitas.*¡Buenos días, forastero!/is);
});

test("GestorConversacionesNpc.hablar: NPC desconocido o sin proveedor configurado da error claro", async () => {
  const falso = proveedorFalso("falso", () => "x");
  const gestor = new GestorConversacionesNpc(falso, undefined);
  await assert.rejects(() => gestor.hablar("no_existe", "Ragnar", "hola"), /NPC desconocido/);

  const sinProveedor = new GestorConversacionesNpc(undefined, undefined);
  assert.strictEqual(sinProveedor.disponible, false);
  await assert.rejects(() => sinProveedor.hablar("herrero", "Ragnar", "hola"), /sin proveedor de IA/);
});

test("GestorConversacionesNpc.hablar: con conocimiento largo, busca por similitud (RAG) usando el embedding falso", async () => {
  const embeddingsFalsos: Record<string, number[]> = {
    "Forja herramientas y armas sencillas con el mineral que le traen los mineros.": [1, 0, 0],
    "Necesita más carbón vegetal del que le llega cada semana.": [0, 1, 0],
    "Desconfía de las armas mal forjadas de otros herreros forasteros.": [0, 0, 1],
    "¿te falta carbón?": [0, 1, 0],
  };
  const embeddings: IProveedorEmbeddings = {
    async generarEmbedding(texto) {
      const v = embeddingsFalsos[texto];
      if (!v) throw new Error(`sin embedding falso para: ${texto}`);
      return v;
    },
  };
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "sí, ando corto";
    },
  };
  // El herrero tiene exactamente 3 fragmentos (<= MAX_FRAGMENTOS_PROMPT),
  // así que aquí se usan todos sin pasar por embeddings.
  const gestor = new GestorConversacionesNpc(falso, embeddings);
  await gestor.hablar("herrero", "Ragnar", "¿te falta carbón?");
  assert.match(systemPromptRecibido, /Forja herramientas/);
  assert.match(systemPromptRecibido, /carbón vegetal/);
  assert.match(systemPromptRecibido, /armas mal forjadas/);
});
