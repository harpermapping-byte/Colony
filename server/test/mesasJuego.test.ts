// Mesas de minijuego (docs/GDD_Mesas_Minijuego.md, pedido 2026-08-30):
// mesasJuego.ts es PURO (sin Colyseus/BD) — geometría de asientos (rotación
// de un punto+dirección dentro de una huella) y bookkeeping de silla/turno,
// testeados sin levantar ningún servidor. Mismo estilo que
// mejoraMesaAdyacente.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  MESAS_JUEGO,
  rotarPunto,
  rotarDireccion,
  posicionSilla,
  elegirSillaLibre,
  ocupanteDe,
  mesaCompleta,
  mesaVacia,
  type EstadoAsientosMesaJuego,
} from "../src/construccion/mesasJuego";

// ---------------------------------------------------------------- geometría

test("rotarPunto: rot 0 no cambia nada", () => {
  assert.deepStrictEqual(rotarPunto(0.5, 1.0, [3, 2], 0), { x: 0.5, y: 1.0 });
});

test("rotarPunto: las 4 esquinas de la huella siguen el sentido horario (NO->NE->SE->SO->NO)", () => {
  const huella: [number, number] = [3, 2]; // [ancho W, largo H]
  // esquina noroeste (0,0) original
  assert.deepStrictEqual(rotarPunto(0, 0, huella, 0), { x: 0, y: 0 }); // sigue NO
  assert.deepStrictEqual(rotarPunto(0, 0, huella, 1), { x: 2, y: 0 }); // pasa a NE de la caja rotada [2,3]
  assert.deepStrictEqual(rotarPunto(0, 0, huella, 2), { x: 3, y: 2 }); // pasa a SE de la caja [3,2]
  assert.deepStrictEqual(rotarPunto(0, 0, huella, 3), { x: 0, y: 3 }); // pasa a SO de la caja [2,3]
});

test("rotarPunto: rot fuera de 0-3 se normaliza (5 === 1, -1 === 3)", () => {
  assert.deepStrictEqual(rotarPunto(0, 0, [3, 2], 5), rotarPunto(0, 0, [3, 2], 1));
  assert.deepStrictEqual(rotarPunto(0, 0, [3, 2], -1), rotarPunto(0, 0, [3, 2], 3));
});

test("rotarDireccion: un paso horario manda Norte->Este->Sur->Oeste->Norte", () => {
  const NORTE = { x: 0, y: -1 };
  assert.deepStrictEqual(rotarDireccion(0, -1, 1), { x: 1, y: 0 }); // Norte -> Este
  assert.deepStrictEqual(rotarDireccion(1, 0, 1), { x: 0, y: 1 }); // Este -> Sur
  assert.deepStrictEqual(rotarDireccion(0, 1, 1), { x: -1, y: 0 }); // Sur -> Oeste
  assert.deepStrictEqual(rotarDireccion(-1, 0, 1), NORTE); // Oeste -> Norte (vuelta completa)
  assert.deepStrictEqual(rotarDireccion(0, -1, 4), NORTE); // 4 pasos = vuelta completa, sin cambio
});

test("posicionSilla: mesa_ajedrez, las 2 sillas caen DENTRO de la huella rotada para los 4 rot, y nunca coinciden", () => {
  const def = MESAS_JUEGO["mesa_ajedrez"];
  for (let rot = 0; rot < 4; rot++) {
    const [wRot, hRot] = rot % 2 === 1 ? [def.huella[1], def.huella[0]] : def.huella;
    const construccion = { x: 10, y: 20, rot };
    const blancas = posicionSilla("mesa_ajedrez", construccion, "blancas")!;
    const negras = posicionSilla("mesa_ajedrez", construccion, "negras")!;
    for (const silla of [blancas, negras]) {
      // relativo a la esquina noroeste (10,20): debe caer dentro de [0,wRot]x[0,hRot]
      const relX = silla.x - 10;
      const relY = silla.y - 20;
      assert.ok(relX >= 0 && relX <= wRot, `rot ${rot}: x local ${relX} fuera de [0,${wRot}]`);
      assert.ok(relY >= 0 && relY <= hRot, `rot ${rot}: y local ${relY} fuera de [0,${hRot}]`);
      // el vector "mirando" sigue siendo unitario y axis-aligned tras rotar
      assert.strictEqual(Math.abs(silla.mirandoDx) + Math.abs(silla.mirandoDy), 1);
    }
    assert.notDeepStrictEqual({ x: blancas.x, y: blancas.y }, { x: negras.x, y: negras.y }, `rot ${rot}: las 2 sillas coinciden`);
  }
});

test("posicionSilla: rot 0 coloca blancas al este y negras al oeste, mirándose de frente", () => {
  const construccion = { x: 0, y: 0, rot: 0 };
  const blancas = posicionSilla("mesa_ajedrez", construccion, "blancas")!;
  const negras = posicionSilla("mesa_ajedrez", construccion, "negras")!;
  assert.ok(blancas.x > negras.x, "blancas debe quedar al este de negras en rot 0");
  assert.deepStrictEqual({ dx: blancas.mirandoDx, dy: blancas.mirandoDy }, { dx: -1, dy: 0 }); // mira al oeste, hacia negras
  assert.deepStrictEqual({ dx: negras.mirandoDx, dy: negras.mirandoDy }, { dx: 1, dy: 0 }); // mira al este, hacia blancas
});

test("posicionSilla: id de mesa de juego desconocido devuelve null (nunca revienta)", () => {
  assert.strictEqual(posicionSilla("mesa_que_no_existe", { x: 0, y: 0, rot: 0 }, "blancas"), null);
});

// --------------------------------------------------------- asientos/turno

function mesaVacia_(): EstadoAsientosMesaJuego {
  return { sillaBlancas: "", sillaNegras: "" };
}

test("elegirSillaLibre: mesa vacía sin preferencia elige blancas primero", () => {
  assert.strictEqual(elegirSillaLibre(mesaVacia_()), "blancas");
});

test("elegirSillaLibre: preferida libre se respeta", () => {
  assert.strictEqual(elegirSillaLibre(mesaVacia_(), "negras"), "negras");
});

test("elegirSillaLibre: preferida OCUPADA cae a la otra libre (no revienta ni la fuerza)", () => {
  const mesa: EstadoAsientosMesaJuego = { sillaBlancas: "sesionA", sillaNegras: "" };
  assert.strictEqual(elegirSillaLibre(mesa, "blancas"), "negras");
});

test("elegirSillaLibre: las 2 ocupadas devuelve null", () => {
  const mesa: EstadoAsientosMesaJuego = { sillaBlancas: "sesionA", sillaNegras: "sesionB" };
  assert.strictEqual(elegirSillaLibre(mesa), null);
  assert.strictEqual(elegirSillaLibre(mesa, "blancas"), null);
});

test("ocupanteDe / mesaCompleta / mesaVacia", () => {
  const mesa: EstadoAsientosMesaJuego = { sillaBlancas: "", sillaNegras: "" };
  assert.strictEqual(ocupanteDe(mesa, "blancas"), "");
  assert.strictEqual(mesaCompleta(mesa), false);
  assert.strictEqual(mesaVacia(mesa), true);

  mesa.sillaBlancas = "sesionA";
  assert.strictEqual(mesaCompleta(mesa), false);
  assert.strictEqual(mesaVacia(mesa), false);

  mesa.sillaNegras = "sesionB";
  assert.strictEqual(ocupanteDe(mesa, "negras"), "sesionB");
  assert.strictEqual(mesaCompleta(mesa), true);
  assert.strictEqual(mesaVacia(mesa), false);
});
