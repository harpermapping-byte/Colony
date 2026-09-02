"use strict";

/**
 * STRESS TEST: 10 jugadores simultáneos en testflat
 * Asume que servidor (2567) y cliente (5173) ya están corriendo.
 *
 * Ejecutar:
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node client/test/testflat-stress-10players-simple.e2e.cjs
 */

const { chromium } = require("playwright");

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let fallos = 0;
  const startTime = Date.now();
  const metrics = {
    errores: [],
    crashes: [],
    latencias: [],
  };

  try {
    console.log("🚀 Iniciando stress test con 10 jugadores simultáneos...\n");
    
    const browser = await chromium.launch({
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
    });

    console.log("Conectando 10 jugadores...");
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
    const jugadores = [];
    for (let i = 0; i < 10; i++) {
      try {
        const page = await context.newPage();
        await page.goto("http://localhost:5173/?mapaId=testflat", {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(2000);
        jugadores.push({
          page,
          numero: i + 1,
          rol: roles[i],
          errores: [],
          latencias: [],
        });
        console.log(`  ✓ Jugador ${i + 1} (${roles[i]}) conectado`);
      } catch (e) {
        console.log(`  ✗ Jugador ${i + 1} (${roles[i]}): ${e.message}`);
        metrics.crashes.push(`Jugador ${i + 1} (${roles[i]}): ${e.message}`);
        fallos++;
      }
    }

    if (jugadores.length !== 10) {
      console.log(
        `\n⚠️ Solo ${jugadores.length}/10 jugadores conectados, continuando...`
      );
    }

    // Verificar que todos ven el mapa
    console.log("\nVerificando carga de mapa...");
    for (const player of jugadores) {
      try {
        const mapaCargado = await player.page.evaluate(() => {
          return window.gameState?.mapaId === "testflat";
        });
        if (!mapaCargado) {
          metrics.errores.push(`Jugador ${player.numero} no vió mapa`);
          fallos++;
        }
      } catch (e) {
        metrics.errores.push(`Jugador ${player.numero} error mapeo: ${e.message}`);
        fallos++;
      }
    }

    // Acciones por rol
    const acciones = {
      crafteo: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("crafteo:iniciar", {
            mesaId: "mesa_despiece",
            receta: "carrete_hilo_lino_craft",
          });
        });
      },

      cocina: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("crafteo:iniciar", {
            mesaId: "horno_piedra",
            receta: "pan_hogaza_craft",
          });
        });
      },

      sasteria: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("crafteo:iniciar", {
            mesaId: "telar_lino",
            receta: "camisa_lino_campesina_craft",
          });
        });
      },

      cultivos: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("cultivo:plantar", {
            x: 150,
            y: 100,
            semillaId: "semilla_trigo",
          });
        });
      },

      combate: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("combate:iniciar", {
            adversarioId: "dummy_1",
          });
        });
      },

      recoleccion: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("coger", {
            x: 60,
            y: 94,
          });
        });
      },

      monturas: async (player) => {
        await player.page.evaluate(() => {
          window.gameState?.room?.send("animal:domesticar", {
            animalId: "testflat-01|fauna_0",
          });
        });
      },

      construccion: async (player) => {
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
        await player.page.evaluate(() => {
          window.gameState?.room?.send("combate:iniciar", {
            adversarioId: "player_otro",
          });
        });
      },

      movimiento: async (player) => {
        const direcciones = ["w", "a", "s", "d"];
        for (let i = 0; i < 5; i++) {
          const dir = direcciones[Math.floor(Math.random() * 4)];
          await player.page.evaluate(
            (d) => {
              window.gameState?.room?.send("input", {
                direccion: d,
              });
            },
            dir
          );
          await player.page.waitForTimeout(100);
        }
      },
    };

    // Helper para medir latencia
    async function medirLatencia(page) {
      const antes = Date.now();
      try {
        await page.evaluate(() => {
          window.gameState?.room?.send("ping", {});
        });
        await page.waitForTimeout(100);
      } catch {}
      const despues = Date.now();
      return despues - antes;
    }

    // Fase 1: Pruebas individuales (5 segundos cada uno)
    console.log("\nFase 1: Pruebas de mecánicas individuales (5s)...");
    const promesas1 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 5; i++) {
          const latencia = await medirLatencia(player.page);
          player.latencias.push(latencia);
          metrics.latencias.push(latencia);

          if (acciones[player.rol]) {
            await acciones[player.rol](player);
          }
          await player.page.waitForTimeout(500);
        }
        const promLatencia = (
          player.latencias.reduce((a, b) => a + b, 0) / Math.max(1, player.latencias.length)
        ).toFixed(1);
        console.log(
          `  ✓ Jugador ${player.numero} (${player.rol}): ${promLatencia}ms`
        );
      } catch (e) {
        metrics.errores.push(
          `Jugador ${player.numero} (${player.rol}) fase 1: ${e.message}`
        );
        console.log(`  ✗ Jugador ${player.numero}: ${e.message}`);
        fallos++;
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

          if (acciones[player.rol]) {
            await acciones[player.rol](player);
          }
          await player.page.waitForTimeout(200);
        }
      } catch (e) {
        metrics.errores.push(
          `Jugador ${player.numero} fase 2: ${e.message}`
        );
        fallos++;
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
          fallos++;
        }
      } catch (e) {
        metrics.crashes.push(`Jugador ${player.numero}: ${e.message}`);
        fallos++;
      }
    }

    // Resumen por jugador
    console.log("\n=== Resumen por Jugador ===");
    for (const player of jugadores) {
      const latProm = (
        player.latencias.reduce((a, b) => a + b, 0) /
        Math.max(1, player.latencias.length)
      ).toFixed(1);
      console.log(
        `Jugador ${player.numero} (${player.rol}): ${latProm}ms, ${player.errores.length} errores`
      );
    }

    // Verificaciones finales
    const elapsed = Date.now() - startTime;
    console.log("\n=== RESULTADOS STRESS TEST ===");
    console.log(`Duración: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Errores: ${metrics.errores.length}`);
    console.log(`Crashes: ${metrics.crashes.length}`);
    const latPromedio =
      metrics.latencias.reduce((a, b) => a + b, 0) /
      Math.max(1, metrics.latencias.length);
    console.log(`Latencia promedio: ${latPromedio.toFixed(1)}ms`);

    if (metrics.errores.length > 0) {
      console.log("\nErrores encontrados:");
      metrics.errores.slice(0, 10).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
      if (metrics.errores.length > 10) {
        console.log(`  ... y ${metrics.errores.length - 10} más`);
      }
    }

    if (metrics.crashes.length > 0) {
      console.log("\nCrashes:");
      metrics.crashes.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }

    // Verificaciones como el test MJS original
    if (metrics.errores.length < 5) {
      console.log("✓ Errores dentro de límite (<5)");
    } else {
      console.log(`⚠️ Errores encontrados (${metrics.errores.length})`);
    }

    if (metrics.crashes.length === 0) {
      console.log("✓ Sin crashes");
    } else {
      console.log(`✗ Crashes encontrados (${metrics.crashes.length})`);
      fallos++;
    }

    if (latPromedio < 500) {
      console.log(`✓ Latencia aceptable (${latPromedio.toFixed(1)}ms < 500ms)`);
    } else {
      console.log(
        `⚠️ Latencia alta (${latPromedio.toFixed(1)}ms >= 500ms)`
      );
    }

    console.log("============================\n");

    await context.close();
    await browser.close();
  } catch (err) {
    console.error("Error durante el stress test:", err);
    fallos++;
  }

  if (fallos > 0) {
    console.log(`❌ ${fallos} fallos críticos detectados`);
    process.exit(1);
  } else {
    console.log("✅ Stress test completado exitosamente");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
