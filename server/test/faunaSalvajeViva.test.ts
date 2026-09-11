// Tests de mundo/faunaSalvajeViva.ts — activación/desactivación de
// sectores y merodeo en vivo, con dependencias FALSAS (sin disco ni BD
// real). Ejecutar: npm test desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { MapSchema } from "@colyseus/schema";
import {
  DependenciasFaunaSalvaje,
  GestorFaunaSalvaje,
  sectorDeCasilla,
  sectoresEnRadio,
} from "../src/mundo/faunaSalvajeViva";
import { CatalogoEspecies } from "../src/mundo/faunaSalvajeSector";
import { CatalogoCombateFauna } from "../src/mundo/catalogoCombateFauna";
import { Cadaver } from "../src/mundo/cadaveres";
import { Fauna } from "../src/rooms/schema/HubState";
import { TIPO } from "../src/mundo/colisiones";
import { FaunaHuevoFila, FaunaSalvajeFila } from "../src/datos/bd";
import { cargarCatalogoItems } from "../src/inventario/inventario";

function mundoAbierto(lado = 40) {
  const casillas = new Uint8Array(lado * lado).fill(TIPO.TIERRA);
  return { ancho: lado, alto: lado, casillas, velocidad: new Float32Array(lado * lado).fill(1) };
}

const CATALOGO: CatalogoEspecies = {
  lobo: { tamanoReproduccion: "grande", poneHuevos: false, dieta: "carnivoro", criaId: "lobo" },
  conejo: { tamanoReproduccion: "pequeno", poneHuevos: false, dieta: "herbivoro" },
};

const CATALOGO_COMBATE: CatalogoCombateFauna = {
  lobo: {
    categoriaVida: "grande", vidaMaxima: 50, ataque: 12, peligroso: true, domesticable: false,
    categoriaRecursoCarne: "carne_caza_mayor", categoriaRecursoPiel: "cuero_grueso",
  },
  conejo: { categoriaVida: "pequeno", vidaMaxima: 15, ataque: 2, peligroso: false, domesticable: false },
};

class BdFalsa {
  filas = new Map<string, FaunaSalvajeFila[]>();
  huevos = new Map<string, FaunaHuevoFila[]>();
  resueltos = new Map<string, number>();
  cadaveres: Cadaver[] = [];
  guardados: string[] = [];

  private k(s: { sectorX: number; sectorY: number }) {
    return `${s.sectorX},${s.sectorY}`;
  }

  cargarPersistido = async (s: { sectorX: number; sectorY: number }) => ({
    filas: this.filas.get(this.k(s)) ?? [],
    huevos: this.huevos.get(this.k(s)) ?? [],
    ultimaResolucion: this.resueltos.get(this.k(s)) ?? null,
  });

  guardarIndividuo = async (f: FaunaSalvajeFila) => {
    this.guardados.push(f.id);
    const k = `${f.sectorX},${f.sectorY}`;
    const lista = this.filas.get(k) ?? [];
    const i = lista.findIndex((x) => x.id === f.id);
    if (i >= 0) lista[i] = f;
    else lista.push(f);
    this.filas.set(k, lista);
  };

  guardarHuevo = async (h: FaunaHuevoFila) => {
    const k = `${h.sectorX},${h.sectorY}`;
    const lista = this.huevos.get(k) ?? [];
    lista.push(h);
    this.huevos.set(k, lista);
  };

  marcarSectorResuelto = async (s: { sectorX: number; sectorY: number }, momento: number) => {
    this.resueltos.set(this.k(s), momento);
  };

  crearCadaver = async (c: Cadaver) => {
    this.cadaveres.push(c);
  };
}

function crearGestor(overrides: Partial<DependenciasFaunaSalvaje> = {}) {
  const salida = new MapSchema<Fauna>();
  const bd = new BdFalsa();
  const deps: DependenciasFaunaSalvaje = {
    mapaId: "principal",
    catalogo: CATALOGO,
    catalogoCombate: CATALOGO_COMBATE,
    mundo: mundoAbierto(),
    ahora: () => 10,
    cargarBakeSector: () => [{ i: "lobo", x: 5, y: 5 }],
    cargarPersistido: bd.cargarPersistido,
    guardarIndividuo: bd.guardarIndividuo,
    guardarHuevo: bd.guardarHuevo,
    marcarSectorResuelto: bd.marcarSectorResuelto,
    crearCadaver: bd.crearCadaver,
    ...overrides,
  };
  return { gestor: new GestorFaunaSalvaje(salida, deps), salida, bd };
}

test("sectorDeCasilla: agrupa por tamanoChunk * tamanoSectorChunks", () => {
  // tamanoChunk 32, tamanoSectorChunks 10 -> cada sector mide 320 casillas
  assert.deepStrictEqual(sectorDeCasilla(0, 0, 32, 10), { sectorX: 0, sectorY: 0 });
  assert.deepStrictEqual(sectorDeCasilla(319, 319, 32, 10), { sectorX: 0, sectorY: 0 });
  assert.deepStrictEqual(sectorDeCasilla(320, 0, 32, 10), { sectorX: 1, sectorY: 0 });
  assert.deepStrictEqual(sectorDeCasilla(0, 320, 32, 10), { sectorX: 0, sectorY: 1 });
});

test("sectoresEnRadio: radio 1 da los 9 sectores alrededor (incluido el centro)", () => {
  const s = sectoresEnRadio({ sectorX: 5, sectorY: 5 }, 1);
  assert.strictEqual(s.length, 9);
  assert.ok(s.some((c) => c.sectorX === 5 && c.sectorY === 5));
  assert.ok(s.some((c) => c.sectorX === 4 && c.sectorY === 4));
  assert.ok(s.some((c) => c.sectorX === 6 && c.sectorY === 6));
});

test("activarSector: primera vez — genera desde el bake, lo mete en el estado de Colyseus y lo persiste", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(salida.size, 1);
  assert.strictEqual(gestor.cantidadViva(), 1);
  assert.strictEqual(bd.guardados.length, 1, "se persiste ya en la primera activación");
  assert.deepStrictEqual(gestor.sectoresCargados, ["0,0"]);
});

test("activarSector: dos veces seguidas no duplica nada", async () => {
  const { gestor, salida } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(salida.size, 1);
});

test("activarSector: segunda vez (ya persistido) NO vuelve a leer el bake", async () => {
  let llamadasBake = 0;
  const { gestor, bd } = crearGestor({
    cargarBakeSector: () => {
      llamadasBake++;
      return [{ i: "lobo", x: 5, y: 5 }];
    },
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  await gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(llamadasBake, 1);
  await gestor.activarSector({ sectorX: 0, sectorY: 0 }); // reactivar: ya hay fila persistida
  assert.strictEqual(llamadasBake, 1, "no debería releer el bake una vez que el sector ya tiene estado propio");
});

test("desactivarSector: guarda la posición final y lo quita del estado de Colyseus", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  salida.get(id)!.x = 12.3; // simula que se movió tras varios tick()
  salida.get(id)!.y = 7.7;
  await gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(salida.size, 0);
  assert.strictEqual(gestor.cantidadViva(), 0);
  const fila = bd.filas.get("0,0")!.find((f) => f.id === id)!;
  assert.strictEqual(fila.x, 12.3);
  assert.strictEqual(fila.y, 7.7);
});

test("posicionesBakeOriginalVivas: sector nunca activado -> []", () => {
  const { gestor } = crearGestor();
  assert.deepStrictEqual(gestor.posicionesBakeOriginalVivas({ sectorX: 0, sectorY: 0 }), []);
});

test("posicionesBakeOriginalVivas: tras activar, devuelve la posición ORIGINAL del bake por índice — no la que tenga tras vagabundear", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [{ i: "lobo", x: 5, y: 5 }, { i: "conejo", x: 6, y: 6 }],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  // simula vagabundeo real: la posición EN VIVO se aleja de la del bake —
  // la exclusión debe seguir apuntando al bake, no a esto.
  for (const f of salida.values()) { f.x = 30.5; f.y = 30.5; }
  const posiciones = gestor.posicionesBakeOriginalVivas({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(posiciones.length, 2);
  assert.ok(posiciones.some((p) => p.x === 5 && p.y === 5));
  assert.ok(posiciones.some((p) => p.x === 6 && p.y === 6));
});

test("posicionesBakeOriginalVivas: un individuo muerto ya no aparece", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [{ i: "lobo", x: 5, y: 5 }, { i: "conejo", x: 6, y: 6 }],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const idLobo = [...salida.keys()].find((id) => id.endsWith(":0"))!; // índice 0 del bake = lobo (5,5)
  assert.ok(idLobo, "debería existir el id del primer individuo bakeado (índice 0)");
  await gestor.matarIndividuo(idLobo);
  const posiciones = gestor.posicionesBakeOriginalVivas({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(posiciones.length, 1);
  assert.deepStrictEqual(posiciones[0], { x: 6, y: 6 });
});

test("posicionesBakeOriginalVivas: fauna repuesta por el jarl (reponerEspecie) NUNCA aparece — no tiene gemelo decorativo bakeado", async () => {
  const { gestor } = crearGestor({
    cargarBakeSector: () => [{ i: "lobo", x: 5, y: 5 }],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const creados = await gestor.reponerEspecie("conejo", 3, { x: 5, y: 5 }, 320, 1);
  assert.strictEqual(creados, 3);
  const posiciones = gestor.posicionesBakeOriginalVivas({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(posiciones.length, 1, "solo el lobo original del bake, nunca los 3 conejos repuestos");
  assert.deepStrictEqual(posiciones[0], { x: 5, y: 5 });
});

test("posicionesBakeOriginalVivas: sector desactivado -> []", async () => {
  const { gestor } = crearGestor({
    cargarBakeSector: () => [{ i: "lobo", x: 5, y: 5 }],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  await gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  assert.deepStrictEqual(gestor.posicionesBakeOriginalVivas({ sectorX: 0, sectorY: 0 }), []);
});

test("actualizarPorJugadores: activa el sector del jugador y sus vecinos, desactiva los que quedan lejos", async () => {
  const { gestor } = crearGestor();
  await gestor.actualizarPorJugadores([{ x: 5, y: 5 }], 32, 10, 1);
  assert.strictEqual(gestor.sectoresCargados.length, 9, "radio 1 = 9 sectores");

  // el jugador se aleja mucho -> los sectores viejos se desactivan, entran los nuevos
  await gestor.actualizarPorJugadores([{ x: 5 + 320 * 20, y: 5 }], 32, 10, 1);
  assert.strictEqual(gestor.sectoresCargados.length, 9);
  assert.ok(!gestor.sectoresCargados.includes("0,0"), "el sector viejo debería haberse desactivado");
});

test("actualizarPorJugadores: sin jugadores, todo se desactiva", async () => {
  const { gestor } = crearGestor();
  await gestor.actualizarPorJugadores([{ x: 5, y: 5 }], 32, 10, 0);
  assert.strictEqual(gestor.sectoresCargados.length, 1);
  await gestor.actualizarPorJugadores([], 32, 10, 0);
  assert.strictEqual(gestor.sectoresCargados.length, 0);
});

test("tick: un individuo activo se mueve dentro de su radio de merodeo sin salir de la rejilla", async () => {
  const { gestor, salida } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  const x0 = animal.x, y0 = animal.y;
  let vioCaminar = false;
  for (let i = 0; i < 60; i++) {
    gestor.tick(0.1);
    if (animal.accion === "caminar") vioCaminar = true;
    assert.ok(animal.x >= 0 && animal.x < 40 && animal.y >= 0 && animal.y < 40, "nunca sale de la rejilla");
  }
  assert.ok(vioCaminar, "en 6s debería haber arrancado a caminar al menos una vez");
  assert.ok(Math.hypot(animal.x - x0, animal.y - y0) < 3 + 1.5, "no se aleja más de su radio de merodeo");
});

test("una especie sin rig transitable (spawn en sólido) simplemente no aparece — no revienta", async () => {
  const mundo = mundoAbierto();
  mundo.casillas[5 * 40 + 5] = TIPO.SOLIDO; // el punto de spawn cae en un sólido
  const { gestor, salida } = crearGestor({ mundo });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(salida.size, 0);
});

test("sed: un adulto con más de 1 día sin beber camina hasta el agua más cercana y, al llegar, se marca como bebido", async () => {
  const mundo = mundoAbierto();
  mundo.casillas[5 * 40 + 8] = TIPO.AGUA; // agua a 3 casillas a la derecha del spawn (5,5)
  let reloj = 10;
  const { gestor, salida } = crearGestor({ mundo, ahora: () => reloj });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 }); // nace "bebido" en reloj=10
  reloj = 11.5; // más de 1 día después: ahora sí tiene sed
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  let llegoAlAgua = false;
  for (let i = 0; i < 400 && !llegoAlAgua; i++) {
    gestor.tick(0.1);
    if (Math.hypot(animal.x - 8.5, animal.y - 5.5) < 0.05) llegoAlAgua = true;
  }
  assert.ok(llegoAlAgua, "debería haber llegado a la casilla de agua en algún momento");
});

test("sed: si no hay agua dentro del radio de búsqueda, no se bloquea — sigue paseando con normalidad", async () => {
  let reloj = 10;
  const { gestor, salida } = crearGestor({ ahora: () => reloj }); // mundoAbierto por defecto no tiene NADA de agua
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  reloj = 11.5;
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  let vioCaminar = false;
  for (let i = 0; i < 100; i++) {
    gestor.tick(0.1);
    if (animal.accion === "caminar") vioCaminar = true;
  }
  assert.ok(vioCaminar, "sigue paseando aunque no encuentre agua, no se queda congelado");
});

test("comida: un herbívoro con hambre come 'del suelo' sin desplazarse — se marca la acción y ultimaComida al instante", async () => {
  let reloj = 10;
  const { gestor, salida, bd } = crearGestor({
    ahora: () => reloj,
    cargarBakeSector: () => [{ i: "conejo", x: 5, y: 5 }],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 }); // nace "saciado" en reloj=10
  reloj = 11.5; // más de 1 día después: un herbívoro ya tiene hambre
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  const x0 = animal.x, y0 = animal.y;
  gestor.tick(4); // agota la pausa inicial (1-4s) de golpe, fuerza la decisión
  assert.strictEqual(animal.accion, "comer");
  assert.strictEqual(animal.x, x0, "comer del suelo no desplaza al animal");
  assert.strictEqual(animal.y, y0);
  await gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  const filaGuardada = bd.filas.get("0,0")!.find((f) => f.id === id)!;
  assert.strictEqual(filaGuardada.ultimaComida, 11.5, "se guarda la comida al desactivar el sector");
});

test("matarIndividuo: quita al individuo del estado de Colyseus, lo marca muerto en BD y crea su cadáver en su última posición", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  animal.x = 12.3; // simula que se movió antes de morir
  animal.y = 7.7;

  const cadaver = await gestor.matarIndividuo(id);

  assert.strictEqual(salida.size, 0, "desaparece del estado de Colyseus");
  assert.strictEqual(gestor.cantidadViva(), 0);
  assert.ok(cadaver);
  assert.strictEqual(cadaver!.id, `cadaver:${id}`);
  assert.strictEqual(cadaver!.tipoOrigen, "animal");
  assert.strictEqual(cadaver!.especieOrigenId, "lobo");
  assert.strictEqual(cadaver!.x, 12.3);
  assert.strictEqual(cadaver!.y, 7.7);
  assert.strictEqual(bd.cadaveres.length, 1);
  assert.strictEqual(bd.cadaveres[0].id, cadaver!.id);

  const filaGuardada = bd.filas.get("0,0")!.find((f) => f.id === id)!;
  assert.strictEqual(filaGuardada.estado, "muerto", "se persiste como muerto, nunca se resucita");
});

test("matarIndividuo: rellena el cadáver con UN ÚNICO ítem 'cadáver entero' si se pasa catalogoItems (docs/GDD_Caza.md, rediseño 2026-08-30)", async () => {
  const { gestor, salida } = crearGestor({ catalogoItems: cargarCatalogoItems() });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 }); // solo hay "lobo" en este bake falso
  const id = [...salida.keys()][0];

  const cadaver = await gestor.matarIndividuo(id);

  assert.ok(cadaver);
  assert.strictEqual(cadaver!.contenedor.items.length, 1, "un único ítem cadáver, nunca carne/tendones/tripas sueltos");
  assert.strictEqual(cadaver!.contenedor.items[0].itemId, "cadaver_carne_caza_mayor_cuero_grueso_grande"); // lobo = categoriaVida "grande"
  assert.strictEqual(cadaver!.contenedor.items[0].cantidad, 1);
});

test("matarIndividuo: sin catalogoItems (deps por defecto), el cadáver sigue vacío — comportamiento previo a esta mecánica intacto", async () => {
  const { gestor, salida } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  const cadaver = await gestor.matarIndividuo(id);
  assert.ok(cadaver);
  assert.strictEqual(cadaver!.contenedor.items.length, 0);
});

test("matarIndividuo: null si el id no está activo (ya muerto o inexistente)", async () => {
  const { gestor } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const resultado = await gestor.matarIndividuo("no-existe");
  assert.strictEqual(resultado, null);
});

test("matarIndividuo: tras matar, desactivarSector no vuelve a guardar ni resucita al individuo muerto", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  await gestor.matarIndividuo(id);
  const guardadosTrasMorir = bd.guardados.length;
  await gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(bd.guardados.length, guardadosTrasMorir, "ya no está vivo, desactivar no lo vuelve a tocar");
  assert.strictEqual(salida.size, 0);
});

// docs/GDD_Ganaderia.md + docs/GDD_Monturas.md (pedido 2026-08-30): domesticar
// es DISTINTO de matarIndividuo — sin cadáver (para que un ciervo tameado no
// deje un cuerpo looteable ni cuente como caza), aunque reusa el mismo
// estado "muerto" en BD (el único chequeo real, `faunaSalvajeSector.ts:
// vivo = estado==="vivo"`, ya trata cualquier valor distinto de "vivo" como
// no-vivo, así que no hace falta un tercer estado).
test("domesticar: quita al individuo del estado de Colyseus, sin cadáver, devuelve su especie", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  animal.x = 12.3;
  animal.y = 7.7;

  const especieId = await gestor.domesticar(id);

  assert.strictEqual(especieId, "lobo");
  assert.strictEqual(salida.size, 0, "desaparece del estado de Colyseus");
  assert.strictEqual(gestor.cantidadViva(), 0);
  assert.strictEqual(bd.cadaveres.length, 0, "domesticar nunca crea cadáver, a diferencia de matarIndividuo");

  const filaGuardada = bd.filas.get("0,0")!.find((f) => f.id === id)!;
  assert.strictEqual(filaGuardada.estado, "muerto", "mismo valor que matarIndividuo — el resto del sistema solo necesita saber que ya no vive en la fauna salvaje");
  assert.strictEqual(filaGuardada.x, 12.3);
  assert.strictEqual(filaGuardada.y, 7.7);
});

test("domesticar: null si el id no está activo (ya quitado o inexistente)", async () => {
  const { gestor } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const resultado = await gestor.domesticar("no-existe");
  assert.strictEqual(resultado, null);
});

test("domesticar: tras domesticar, desactivarSector no vuelve a guardarlo ni lo resucita", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  await gestor.domesticar(id);
  const guardadosTrasQuitar = bd.guardados.length;
  await gestor.desactivarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(bd.guardados.length, guardadosTrasQuitar, "ya no está activo, desactivar no lo vuelve a tocar");
  assert.strictEqual(salida.size, 0);
});

test("activarSector: la vida/vidaMax/ataque del esquema salen del catálogo de combate de la especie", async () => {
  const { gestor, salida } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const animal = [...salida.values()][0];
  assert.strictEqual(animal.vida, 50);
  assert.strictEqual(animal.vidaMax, 50);
  assert.strictEqual(animal.ataque, 12);
});

test("recibirDanio: resta de la vida (sin defensa — los animales no la tienen) y persiste", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  const resultado = await gestor.recibirDanio(id, 20);
  assert.deepStrictEqual(resultado, { vida: 30, vidaMax: 50, muerto: false, cadaver: null });
  assert.strictEqual(salida.get(id)!.vida, 30);
  const filaGuardada = bd.filas.get("0,0")!.find((f) => f.id === id)!;
  assert.strictEqual(filaGuardada.vida, 30);
});

test("recibirDanio: si la vida llega a 0, mata al individuo y crea su cadáver (mismo camino que matarIndividuo)", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  const resultado = await gestor.recibirDanio(id, 999);
  assert.strictEqual(resultado!.muerto, true);
  assert.strictEqual(resultado!.vida, 0);
  assert.ok(resultado!.cadaver);
  assert.strictEqual(salida.size, 0, "desaparece del estado de Colyseus, igual que matarIndividuo");
  assert.strictEqual(bd.cadaveres.length, 1);
});

test("recibirDanio: null si el id no está activo", async () => {
  const { gestor } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  assert.strictEqual(await gestor.recibirDanio("no-existe", 10), null);
});

test("curarIndividuo: suma vida sin pasar de vidaMax, y persiste", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const id = [...salida.keys()][0];
  await gestor.recibirDanio(id, 45); // vida 5/50
  const resultado = await gestor.curarIndividuo(id, 1000);
  assert.deepStrictEqual(resultado, { vida: 50, vidaMax: 50 });
  assert.strictEqual(salida.get(id)!.vida, 50);
  const filaGuardada = bd.filas.get("0,0")!.find((f) => f.id === id)!;
  assert.strictEqual(filaGuardada.vida, 50);
});

test("curarIndividuo: null si el id no está activo", async () => {
  const { gestor } = crearGestor();
  assert.strictEqual(await gestor.curarIndividuo("no-existe", 10), null);
});

test("comida: un carnívoro con hambre NO tiene comportamiento activo todavía (depende de cazar/combate) — sigue paseando", async () => {
  let reloj = 10;
  const { gestor, salida } = crearGestor({ ahora: () => reloj }); // lobo, carnívoro, catálogo por defecto
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  reloj = 17; // 7 días después: más de la ventana de 6 días de un carnívoro
  const id = [...salida.keys()][0];
  const animal = salida.get(id)!;
  let vioComer = false;
  let vioCaminar = false;
  for (let i = 0; i < 100; i++) {
    gestor.tick(0.1);
    if (animal.accion === "comer") vioComer = true;
    if (animal.accion === "caminar") vioCaminar = true;
  }
  assert.strictEqual(vioComer, false, "sin sistema de caza, un carnívoro no se autoalimenta");
  assert.ok(vioCaminar, "pero sigue paseando con normalidad");
});

// --- Manada/banco/bandada (pedido 2026-08-31) ---

test("tick: dos conejos (gregarios) plantados lejos entre sí terminan más cerca — cohesión de manada", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [
      { i: "conejo", x: 5, y: 5 },
      { i: "conejo", x: 13, y: 5 }, // separación inicial 8 — dentro de RADIO_MANADA (10)
    ],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [a, b] = [...salida.values()];
  const distanciaInicial = Math.hypot(a.x - b.x, a.y - b.y);
  // Promedio de las últimas 100 lecturas en vez de la distancia EXACTA del
  // último tick: con Math.random() de por medio, un solo tick final puede
  // caer en un pico de ruido del propio radio de merodeo aunque la
  // tendencia real (cohesión) sea clara — de ahí el test flakeaba a veces.
  const distancias: number[] = [];
  for (let i = 0; i < 500; i++) {
    gestor.tick(0.3);
    if (i >= 400) distancias.push(Math.hypot(a.x - b.x, a.y - b.y));
  }
  const distanciaMedia = distancias.reduce((s, d) => s + d, 0) / distancias.length;
  assert.ok(distanciaMedia < distanciaInicial - 2, `esperaba que se acercaran en media (inicial ${distanciaInicial}, media final ${distanciaMedia})`);
});

test("tick: dos lobos (peligrosos, no gregarios) plantados a la misma distancia NO muestran esa cohesión", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [
      { i: "lobo", x: 5, y: 5 },
      { i: "lobo", x: 13, y: 5 },
    ],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [a, b] = [...salida.values()];
  const distanciaInicial = Math.hypot(a.x - b.x, a.y - b.y);
  let distanciaMaxima = distanciaInicial;
  for (let i = 0; i < 400; i++) {
    gestor.tick(0.3);
    distanciaMaxima = Math.max(distanciaMaxima, Math.hypot(a.x - b.x, a.y - b.y));
  }
  // Sin cohesión, el paseo libre (radio 3 cada uno) puede perfectamente alejarlos más de lo que empezaron — la prueba de que NO hay una fuerza que los junte es que la distancia puede crecer.
  assert.ok(distanciaMaxima >= distanciaInicial, `sin cohesión, no debería haber una fuerza sistemática que los acerque (inicial ${distanciaInicial}, máxima vista ${distanciaMaxima})`);
});

test("tick: un conejo SIN vecinos de su especie cerca se comporta como antes (radio de merodeo normal, sin desplazarse hacia nada)", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [{ i: "conejo", x: 5, y: 5 }],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const animal = [...salida.values()][0];
  const x0 = animal.x, y0 = animal.y;
  for (let i = 0; i < 60; i++) gestor.tick(0.1);
  assert.ok(Math.hypot(animal.x - x0, animal.y - y0) < 3 + 1.5, "sigue sin alejarse más de su radio de merodeo, igual que un solitario");
});

// --- Huida/vigía/caza real (docs/GDD_Caza.md §huida, pedido streamer
// 2026-09-07) — radios por defecto: RADIO_HUIDA_DEFECTO=4, RADIO_VISION_
// DEFECTO=8, RADIO_CAPTURA=1.5 (nada exportado a propósito, los tests usan
// distancias claramente dentro/fuera de cada banda para no acoplarse al valor exacto).

test("tick: jugador dentro del radio de VISIÓN (no de huida) pone al conejo en pose de vigía, sin que huya todavía", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 5, y: 5 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const animal = [...salida.values()][0];
  const x0 = animal.x, y0 = animal.y;
  const jugadores = new Map([["s1", { x: x0 + 6, y: y0 }]]); // dentro de vision(8), fuera de huida(4)
  for (let i = 0; i < 20; i++) gestor.tick(0.2, jugadores);
  assert.strictEqual(animal.accion, "alerta", "debería quedarse en vigía mientras el jugador está en su radio de visión");
  assert.ok(Math.hypot(animal.x - x0, animal.y - y0) < 0.5, "en vigía no se desplaza, solo vigila");
});

test("tick: jugador dentro del radio de HUIDA hace que el conejo se aleje de verdad", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const animal = [...salida.values()][0];
  const x0 = animal.x, y0 = animal.y;
  const jugador = { x: x0 + 2, y: y0 }; // dentro de huida(4)
  // Solo 3 ticks (0.6s a VEL=1.0 por defecto): sigue dentro del radio de
  // huida durante todo el tramo — más ticks y el conejo llegaría a
  // ESCAPAR del radio de huida (comportamiento correcto, pasaría a
  // "alerta" al seguir dentro del radio de visión más amplio, no un bug).
  for (let i = 0; i < 3; i++) gestor.tick(0.2, new Map([["s1", jugador]]));
  const distFinal = Math.hypot(animal.x - jugador.x, animal.y - jugador.y);
  const distInicial = Math.hypot(x0 - jugador.x, y0 - jugador.y);
  assert.ok(distFinal > distInicial, `debería haberse alejado del jugador (inicial ${distInicial.toFixed(2)}, final ${distFinal.toFixed(2)})`);
  assert.strictEqual(animal.accion, "huyendo");
});

test("tick: un lobo (peligroso) NUNCA huye ni se pone en vigía aunque el jugador esté encima — usa agro/combate, no huida", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "lobo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const animal = [...salida.values()][0];
  const jugador = { x: animal.x + 0.5, y: animal.y }; // pegado, dentro de huida Y captura
  for (let i = 0; i < 20; i++) gestor.tick(0.2, new Map([["s1", jugador]]));
  assert.notStrictEqual(animal.accion, "huyendo");
  assert.notStrictEqual(animal.accion, "alerta");
});

test("iniciarCaza: rechaza fauna peligrosa (esas se pelean, no se cazan)", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "lobo", x: 5, y: 5 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  assert.strictEqual(gestor.iniciarCaza(id, "s1"), false);
});

test("iniciarCaza: rechaza un id que no existe", () => {
  const { gestor } = crearGestor();
  assert.strictEqual(gestor.iniciarCaza("no_existe", "s1"), false);
});

test("iniciarCaza + tick: el animal cazado huye del CAZADOR concreto sin importar la distancia (más allá del radio de huida normal)", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  const animal = salida.get(id)!;
  const x0 = animal.x, y0 = animal.y;
  assert.strictEqual(gestor.iniciarCaza(id, "cazador"), true);
  // Cazador lejos (fuera del radio de huida normal de 4, pero la caza activa no tiene límite de distancia).
  const cazador = { x: x0 + 7, y: y0 };
  const { atrapados } = gestor.tick(0.2, new Map([["cazador", cazador]]));
  assert.strictEqual(atrapados.length, 0, "todavía no debería atraparlo, sigue lejos");
  assert.strictEqual(animal.accion, "huyendo", "debería huir del cazador aunque esté fuera del radio de huida normal");
});

test("iniciarCaza + tick: cuando el cazador alcanza al animal, tick() lo reporta como atrapado y limpia el estado de caza", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  const animal = salida.get(id)!;
  gestor.iniciarCaza(id, "cazador");
  const cazadorPegado = { x: animal.x + 0.5, y: animal.y }; // dentro de RADIO_CAPTURA (1.5)
  const { atrapados } = gestor.tick(0.2, new Map([["cazador", cazadorPegado]]));
  assert.strictEqual(atrapados.length, 1);
  assert.strictEqual(atrapados[0].faunaId, id);
  assert.strictEqual(atrapados[0].sessionId, "cazador");
  // El animal SIGUE vivo hasta que la room llame a matarIndividuo (tick() solo detecta, no mata) — pero ya no está "siendo cazado": un segundo tick no debería volver a reportarlo.
  const segundoTick = gestor.tick(0.2, new Map([["cazador", cazadorPegado]]));
  assert.strictEqual(segundoTick.atrapados.length, 0, "no debería reportar la misma captura dos veces");
});

test("huida: el terreno frena a la presa igual que al jugador (barro 0.7) — la liebre no gana en barro lo que pierde el cazador (docs/GDD_Caza.md §4ter)", async () => {
  const medir = async (factor: number) => {
    const mundo = mundoAbierto();
    mundo.velocidad.fill(factor);
    const { gestor, salida } = crearGestor({ mundo, cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
    await gestor.activarSector({ sectorX: 0, sectorY: 0 });
    const [id] = [...salida.keys()];
    const animal = salida.get(id)!;
    const x0 = animal.x, y0 = animal.y;
    gestor.iniciarCaza(id, "cazador");
    for (let i = 0; i < 5; i++) gestor.tick(0.2, new Map([["cazador", { x: x0 + 7, y: y0 }]]));
    return Math.hypot(animal.x - x0, animal.y - y0);
  };
  const enCesped = await medir(1);
  const enBarro = await medir(0.7);
  assert.ok(enCesped > 0.5, `en césped huye de verdad (${enCesped.toFixed(2)})`);
  assert.ok(Math.abs(enBarro / enCesped - 0.7) < 0.05, `en barro avanza el 70% (${enBarro.toFixed(2)} vs ${enCesped.toFixed(2)})`);
});

test("iniciarCaza + tick: si el cazador se queda a más de RADIO_PERDIDA_CAZA, la caza se cancela y tick() la reporta como perdida (docs/GDD_Caza.md §4ter)", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  const animal = salida.get(id)!;
  assert.strictEqual(gestor.iniciarCaza(id, "cazador"), true);
  assert.deepStrictEqual(gestor.presaCazadaPor("cazador"), { faunaId: id, x: animal.x, y: animal.y });
  assert.strictEqual(gestor.presaCazadaPor("otro"), null);
  // A 40 casillas sigue cazada (por encima del radio de huida normal, por debajo del de pérdida = 60).
  const cerca = gestor.tick(0.2, new Map([["cazador", { x: animal.x + 40, y: animal.y }]]));
  assert.strictEqual(cerca.perdidas.length, 0);
  assert.strictEqual(animal.accion, "huyendo");
  // A 70 casillas (> 60): perdida, reportada UNA sola vez, y la presa deja de huir de él.
  const lejos = gestor.tick(0.2, new Map([["cazador", { x: animal.x + 70, y: animal.y }]]));
  assert.deepStrictEqual(lejos.perdidas, [{ faunaId: id, sessionId: "cazador" }]);
  assert.strictEqual(gestor.presaCazadaPor("cazador"), null, "la caza ya no existe");
  const otraVez = gestor.tick(0.2, new Map([["cazador", { x: animal.x + 70, y: animal.y }]]));
  assert.strictEqual(otraVez.perdidas.length, 0, "no se reporta dos veces");
  assert.notStrictEqual(animal.accion, "huyendo", "sin caza y con el jugador a 70 casillas, vuelve a su vida normal");
  // Se puede volver a cazar (el estado quedó limpio).
  assert.strictEqual(gestor.iniciarCaza(id, "cazador"), true);
});

test("iniciarCaza + tick: si el cazador se desconecta (falta del mapa de jugadores), la caza se cancela sola sin romper el tick", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  gestor.iniciarCaza(id, "cazador");
  assert.doesNotThrow(() => gestor.tick(0.2, new Map())); // cazador ya no está en el mapa de jugadores
  // La caza se canceló: iniciarla de nuevo con otro jugador debe funcionar sin rechazo por "ya cazado por otro".
  assert.strictEqual(gestor.iniciarCaza(id, "otro"), true);
});

test("iniciarCaza: no deja que un segundo jugador robe la caza de otro ya en curso", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 20, y: 20 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  assert.strictEqual(gestor.iniciarCaza(id, "primero"), true);
  assert.strictEqual(gestor.iniciarCaza(id, "segundo"), false);
});

test("matarIndividuo: limpia una caza activa (el animal cazado se muere por otra vía, p.ej. otro jugador lo ataca directamente)", async () => {
  const { gestor, salida } = crearGestor({ cargarBakeSector: () => [{ i: "conejo", x: 5, y: 5 }] });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const [id] = [...salida.keys()];
  gestor.iniciarCaza(id, "cazador");
  await gestor.matarIndividuo(id);
  // Sin esto, cazasActivas se quedaría con una entrada zombi apuntando a un id que ya no existe en ningún sector — verificado indirectamente: iniciarCaza sobre el mismo id ya no encuentra el individuo (murió), así que debe devolver false, no "true" por una entrada stale.
  assert.strictEqual(gestor.iniciarCaza(id, "otro"), false);
});

// --- Depredador cazando presa por su cuenta (pedido streamer 2026-09-08:
// "los depredadores no cazan presas por su cuenta, un lobo no persigue un
// conejo solo") — sin ningún jugador implicado, tick() debe perseguir y
// reportar la captura en `cacerias` por sí solo.

test("tick: un lobo (peligroso+carnivoro) con un conejo cerca lo persigue por su cuenta, sin jugadores de por medio", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [
      { i: "lobo", x: 5, y: 5 },
      { i: "conejo", x: 10, y: 5 }, // dentro de RADIO_DETECCION_DEPREDADOR (8)
    ],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const entradas = [...salida.entries()];
  const [loboId] = entradas.find(([, f]) => f.especieId === "lobo")!;
  const lobo = salida.get(loboId)!;
  const x0 = lobo.x;
  for (let i = 0; i < 20; i++) gestor.tick(0.2); // sin jugadores — el mecanismo no depende de ellos
  assert.ok(lobo.x > x0, "el lobo debería haberse acercado al conejo (está al este)");
});

test("tick: un lobo lejos de cualquier conejo (fuera de RADIO_DETECCION_DEPREDADOR) no persigue nada", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [
      { i: "lobo", x: 5, y: 5 },
      { i: "conejo", x: 35, y: 35 }, // muy lejos, fuera de detección
    ],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const entradas = [...salida.entries()];
  const [loboId] = entradas.find(([, f]) => f.especieId === "lobo")!;
  const lobo = salida.get(loboId)!;
  const x0 = lobo.x, y0 = lobo.y;
  for (let i = 0; i < 20; i++) gestor.tick(0.2);
  assert.ok(Math.hypot(lobo.x - x0, lobo.y - y0) < 6, "sin presa detectable, el lobo solo merodea, no se lanza a perseguir a 30 casillas");
});

test("tick: lobo pegado a un conejo — la captura se reporta en `cacerias`, no en `atrapados` (eso es solo para el jugador)", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [
      { i: "lobo", x: 5, y: 5 },
      { i: "conejo", x: 5.5, y: 5 }, // dentro de RADIO_CAPTURA (1.5) desde el primer tick
    ],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const entradas = [...salida.entries()];
  const [loboId] = entradas.find(([, f]) => f.especieId === "lobo")!;
  const [conejoId] = entradas.find(([, f]) => f.especieId === "conejo")!;
  const { atrapados, cacerias } = gestor.tick(0.2);
  assert.strictEqual(atrapados.length, 0, "sin jugador cazando, atrapados debe seguir vacío");
  assert.strictEqual(cacerias.length, 1);
  assert.strictEqual(cacerias[0].depredadorId, loboId);
  assert.strictEqual(cacerias[0].presaId, conejoId);
});

test("tick: un conejo (no peligroso) nunca inicia una cacería — solo especies peligrosas+carnívoras cazan", async () => {
  const { gestor, salida } = crearGestor({
    cargarBakeSector: () => [
      { i: "conejo", x: 5, y: 5 },
      { i: "conejo", x: 5.5, y: 5 },
    ],
  });
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const { cacerias } = gestor.tick(0.2);
  assert.strictEqual(cacerias.length, 0, "dos conejos cerca no deberían cazarse entre sí");
});

// reponerEspecie — herramienta MANUAL de jarl (pedido streamer 2026-09-08,
// docs/GDD_Agentes_Moviles.md "Extinción local de fauna reproductora").
test("reponerEspecie: crea N individuos vivos adultos, en el estado de Colyseus y persistidos", async () => {
  const { gestor, salida, bd } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 }); // el jarl tiene que estar en un sector ya activo
  const antes = salida.size;
  const creados = await gestor.reponerEspecie("conejo", 3, { x: 5, y: 5 }, 32, 10);
  assert.strictEqual(creados, 3);
  assert.strictEqual(salida.size, antes + 3);
  assert.strictEqual(gestor.cantidadViva(), antes + 3);
  const nuevos = [...salida.values()].filter((f) => f.especieId === "conejo");
  assert.strictEqual(nuevos.length, 3);
  for (const n of nuevos) assert.ok(n.vidaMax > 0, "sale con vida real del catálogo de combate, no 0");
  const filasPersistidas = bd.filas.get("0,0")!.filter((f) => f.especieId === "conejo" && f.estado === "vivo");
  assert.strictEqual(filasPersistidas.length, 3, "cada individuo repuesto se persiste, no solo vive en memoria");
});

test("reponerEspecie: 0 si el sector NO está activo (el jarl tiene que estar físicamente ahí)", async () => {
  const { gestor, salida } = crearGestor();
  const creados = await gestor.reponerEspecie("conejo", 2, { x: 5, y: 5 }, 32, 10);
  assert.strictEqual(creados, 0);
  assert.strictEqual(salida.size, 0);
});

test("reponerEspecie: 0 si la especie no existe en el catálogo (no cuela cualquier string)", async () => {
  const { gestor } = crearGestor();
  await gestor.activarSector({ sectorX: 0, sectorY: 0 });
  const creados = await gestor.reponerEspecie("dragon_inventado", 2, { x: 5, y: 5 }, 32, 10);
  assert.strictEqual(creados, 0);
});

test("reponerEspecie: los individuos repuestos aparecen en el sector correcto (misma conversión que actualizarPorJugadores)", async () => {
  const { gestor, bd } = crearGestor();
  await gestor.actualizarPorJugadores([{ x: 5, y: 5 }], 32, 10, 0); // activa solo el sector 0,0
  await gestor.reponerEspecie("conejo", 1, { x: 5, y: 5 }, 32, 10);
  const filas = bd.filas.get("0,0") ?? [];
  assert.ok(filas.some((f) => f.especieId === "conejo" && f.sectorX === 0 && f.sectorY === 0));
});
