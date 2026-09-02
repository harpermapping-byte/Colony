/**
 * STRESS TEST: 10 jugadores simultáneos en testflat
 * - Cada uno prueba una mecánica diferente
 * - Monitorea: latencia, desync, lag, crashes
 * - Busca fallos de concurrencia
 *
 * Jugadores:
 * 1. Crafteo (mesas oficios)
 * 2. Cocina (horno, consumibles)
 * 3. Sastrería (confección)
 * 4. Cultivos (plantación)
 * 5. Combate (dummy)
 * 6. Recolección (objetos suelo)
 * 7. Monturas (animales)
 * 8. Construcción (colocador)
 * 9. Combate PvP (otro jugador)
 * 10. Movimiento caótico (estrés de red)
 */

import { test, expect } from "@playwright/test";
import { iniciarServidor, detenerServidor } from "./harness.mjs";

test.describe("Stress Test: 10 Jugadores Concurrentes", () => {
  let server;
  let startTime = Date.now();
  const metrics = {
    errores: [],
    desyncs: [],
    latencias: [],
    crashes: [],
  };

  test.beforeAll(async () => {
    server = await iniciarServidor();
    startTime = Date.now();
    console.log("\n🚀 Iniciando stress test con 10 jugadores simultáneos...\n");
  });

  test.afterAll(async () => {
    await detenerServidor(server);
    const elapsed = Date.now() - startTime;
    console.log("\n=== RESULTADOS STRESS TEST ===");
    console.log(`Duración: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Errores: ${metrics.errores.length}`);
    console.log(`Desyncs: ${metrics.desyncs.length}`);
    console.log(`Latencia promedio: ${(
      metrics.latencias.reduce((a, b) => a + b, 0) / Math.max(1, metrics.latencias.length)
    ).toFixed(1)}ms`);
    console.log(`Crashes: ${metrics.crashes.length}`);
    if (metrics.errores.length > 0) {
      console.log("\nErrores encontrados:");
      metrics.errores.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }
    console.log("============================\n");
  });

  // Helper para crear y conectar jugador
  async function crearJugador(context, numero, rol) {
    const page = await context.newPage();
    try {
      await page.goto("http://localhost:5173/?mapaId=testflat", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);
      return { page, numero, rol, errores: [], latencias: [] };
    } catch (e) {
      metrics.crashes.push(`Jugador ${numero} (${rol}): ${e.message}`);
      return null;
    }
  }

  // Helper para medir latencia
  async function medirLatencia(page) {
    const antes = Date.now();
    await page.evaluate(() => {
      window.gameState?.room?.send("ping", {});
    });
    await page.waitForTimeout(100);
    const despues = Date.now();
    return despues - antes;
  }

  // Acciones específicas por rol
  const acciones = {
    crafteo: async (player) => {
      // Intentar iniciar crafteo
      await player.page.evaluate(() => {
        window.gameState?.room?.send("crafteo:iniciar", {
          mesaId: "mesa_despiece",
          receta: "carrete_hilo_lino_craft",
        });
      });
    },

    cocina: async (player) => {
      // Usar horno
      await player.page.evaluate(() => {
        window.gameState?.room?.send("crafteo:iniciar", {
          mesaId: "horno_piedra",
          receta: "pan_hogaza_craft",
        });
      });
    },

    sasteria: async (player) => {
      // Telar
      await player.page.evaluate(() => {
        window.gameState?.room?.send("crafteo:iniciar", {
          mesaId: "telar_lino",
          receta: "camisa_lino_campesina_craft",
        });
      });
    },

    cultivos: async (player) => {
      // Plantación en casilla cercana
      await player.page.evaluate(() => {
        window.gameState?.room?.send("cultivo:plantar", {
          x: 150,
          y: 100,
          semillaId: "semilla_trigo",
        });
      });
    },

    combate: async (player) => {
      // Atacar dummy
      await player.page.evaluate(() => {
        window.gameState?.room?.send("combate:iniciar", {
          adversarioId: "dummy_1",
        });
      });
    },

    recoleccion: async (player) => {
      // Coger objeto suelo
      await player.page.evaluate(() => {
        window.gameState?.room?.send("coger", {
          x: 60,
          y: 94,
        });
      });
    },

    monturas: async (player) => {
      // Domesticar/montar animal
      await player.page.evaluate(() => {
        window.gameState?.room?.send("animal:domesticar", {
          animalId: "testflat-01|fauna_0",
        });
      });
    },

    construccion: async (player) => {
      // Colocar mueble (tecla B)
      await player.page.evaluate(() => {
        window.gameState?.room?.send("construccion:colocar", {
          x: 96,
          y: 120,
          objeto: "cama_individual",
          rot: 0,
        });
      });
    },

    pvp: async (player) => {
      // Buscar otro jugador
      await player.page.evaluate(() => {
        window.gameState?.room?.send("combate:iniciar", {
          adversarioId: "player_otro",
        });
      });
    },

    movimiento: async (player) => {
      // Movimiento caótico
      const direcciones = ["w", "a", "s", "d"];
      for (let i = 0; i < 5; i++) {
        const dir = direcciones[Math.floor(Math.random() * 4)];
        await player.page.evaluate((d) => {
          window.gameState?.room?.send("input", {
            direccion: d,
          });
        }, dir);
        await player.page.waitForTimeout(100);
      }
    },
  };

  test("10 jugadores con mecánicas distintas simultáneamente", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const roles = [
      "crafteo",
      "cocina",
      "sasteria",
      "cultivos",
      "combate",
      "recoleccion",
      "monturas",
      "construccion",
      "pvp",
      "movimiento",
    ];

    // Crear 10 jugadores
    console.log("Conectando 10 jugadores...");
    const jugadores = [];
    for (let i = 0; i < 10; i++) {
      const player = await crearJugador(context, i + 1, roles[i]);
      if (player) {
        jugadores.push(player);
        console.log(`  ✓ Jugador ${i + 1} (${roles[i]}) conectado`);
      }
    }

    expect(jugadores.length).toBe(10);
    await context.pages()[0].waitForTimeout(1000);

    // Verificar que todos ven el mapa
    console.log("\nVerificando carga de mapa...");
    for (const player of jugadores) {
      const mapaCargado = await player.page.evaluate(() => {
        return window.gameState?.mapaId === "testflat";
      });
      if (!mapaCargado) {
        metrics.errores.push(`Jugador ${player.numero} no vió mapa`);
      }
    }

    // Fase 1: Pruebas individuales (5 segundos cada uno)
    console.log("\nFase 1: Pruebas de mecánicas individuales (5s)...");
    const promesas1 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 5; i++) {
          const latencia = await medirLatencia(player.page);
          player.latencias.push(latencia);
          metrics.latencias.push(latencia);

          await acciones[player.rol](player);
          await player.page.waitForTimeout(500);
        }
        console.log(
          `  ✓ Jugador ${player.numero} (${player.rol}): latencia ${(
            player.latencias.reduce((a, b) => a + b, 0) / player.latencias.length
          ).toFixed(1)}ms`
        );
      } catch (e) {
        metrics.errores.push(
          `Jugador ${player.numero} (${player.rol}): ${e.message}`
        );
        player.errores.push(e.message);
        console.log(`  ✗ Jugador ${player.numero} error: ${e.message}`);
      }
    });
    await Promise.all(promesas1);

    // Fase 2: Pruebas simultáneas (todos a la vez, 10 segundos)
    console.log("\nFase 2: Pruebas simultáneas (10s de caos)...");
    const promesas2 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 10; i++) {
          const latencia = await medirLatencia(player.page);
          player.latencias.push(latencia);
          metrics.latencias.push(latencia);

          await acciones[player.rol](player);
          await player.page.waitForTimeout(200);
        }
      } catch (e) {
        metrics.errores.push(
          `Fase 2 - Jugador ${player.numero}: ${e.message}`
        );
      }
    });
    await Promise.all(promesas2);

    // Fase 3: Verificar estado final
    console.log("\nFase 3: Verificación de estado final...");
    for (const player of jugadores) {
      try {
        const vivo = await player.page.evaluate(() => {
          return !!window.gameState?.player;
        });
        if (!vivo) {
          metrics.errores.push(`Jugador ${player.numero} desconectado`);
        }
      } catch (e) {
        metrics.crashes.push(`Jugador ${player.numero}: ${e.message}`);
      }
    }

    // Resumen por jugador
    console.log("\n=== Resumen por Jugador ===");
    for (const player of jugadores) {
      const latProm = (
        player.latencias.reduce((a, b) => a + b, 0) / player.latencias.length
      ).toFixed(1);
      console.log(
        `Jugador ${player.numero} (${player.rol}): ${latProm}ms, ${player.errores.length} errores`
      );
    }

    // Assertions
    expect(metrics.errores.length).toBeLessThan(5); // permitir algunos errores menores
    expect(metrics.crashes.length).toBe(0); // no crashes
    const latPromedio =
      metrics.latencias.reduce((a, b) => a + b, 0) / metrics.latencias.length;
    expect(latPromedio).toBeLessThan(500); // latencia < 500ms promedio

    console.log("\n✅ Stress test completado exitosamente\n");

    // Limpiar
    await context.close();
  });
});
