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
