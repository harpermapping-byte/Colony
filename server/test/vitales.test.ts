// Tests de la lógica PURA de vitales (server/src/personaje/vitales.ts,
// docs/GDD_Personaje.md). Ejecutar: npm test (tsx --test) desde server/.
// NO cubre "vida" — vive en Player.vida/vidaMax (docs/GDD_Mecanicas.md §5.4,
// server/src/combate/combate.ts), ver server/test/combate.test.ts.
import { test } from "node:test";
import * as assert from "node:assert";
import {
  vitalesIniciales, tickVitales, restaurarVital, aplicarInanicion,
  aplicarTemperaturaCorporal, objetivoTemperaturaCorporal,
  VITAL_MAX, TEMPERATURA_NEUTRA, UMBRAL_CALOR_EXTREMO, UMBRAL_FRIO_EXTREMO,
} from "../src/personaje/vitales";

test("vitalesIniciales: un jugador nuevo empieza lleno, caca vacía, temperatura neutra (docs/GDD_Personaje.md §3.6, docs/GDD_Clima.md)", () => {
  const v = vitalesIniciales();
  assert.strictEqual(v.comida, VITAL_MAX);
  assert.strictEqual(v.bebida, VITAL_MAX);
  assert.strictEqual(v.sueno, VITAL_MAX);
  assert.strictEqual(v.estamina, VITAL_MAX);
  assert.strictEqual(v.caca, 0);
  assert.strictEqual(v.temperatura, TEMPERATURA_NEUTRA);
});

test("tickVitales: comida/bebida/sueño decaen con las horas transcurridas, nunca bajan de 0", () => {
  const v = vitalesIniciales();
  tickVitales(v, 16); // exactamente la vida media de comida (100/16 por hora)
  assert.ok(Math.abs(v.comida - 0) < 1e-6, `comida debería quedar en ~0, quedó en ${v.comida}`);
  tickVitales(v, 1000); // horas de más — no debe irse a negativo
  assert.strictEqual(v.comida, 0);
  assert.strictEqual(v.bebida, 0);
  assert.strictEqual(v.sueno, 0);
});

test("tickVitales: estamina se regenera sola hasta el máximo (nada la gasta todavía)", () => {
  const v = vitalesIniciales();
  v.estamina = 50;
  tickVitales(v, 0.5); // regenera 50/1h * 0.5h = 25
  assert.ok(v.estamina > 50 && v.estamina <= VITAL_MAX);
  tickVitales(v, 100);
  assert.strictEqual(v.estamina, VITAL_MAX);
});

test("tickVitales: horasTranscurridas<=0 no hace nada (sin efectos raros con dt=0)", () => {
  const v = vitalesIniciales();
  tickVitales(v, 0);
  assert.deepStrictEqual(v, vitalesIniciales());
});

test("restaurarVital: sube el vital indicado sin pasarse del tope", () => {
  const v = vitalesIniciales();
  v.comida = 30;
  restaurarVital(v, "comida", 40);
  assert.strictEqual(v.comida, 70);
  restaurarVital(v, "comida", 1000);
  assert.strictEqual(v.comida, VITAL_MAX);
});

test("restaurarVital('caca', ...): sube igual que cualquier otro vital, clampado en el tope (docs/GDD_Personaje.md §3.6)", () => {
  const v = vitalesIniciales();
  restaurarVital(v, "caca", 40);
  assert.strictEqual(v.caca, 40);
  restaurarVital(v, "caca", 1000);
  assert.strictEqual(v.caca, VITAL_MAX);
});

test("tickVitales no toca caca (solo sube al comer, solo baja al usar una hoja — nunca por tiempo)", () => {
  const v = vitalesIniciales();
  v.caca = 55;
  tickVitales(v, 20);
  assert.strictEqual(v.caca, 55);
});

test("aplicarInanicion: con comida y bebida > 0, no pasa nada (vidaMax se queda en el normal)", () => {
  const estado = { vida: 80, vidaMax: 190 };
  aplicarInanicion({ comida: 50, bebida: 50 }, estado, 190, 100, 8, 5);
  assert.deepStrictEqual(estado, { vida: 80, vidaMax: 190 });
});

test("aplicarInanicion: comida O bebida a 0 hace daño paulatino Y baja vidaMax al mínimo de nivel 1", () => {
  const estado = { vida: 80, vidaMax: 190 };
  aplicarInanicion({ comida: 0, bebida: 50 }, estado, 190, 100, 8, 2); // 2h * 8/h = 16 de daño
  assert.strictEqual(estado.vidaMax, 100, "vidaMax cae al mínimo mientras dura la inanición");
  assert.strictEqual(estado.vida, 64, `80 - 16 = 64, quedó en ${estado.vida}`);
});

test("aplicarInanicion: el daño nunca baja de 0 (clamp)", () => {
  const estado = { vida: 5, vidaMax: 190 };
  aplicarInanicion({ comida: 0, bebida: 0 }, estado, 190, 100, 8, 100); // daño absurdamente grande
  assert.strictEqual(estado.vida, 0);
});

test("aplicarInanicion: si vida ya superaba el vidaMax de inanición (p.ej. vidaMax normal más alto), se recorta al entrar en inanición", () => {
  const estado = { vida: 150, vidaMax: 190 };
  aplicarInanicion({ comida: 0, bebida: 50 }, estado, 190, 100, 8, 0.5); // recorta a 100, luego resta 4
  assert.strictEqual(estado.vida, 96);
});

test("aplicarInanicion: volver a comer/beber restaura vidaMax al normal en la siguiente llamada", () => {
  const estado = { vida: 60, vidaMax: 100 }; // simula que venía de inanición
  aplicarInanicion({ comida: 40, bebida: 40 }, estado, 190, 100, 8, 1);
  assert.strictEqual(estado.vidaMax, 190, "vidaMax vuelve al normal en cuanto deja de haber inanición");
  assert.strictEqual(estado.vida, 60, "la vida no se toca al recuperarse — nadie se cura solo con el tiempo");
});

test("aplicarInanicion: horasTranscurridas<=0 no hace nada (ni siquiera en inanición)", () => {
  const estado = { vida: 80, vidaMax: 190 };
  aplicarInanicion({ comida: 0, bebida: 0 }, estado, 190, 100, 8, 0);
  assert.deepStrictEqual(estado, { vida: 80, vidaMax: 190 });
});

test("aplicarInanicion: tambienReducirVidaMax=true (temperatura extrema) baja vidaMax pero NO daña vida por sí solo (docs/GDD_Clima.md)", () => {
  const estado = { vida: 80, vidaMax: 190 };
  aplicarInanicion({ comida: 50, bebida: 50 }, estado, 190, 100, 8, 3, true);
  assert.strictEqual(estado.vidaMax, 100, "vidaMax cae igual que con inanición");
  assert.strictEqual(estado.vida, 80, "sin hambre real, la temperatura extrema no daña vida");
});

test("aplicarInanicion: tambienReducirVidaMax=true SÍ recorta vida si superaba el nuevo vidaMax reducido", () => {
  const estado = { vida: 150, vidaMax: 190 };
  aplicarInanicion({ comida: 50, bebida: 50 }, estado, 190, 100, 8, 3, true);
  assert.strictEqual(estado.vidaMax, 100);
  assert.strictEqual(estado.vida, 100, "se recorta al nuevo tope, sin dañar de más");
});

test("aplicarInanicion: hambre real Y temperatura extrema a la vez siguen dañando vida (el hambre manda)", () => {
  const estado = { vida: 80, vidaMax: 190 };
  aplicarInanicion({ comida: 0, bebida: 50 }, estado, 190, 100, 8, 2, true); // 2h * 8/h = 16
  assert.strictEqual(estado.vidaMax, 100);
  assert.strictEqual(estado.vida, 64);
});

test("objetivoTemperaturaCorporal: 15°C es neutro (50), más calor sube el objetivo, más frío lo baja", () => {
  assert.strictEqual(objetivoTemperaturaCorporal(15), TEMPERATURA_NEUTRA);
  assert.ok(objetivoTemperaturaCorporal(30) > TEMPERATURA_NEUTRA);
  assert.ok(objetivoTemperaturaCorporal(-5) < TEMPERATURA_NEUTRA);
});

test("objetivoTemperaturaCorporal: nunca se sale de 0-100 aunque el mundo esté muy caliente/frío", () => {
  assert.strictEqual(objetivoTemperaturaCorporal(1000), VITAL_MAX);
  assert.strictEqual(objetivoTemperaturaCorporal(-1000), 0);
});

test("aplicarTemperaturaCorporal: deriva hacia el objetivo del mundo, sin sobrepasarlo de un salto", () => {
  const v = vitalesIniciales(); // temperatura = 50 (neutro)
  const extremo = aplicarTemperaturaCorporal(v, 30, 1); // objetivo ~87.5, 1h de deriva
  assert.strictEqual(extremo, null, "todavía no ha cruzado el umbral de calor extremo");
  assert.ok(v.temperatura > TEMPERATURA_NEUTRA && v.temperatura < objetivoTemperaturaCorporal(30));
});

test("aplicarTemperaturaCorporal: calor extremo (>=75) gasta bebida extra y devuelve 'calor'", () => {
  const v = vitalesIniciales();
  v.temperatura = 80;
  v.bebida = 50;
  const extremo = aplicarTemperaturaCorporal(v, 35, 1);
  assert.strictEqual(extremo, "calor");
  assert.ok(v.bebida < 50, `bebida debería haber bajado, quedó en ${v.bebida}`);
});

test("aplicarTemperaturaCorporal: frío extremo (<=25) gasta comida extra y devuelve 'frio'", () => {
  const v = vitalesIniciales();
  v.temperatura = 20;
  v.comida = 50;
  const extremo = aplicarTemperaturaCorporal(v, -10, 1);
  assert.strictEqual(extremo, "frio");
  assert.ok(v.comida < 50, `comida debería haber bajado, quedó en ${v.comida}`);
});

test("aplicarTemperaturaCorporal: dentro del rango cómodo no gasta nada extra ni devuelve extremo", () => {
  const v = vitalesIniciales();
  v.temperatura = 55;
  v.comida = 50; v.bebida = 50;
  const extremo = aplicarTemperaturaCorporal(v, 15, 1);
  assert.strictEqual(extremo, null);
  assert.strictEqual(v.comida, 50);
  assert.strictEqual(v.bebida, 50);
});

test("aplicarTemperaturaCorporal: nunca se sale de 0-100 ni con temperaturas absurdas del mundo", () => {
  const v = vitalesIniciales();
  for (let i = 0; i < 50; i++) aplicarTemperaturaCorporal(v, 500, 5);
  assert.strictEqual(v.temperatura, VITAL_MAX);
  const v2 = vitalesIniciales();
  for (let i = 0; i < 50; i++) aplicarTemperaturaCorporal(v2, -500, 5);
  assert.strictEqual(v2.temperatura, 0);
});

test("aplicarTemperaturaCorporal: horasTranscurridas<=0 no hace nada", () => {
  const v = vitalesIniciales();
  const extremo = aplicarTemperaturaCorporal(v, 35, 0);
  assert.strictEqual(extremo, null);
  assert.deepStrictEqual(v, vitalesIniciales());
});

test("umbrales: fuera de [UMBRAL_FRIO_EXTREMO, UMBRAL_CALOR_EXTREMO] es donde arranca el efecto extremo", () => {
  assert.ok(UMBRAL_FRIO_EXTREMO < TEMPERATURA_NEUTRA && TEMPERATURA_NEUTRA < UMBRAL_CALOR_EXTREMO);
});
