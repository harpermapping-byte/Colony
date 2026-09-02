// Tests de la cola de exclusión mutua (server/src/concurrencia/colaPorClave.ts)
// — la pieza que cierra las carreras encontradas en el testeo de concurrencia
// de 2026-09-01 (dos mensajes solapados sobre la misma construcción pisando
// el estado que escribió el otro). Ejecutar: npm test (tsx --test) desde server/.
import { test } from "node:test";
import * as assert from "node:assert";
import { ColaPorClave } from "../src/concurrencia/colaPorClave";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("dos tareas con la MISMA clave nunca se solapan (la segunda espera a que la primera termine)", async () => {
  const cola = new ColaPorClave();
  const eventos: string[] = [];

  const tareaA = cola.ejecutar(1, async () => {
    eventos.push("A:inicio");
    await esperar(20);
    eventos.push("A:fin");
  });
  const tareaB = cola.ejecutar(1, async () => {
    eventos.push("B:inicio");
    await esperar(5);
    eventos.push("B:fin");
  });

  await Promise.all([tareaA, tareaB]);
  assert.deepStrictEqual(eventos, ["A:inicio", "A:fin", "B:inicio", "B:fin"]);
});

test("dos tareas con clave DISTINTA corren en paralelo, no se bloquean entre sí", async () => {
  const cola = new ColaPorClave();
  const eventos: string[] = [];

  const tareaA = cola.ejecutar("cofre_1", async () => {
    eventos.push("A:inicio");
    await esperar(20);
    eventos.push("A:fin");
  });
  const tareaB = cola.ejecutar("cofre_2", async () => {
    eventos.push("B:inicio");
    await esperar(5);
    eventos.push("B:fin");
  });

  await Promise.all([tareaA, tareaB]);
  // B es más corta y arranca casi a la vez que A (clave distinta): termina ANTES que A.
  assert.deepStrictEqual(eventos, ["A:inicio", "B:inicio", "B:fin", "A:fin"]);
});

test("el lector concurrente ve el resultado del escritor anterior, nunca un estado a medias (regresión real: produccion:recolectar duplicaba stock)", async () => {
  const cola = new ColaPorClave();
  let stock = 100;

  async function cosechar(): Promise<number> {
    return cola.ejecutar("granja_1", async () => {
      const disponible = stock; // snapshot "en memoria", como `extraActual` en RoomExteriorBase
      await esperar(10); // el await que en el código real es la BD/cálculo de producción
      stock = 0; // se lo lleva todo
      return disponible;
    });
  }

  const [cosechaJugadorA, cosechaJugadorB] = await Promise.all([cosechar(), cosechar()]);
  // sin la cola, ambos verían disponible=100 y el jugador duplicaría 100 unidades de la nada.
  assert.strictEqual(cosechaJugadorA + cosechaJugadorB, 100);
});

test("una tarea que rechaza no atasca la cola para las siguientes con la misma clave", async () => {
  const cola = new ColaPorClave();
  const tareaQueFalla = cola.ejecutar("x", async () => {
    throw new Error("boom");
  });
  await assert.rejects(tareaQueFalla, /boom/);

  const eventos: string[] = [];
  await cola.ejecutar("x", async () => {
    eventos.push("siguiente:ok");
  });
  assert.deepStrictEqual(eventos, ["siguiente:ok"]);
});

test("el resultado de cada tarea se devuelve a su propio llamador, no se mezcla con el de otra clave", async () => {
  const cola = new ColaPorClave();
  const [r1, r2, r3] = await Promise.all([
    cola.ejecutar("a", async () => 1),
    cola.ejecutar("b", async () => 2),
    cola.ejecutar("a", async () => 3),
  ]);
  assert.strictEqual(r1, 1);
  assert.strictEqual(r2, 2);
  assert.strictEqual(r3, 3);
});
