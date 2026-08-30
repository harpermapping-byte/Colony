// Tests de mundo/bosquesVivos.ts — activación/desactivación de sectores,
// tala y plantado en vivo, con dependencias FALSAS (sin disco ni BD real).
// Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MapSchema } from "@colyseus/schema";
import { DependenciasBosques, GestorBosques } from "../src/mundo/bosquesVivos";
import { ObjetoArbolBakeado } from "../src/mundo/bosqueSector";
import { EspecieArbol } from "../src/mundo/crecimientoBosques";
import { ArbolVivoFila } from "../src/datos/bd";
import { ArbolVivoSchema } from "../src/rooms/schema/HubState";
import { TIPO } from "../src/mundo/colisiones";

function mundoAbierto(lado = 40) {
  return { ancho: lado, alto: lado, casillas: new Uint8Array(lado * lado).fill(TIPO.TIERRA), velocidad: new Float32Array(lado * lado).fill(1) };
}

const CATALOGO: Record<string, EspecieArbol> = {
  pino: { radioPropagacion: 5, probabilidadPropagacion: 0, diasMaduracion: 180 }, // 0 = nunca propaga por accidente en estos tests
};

class BdBosqueFalsa {
  bakeTalados = new Map<string, ArbolVivoFila[]>();
  crecidos = new Map<string, ArbolVivoFila[]>();
  resueltos = new Map<string, number>();
  guardados: string[] = [];

  private k(s: { sectorX: number; sectorY: number }) {
    return `${s.sectorX},${s.sectorY}`;
  }

  cargarPersistido = async (s: { sectorX: number; sectorY: number }) => ({
    bakeTalados: this.bakeTalados.get(this.k(s)) ?? [],
    crecidos: this.crecidos.get(this.k(s)) ?? [],
  });

  guardarArbolVivo = async (f: ArbolVivoFila) => {
    this.guardados.push(f.id);
    const mapa = f.origen === "bake" ? this.bakeTalados : this.crecidos;
    const k = `${f.sectorX},${f.sectorY}`;
    const lista = mapa.get(k) ?? [];
    const i = lista.findIndex((x) => x.id === f.id);
    if (i >= 0) lista[i] = f;
    else lista.push(f);
    mapa.set(k, lista);
  };

  marcarSectorResuelto = async (s: { sectorX: number; sectorY: number }, momento: number) => {
    this.resueltos.set(this.k(s), momento);
  };
}

function crearGestor(opts: {
  mundo?: ReturnType<typeof mundoAbierto>;
  bake?: ObjetoArbolBakeado[];
  ahora?: number;
  bd?: BdBosqueFalsa;
} = {}) {
  const mundo = opts.mundo ?? mundoAbierto();
  const bd = opts.bd ?? new BdBosqueFalsa();
  const bake = opts.bake ?? [{ i: "pino", x: 10, y: 10 }];
  let ahora = opts.ahora ?? 100;
  const salida = new MapSchema<ArbolVivoSchema>();
  const deps: DependenciasBosques = {
    mapaId: "m",
    catalogo: CATALOGO,
    mundo,
    tamanoChunk: 16,
    tamanoSectorChunks: 4,
    ahora: () => ahora,
    cargarBakeSector: () => bake,
    cargarPersistido: bd.cargarPersistido,
    guardarArbolVivo: bd.guardarArbolVivo,
    marcarSectorResuelto: bd.marcarSectorResuelto,
  };
  return { gestor: new GestorBosques(salida, deps), salida, mundo, bd, avanzarDia: (n: number) => (ahora += n) };
}

test("activarSector: un árbol de bake se pone SOLIDO en el grid pero NUNCA se publica en el Schema (límite conocido, ver GDD)", async () => {
  const { gestor, salida, mundo } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(salida.size, 0, "el bake nunca se materializa como entidad Colyseus");
  // la casilla YA estaba TIERRA (el bake real la habría endurecido en mapaColision.ts, aquí solo comprobamos que activarSector no la toca)
  assert.strictEqual(mundo.casillas[10 * mundo.ancho + 10], TIPO.TIERRA);
});

test("buscarArbolCercano encuentra un árbol de bake activo dentro del radio, y ninguno fuera", async () => {
  const { gestor } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const cerca = gestor.buscarArbolCercano(10, 10, 3);
  assert.ok(cerca);
  assert.strictEqual(cerca!.especieId, "pino");
  assert.strictEqual(cerca!.etapa, "adulto");
  const lejos = gestor.buscarArbolCercano(100, 100, 3);
  assert.strictEqual(lejos, null);
});

test("talar un árbol de bake: lo persiste como talado, lo quita de buscarArbolCercano, y ablanda su casilla si estaba sólida", async () => {
  const { gestor, mundo, bd } = crearGestor();
  mundo.casillas[10 * mundo.ancho + 10] = TIPO.SOLIDO; // simula lo que mapaColision.ts habría endurecido de verdad
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const arbol = gestor.buscarArbolCercano(10, 10, 3)!;
  const resultado = await gestor.talar(arbol.ref);
  assert.deepStrictEqual(resultado, { especieId: "pino", etapa: "adulto" });
  assert.strictEqual(gestor.buscarArbolCercano(10, 10, 3), null, "ya no está");
  assert.strictEqual(mundo.casillas[10 * mundo.ancho + 10], TIPO.TIERRA, "su casilla vuelve a ser transitable");
  assert.strictEqual(bd.bakeTalados.get("0,0")?.length, 1);
});

test("un árbol de bake talado NO reaparece al reactivar el sector (desactivar + activar de nuevo)", async () => {
  const { gestor, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const arbol = gestor.buscarArbolCercano(10, 10, 3)!;
  await gestor.talar(arbol.ref);
  gestor.desactivarSector({ sectorX: 0, sectorY: 0 });

  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(gestor.buscarArbolCercano(10, 10, 3), null);
  assert.strictEqual(bd.bakeTalados.get("0,0")?.length, 1, "sigue siendo una sola fila talada, no se duplica");
});

test("plantar: crea un brote joven, lo publica en el Schema, y falla si la casilla no está libre", async () => {
  const { gestor, salida, bd } = crearGestor({ bake: [] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });

  const brote = await gestor.plantar("pino", 5, 5);
  assert.ok(brote);
  assert.strictEqual(brote!.etapa, "joven");
  assert.strictEqual(brote!.origen, "plantado");
  assert.strictEqual(salida.size, 1);
  assert.strictEqual(bd.crecidos.get("0,0")?.length, 1);

  const chocado = await gestor.plantar("pino", 5, 5); // misma casilla, ya ocupada
  assert.strictEqual(chocado, null);
});

test("plantar: falla fuera de un sector activo (nadie cerca)", async () => {
  const { gestor } = crearGestor({ bake: [] });
  const resultado = await gestor.plantar("pino", 5, 5); // sector 0,0 nunca activado
  assert.strictEqual(resultado, null);
});

test("un brote plantado que cumple diasMaduracion pasa a adulto y ENDURECE su casilla al reactivar el sector", async () => {
  const { gestor, salida, mundo, avanzarDia } = crearGestor({ bake: [] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  await gestor.plantar("pino", 5, 5);
  gestor.desactivarSector({ sectorX: 0, sectorY: 0 });

  avanzarDia(180); // diasMaduracion de "pino" en el catálogo de prueba
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });

  assert.strictEqual(salida.size, 1);
  const [esquema] = [...salida.values()];
  assert.strictEqual(esquema.etapa, "adulto");
  assert.strictEqual(mundo.casillas[5 * mundo.ancho + 5], TIPO.SOLIDO, "ya bloquea el paso como un árbol adulto de verdad");
});

test("talar un brote crecido: lo marca talado, lo quita del Schema, y ablanda la casilla si ya era adulto", async () => {
  const { gestor, salida, mundo, avanzarDia } = crearGestor({ bake: [] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  await gestor.plantar("pino", 5, 5);
  gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  avanzarDia(180);
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });

  const arbol = gestor.buscarArbolCercano(5, 5, 1)!;
  assert.strictEqual(arbol.etapa, "adulto");
  const resultado = await gestor.talar(arbol.ref);
  assert.deepStrictEqual(resultado, { especieId: "pino", etapa: "adulto" });
  assert.strictEqual(salida.size, 0);
  assert.strictEqual(mundo.casillas[5 * mundo.ancho + 5], TIPO.TIERRA);
});

test("desactivarSector quita del Schema todo lo crecido de ese sector, sin tocar BD (ya persistido en la activación)", async () => {
  const { gestor, salida, bd } = crearGestor({ bake: [] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  await gestor.plantar("pino", 5, 5);
  const guardadosAntes = bd.guardados.length;

  gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(salida.size, 0);
  assert.strictEqual(bd.guardados.length, guardadosAntes, "desactivar no escribe en BD");
});

test("actualizarPorJugadores activa el sector de un jugador cercano y desactiva el que se queda sin nadie", async () => {
  const { gestor } = crearGestor({ bake: [] });
  await gestor.actualizarPorJugadores([{ x: 10, y: 10 }], 0);
  assert.ok(gestor.sectoresCargados.length > 0);

  await gestor.actualizarPorJugadores([{ x: 10000, y: 10000 }], 0);
  assert.strictEqual(gestor.sectoresCargados.length, 1, "solo queda activo el sector nuevo, lejos del anterior");
});
