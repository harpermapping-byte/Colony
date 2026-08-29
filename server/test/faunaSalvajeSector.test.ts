// Tests de mundo/faunaSalvajeSector.ts — resolución de un sector de fauna
// salvaje (bakeado + persistido + reloj de mundo). Ejecutar: npm test
// desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { CatalogoEspecies, resolverSector } from "../src/mundo/faunaSalvajeSector";
import { FaunaSalvajeFila, FaunaHuevoFila } from "../src/datos/bd";

const CATALOGO: CatalogoEspecies = {
  lobo: { tamanoReproduccion: "grande", poneHuevos: false, criaId: "lobo" },
  gallina_salvaje: { tamanoReproduccion: "pequeno", poneHuevos: true, criaId: "pollito" },
  abeja: { tamanoReproduccion: "pequeno", poneHuevos: false, poblacionInfinita: true },
};

const RND_APAREA = () => 0.1; // < 0.5: siempre cuaja el apareamiento

test("primera activación: genera un adulto vivo por cada objeto bakeado, sexo asignado", () => {
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 2,
    sectorY: 3,
    objetosBakeados: [
      { i: "lobo", x: 10, y: 10 },
      { i: "lobo", x: 12, y: 10 },
    ],
    filasPersistidas: [],
    huevosPersistidos: [],
    ultimaResolucion: null,
    ahora: 50,
    catalogo: CATALOGO,
    rnd: () => 0.3,
  });
  assert.strictEqual(r.individuos.length, 2);
  for (const ind of r.individuos) {
    assert.strictEqual(ind.mapaId, "principal");
    assert.strictEqual(ind.sectorX, 2);
    assert.strictEqual(ind.sectorY, 3);
    assert.strictEqual(ind.estado, "vivo");
    assert.strictEqual(ind.etapa, "adulto");
    assert.strictEqual(ind.ultimaComida, 50);
    assert.strictEqual(ind.gestandoDesde, null);
  }
  assert.strictEqual(r.huevos.length, 0);
});

test("primera activación: las especies de población infinita (insectos) NO generan individuos", () => {
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [{ i: "abeja", x: 1, y: 1 }],
    filasPersistidas: [],
    huevosPersistidos: [],
    ultimaResolucion: null,
    ahora: 10,
    catalogo: CATALOGO,
  });
  assert.strictEqual(r.individuos.length, 0);
});

test("primera activación: ids deterministas por índice — mismo sector, mismo resultado", () => {
  const args = {
    mapaId: "principal",
    sectorX: 5,
    sectorY: 5,
    objetosBakeados: [{ i: "lobo", x: 1, y: 1 }],
    filasPersistidas: [],
    huevosPersistidos: [],
    ultimaResolucion: null,
    ahora: 1,
    catalogo: CATALOGO,
    rnd: () => 0,
  };
  const a = resolverSector(args);
  const b = resolverSector(args);
  assert.strictEqual(a.individuos[0].id, b.individuos[0].id);
});

function fila(overrides: Partial<FaunaSalvajeFila> = {}): FaunaSalvajeFila {
  return {
    id: "principal:0:0:0",
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    especieId: "lobo",
    sexo: "macho",
    etapa: "adulto",
    estado: "vivo",
    x: 5,
    y: 5,
    ultimaComida: 0,
    ultimaBebida: 0,
    gestandoDesde: null,
    gestacionDuracionDias: null,
    ...overrides,
  };
}

test("resolución de un hueco: una hembra con gestación ya cumplida da a luz una cría del criaId", () => {
  const hembra = fila({ id: "h", sexo: "hembra", gestandoDesde: 10, gestacionDuracionDias: 15 });
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [],
    filasPersistidas: [hembra],
    huevosPersistidos: [],
    ultimaResolucion: 10,
    ahora: 40, // 30 días después, de sobra para que cumpliera los 15 de gestación
    catalogo: CATALOGO,
  });
  const madre = r.individuos.find((i) => i.id === "h")!;
  assert.strictEqual(madre.gestandoDesde, null, "ya parió, deja de estar gestando");
  const crias = r.individuos.filter((i) => i.etapa === "cria");
  assert.strictEqual(crias.length, 1);
  assert.strictEqual(crias[0].especieId, "lobo");
  assert.strictEqual(crias[0].estado, "vivo");
});

test("resolución de un hueco: un huevo cuya duración ya pasó eclosiona en cría y desaparece de la lista de huevos", () => {
  const huevo: FaunaHuevoFila = {
    id: "huevo:1",
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    especieMadreId: "gallina_salvaje",
    x: 3,
    y: 3,
    puestoEn: 5,
    duracionDias: 3,
  };
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [],
    filasPersistidas: [],
    huevosPersistidos: [huevo],
    ultimaResolucion: 5,
    ahora: 20,
    catalogo: CATALOGO,
  });
  assert.strictEqual(r.huevos.length, 0);
  const crias = r.individuos.filter((i) => i.etapa === "cria");
  assert.strictEqual(crias.length, 1);
  assert.strictEqual(crias[0].especieId, "pollito");
});

test("resolución de un hueco: macho y hembra vivos cerca, mismo especie, con rnd favorable — cuaja apareamiento", () => {
  const macho = fila({ id: "m", sexo: "macho", x: 0, y: 0 });
  const hembra = fila({ id: "h", sexo: "hembra", x: 2, y: 0 });
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [],
    filasPersistidas: [macho, hembra],
    huevosPersistidos: [],
    ultimaResolucion: 10,
    ahora: 15,
    catalogo: CATALOGO,
    rnd: RND_APAREA,
  });
  const h = r.individuos.find((i) => i.id === "h")!;
  assert.notStrictEqual(h.gestandoDesde, null, "debería haber quedado gestando (lobo no pone huevos)");
});

test("resolución de un hueco: pareja demasiado lejos (fuera del radio) no se aparea", () => {
  const macho = fila({ id: "m", sexo: "macho", x: 0, y: 0 });
  const hembra = fila({ id: "h", sexo: "hembra", x: 500, y: 500 });
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [],
    filasPersistidas: [macho, hembra],
    huevosPersistidos: [],
    ultimaResolucion: 10,
    ahora: 15,
    catalogo: CATALOGO,
    rnd: RND_APAREA,
  });
  const h = r.individuos.find((i) => i.id === "h")!;
  assert.strictEqual(h.gestandoDesde, null);
});

test("resolución de un hueco: animal muerto se conserva en el resultado (no resucita)", () => {
  const muerto = fila({ id: "m", estado: "muerto" });
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [],
    filasPersistidas: [muerto],
    huevosPersistidos: [],
    ultimaResolucion: 10,
    ahora: 15,
    catalogo: CATALOGO,
  });
  assert.strictEqual(r.individuos.length, 1);
  assert.strictEqual(r.individuos[0].estado, "muerto");
});

test("resolución de un hueco: cada macho intenta como mucho una vez (no se reutiliza tras emparejarse)", () => {
  const macho = fila({ id: "m", sexo: "macho", x: 0, y: 0 });
  const hembra1 = fila({ id: "h1", sexo: "hembra", x: 1, y: 0 });
  const hembra2 = fila({ id: "h2", sexo: "hembra", x: 2, y: 0 });
  const r = resolverSector({
    mapaId: "principal",
    sectorX: 0,
    sectorY: 0,
    objetosBakeados: [],
    filasPersistidas: [macho, hembra1, hembra2],
    huevosPersistidos: [],
    ultimaResolucion: 10,
    ahora: 15,
    catalogo: CATALOGO,
    rnd: RND_APAREA,
  });
  const gestando = r.individuos.filter((i) => i.gestandoDesde !== null);
  assert.strictEqual(gestando.length, 1, "solo una de las dos hembras debería quedar gestando");
});
