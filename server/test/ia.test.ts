// Tests del diálogo de NPCs (docs/GDD_IA_NPCs.md): fallback entre
// proveedores, similitud coseno, anti-repetición y orquestación completa —
// todo con proveedores FALSOS inyectados (sin red real). Ejecutar: npm test.
import { test } from "node:test";
import * as assert from "node:assert";
import { IProveedorIA, IProveedorEmbeddings, ProveedorIAConRespaldo } from "../src/ia/proveedor";
import { similitudCoseno, MemoriaConversaciones } from "../src/ia/memoria";
import { GestorConversacionesNpc, DatosNpcIndividual, IMemoriaNpcPersistente } from "../src/ia/npcChat";

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

// docs/GDD_IA_NPCs.md (pedido streamer 2026-09-08: "ahondar en el tema de
// las conversaciones con IA NPC") — biografía individual real (poblacion.json)
// por encima del arquetipo genérico, perfil conversacional, y memoria real
// persistida entre conversaciones con el MISMO jugador.

test("GestorConversacionesNpc.hablar: con individuo (poblacion.json), su personalidad/conocimiento PROPIOS ganan al arquetipo genérico", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const individual: DatosNpcIndividual = {
    oficio: "herrero",
    personalidad: "Ragnar Herrerson es huraño y no confía en forasteros.",
    conocimiento: ["Vine del norte tras perder mi fragua en un incendio."],
  };
  const gestor = new GestorConversacionesNpc(falso, undefined, () => individual);
  await gestor.hablar("herrero_slot_42", "Lagertha", "hola");
  assert.match(systemPromptRecibido, /Ragnar Herrerson es huraño/);
  assert.match(systemPromptRecibido, /perder mi fragua en un incendio/);
  assert.doesNotMatch(systemPromptRecibido, /Forja herramientas y armas sencillas/, "no debería colarse el conocimiento del arquetipo si el individuo trae el suyo propio");
});

test("GestorConversacionesNpc.hablar: individuo SIN historia (bake sin GEMINI_API_KEY) cae al arquetipo de su oficio, no se queda mudo", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  // Igual que un NpcBakeado real con historia:null — sin personalidad/conocimiento propios.
  const individualSinHistoria: DatosNpcIndividual = { oficio: "herrero" };
  const gestor = new GestorConversacionesNpc(falso, undefined, () => individualSinHistoria);
  await gestor.hablar("herrero_slot_7", "Ragnar", "hola");
  assert.match(systemPromptRecibido, /Forja herramientas y armas sencillas/, "debería caer al conocimiento del arquetipo herrero");
});

test("GestorConversacionesNpc.hablar: el perfil conversacional (tono) se inyecta en el prompt", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const individual: DatosNpcIndividual = { oficio: "herrero", perfilConversacionalId: "chismoso" };
  const gestor = new GestorConversacionesNpc(falso, undefined, () => individual);
  await gestor.hablar("herrero_slot_9", "Ragnar", "hola");
  assert.match(systemPromptRecibido, /cotillear/i);
});

test("GestorConversacionesNpc.hablar: sin memoria persistente inyectada, avisa de que es la primera vez (comportamiento por defecto, sin BD)", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined);
  await gestor.hablar("herrero", "Ragnar", "hola");
  assert.match(systemPromptRecibido, /primera vez que hablas con el jugador "Ragnar"/);
});

test("GestorConversacionesNpc.hablar: con memoria persistente, inyecta lo que el jugador dijo antes y guarda el mensaje nuevo", async () => {
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto() {
      return "respuesta";
    },
  };
  const guardado: { npcId: string; jugador: string; mensaje: string }[] = [];
  const memoriaFalsa: IMemoriaNpcPersistente = {
    async obtener(npcId, jugador) {
      assert.strictEqual(npcId, "herrero");
      assert.strictEqual(jugador, "Ragnar");
      return ["Te compré un hacha la semana pasada"];
    },
    async agregar(npcId, jugador, mensaje) {
      guardado.push({ npcId, jugador, mensaje });
    },
  };
  let systemPromptRecibido = "";
  const proveedorQueCapta: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "¡Ah, tú otra vez!";
    },
  };
  const gestor = new GestorConversacionesNpc(proveedorQueCapta, undefined, undefined, memoriaFalsa);
  const respuesta = await gestor.hablar("herrero", "Ragnar", "¿tienes espadas nuevas?");
  assert.match(systemPromptRecibido, /Ya has hablado antes con el jugador "Ragnar"/);
  assert.match(systemPromptRecibido, /Te compré un hacha la semana pasada/);
  assert.strictEqual(respuesta, "¡Ah, tú otra vez!");
  assert.deepStrictEqual(guardado, [{ npcId: "herrero", jugador: "Ragnar", mensaje: "¿tienes espadas nuevas?" }]);
});

// docs/GDD_IA_NPCs.md v3 (pedido streamer: "clasificación de tipos de NPC...
// qué sabe y qué NO sabe cada uno") — ámbito de conocimiento por ROL,
// fijo por arquetipo (personajes/catalogo/npcs.json::ambitoConocimientoId +
// personajes/catalogo/ambitosConocimiento.json), distinto del perfil
// conversacional (el tono, al azar por individuo).

test("GestorConversacionesNpc.hablar: el ámbito de conocimiento por rol (sabe/NO sabe) se inyecta en el prompt", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined);
  // "guardia" es del arquetipo "guardia_capital" (personajes/catalogo/npcs.json).
  await gestor.hablar("guardia", "Ragnar", "hola");
  assert.match(systemPromptRecibido, /puedes hablar con soltura/i);
  assert.match(systemPromptRecibido, /Movimientos recientes de bandidos/);
  assert.match(systemPromptRecibido, /NO sabes nada de esto/i);
  assert.match(systemPromptRecibido, /magia antigua o los archimagos/);
});

test("GestorConversacionesNpc.hablar: el ámbito de conocimiento es del ROL (arquetipo), no cambia aunque el NPC tenga biografía individual propia", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const individual: DatosNpcIndividual = {
    oficio: "guardia",
    personalidad: "Astrid Guardiana es implacable con los forasteros.",
    conocimiento: ["Lleva 10 años guardando la puerta este."],
  };
  const gestor = new GestorConversacionesNpc(falso, undefined, () => individual);
  await gestor.hablar("guardia_slot_3", "Ragnar", "hola");
  assert.match(systemPromptRecibido, /Astrid Guardiana es implacable/); // biografía individual
  assert.match(systemPromptRecibido, /Movimientos recientes de bandidos/); // ámbito del ROL "guardia_capital"
});

test("GestorConversacionesNpc.hablar: sin arquetipo real detrás (ambitoConocimientoId indefinido), no rompe ni añade el bloque de ámbito", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  // Sin `oficio`, leerNpc busca el arquetipo por el propio npcId — que no
  // existe en personajes/catalogo/npcs.json, así que arquetipo es undefined
  // y ambitoConocimientoId queda sin definir (comportamiento por defecto).
  const individual: DatosNpcIndividual = { personalidad: "Alguien sin oficio de catálogo.", conocimiento: ["cosa"] };
  const gestor = new GestorConversacionesNpc(falso, undefined, () => individual);
  await gestor.hablar("npc_fantasma_sin_arquetipo", "Ragnar", "hola");
  assert.doesNotMatch(systemPromptRecibido, /puedes hablar con soltura/i);
  assert.doesNotMatch(systemPromptRecibido, /NO sabes nada de esto/i);
});

// docs/GDD_IA_NPCs.md v3bis (pedido streamer: "un npc llamado pregonero que
// te cuente... las novedades del día") — solo el pregonero anuncia el log
// real de sucesos (`novedadesProveedor`), inyectado como 5º parámetro.

test("GestorConversacionesNpc.hablar: el pregonero anuncia las novedades reales del proveedor inyectado", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined, undefined, undefined, async () => [
    "Ragnar se ha hecho con una nueva propiedad en Kaldrborg.",
    "Se ha limpiado una mazmorra de la zona.",
  ]);
  await gestor.hablar("pregonero", "Lagertha", "¿qué novedades hay?");
  assert.match(systemPromptRecibido, /Eres el pregonero/i);
  assert.match(systemPromptRecibido, /Ragnar se ha hecho con una nueva propiedad/);
  assert.match(systemPromptRecibido, /Se ha limpiado una mazmorra/);
});

test("GestorConversacionesNpc.hablar: sin novedades reales, el pregonero lo admite en vez de inventar una noticia falsa", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined, undefined, undefined, async () => []);
  await gestor.hablar("pregonero", "Lagertha", "¿qué novedades hay?");
  assert.match(systemPromptRecibido, /no tienes ninguna novedad real que contar/i);
});

test("GestorConversacionesNpc.hablar: un NPC que NO es pregonero (mismo ámbito bardo_rumorero) nunca recibe el bloque de novedades", async () => {
  let systemPromptRecibido = "";
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto(systemPrompt) {
      systemPromptRecibido = systemPrompt;
      return "respuesta";
    },
  };
  let llamado = false;
  const gestor = new GestorConversacionesNpc(falso, undefined, undefined, undefined, async () => {
    llamado = true;
    return ["esto no debería aparecer nunca"];
  });
  // "chismosa" es del mismo ámbito bardo_rumorero que "pregonero", pero NO es el pregonero.
  await gestor.hablar("chismosa", "Lagertha", "hola");
  assert.strictEqual(llamado, false, "el proveedor de novedades no debería ni llamarse para un NPC que no es pregonero");
  assert.doesNotMatch(systemPromptRecibido, /esto no debería aparecer nunca/);
});

test("GestorConversacionesNpc.hablar: si el proveedor de novedades falla, la conversación del pregonero sigue funcionando igual (degrada, no rompe)", async () => {
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto() {
      return "sigo aquí";
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined, undefined, undefined, async () => {
    throw new Error("BD caída");
  });
  const respuesta = await gestor.hablar("pregonero", "Ragnar", "hola");
  assert.strictEqual(respuesta, "sigo aquí");
});

test("GestorConversacionesNpc.hablar: si la memoria persistente falla al leer o guardar, la conversación sigue funcionando igual (degrada, no rompe)", async () => {
  const falso: IProveedorIA = {
    nombre: "falso",
    async generarTexto() {
      return "sigo aquí";
    },
  };
  const memoriaRota: IMemoriaNpcPersistente = {
    async obtener() {
      throw new Error("BD caída");
    },
    async agregar() {
      throw new Error("BD caída");
    },
  };
  const gestor = new GestorConversacionesNpc(falso, undefined, undefined, memoriaRota);
  const respuesta = await gestor.hablar("herrero", "Ragnar", "hola");
  assert.strictEqual(respuesta, "sigo aquí");
});
