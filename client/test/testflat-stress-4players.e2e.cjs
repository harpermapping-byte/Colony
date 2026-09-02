"use strict";

/**
 * STRESS TEST: 4 jugadores simultáneos en testflat
 * Versión reducida para diagnosticar problemas de latencia sin saturar Vite dev
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
    console.log("🚀 Stress test reducido: 4 jugadores simultáneos...\n");
    
    const browser = await chromium.launch({
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
    });

    console.log("Conectando 4 jugadores...");
    const context = await browser.newContext();
    const roles = ["crafteo", "cocina", "combate", "recoleccion"];

    // Crear 4 jugadores
    const jugadores = [];
    for (let i = 0; i < 4; i++) {
      try {
        const page = await context.newPage();
        console.log(`  Conectando jugador ${i + 1}/${4} (${roles[i]})...`);
        await page.goto("http://localhost:5173/?mapaId=testflat", {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await page.waitForTimeout(3000);
        jugadores.push({
          page,
          numero: i + 1,
          rol: roles[i],
          errores: [],
          latencias: [],
        });
        console.log(`  ✓ Jugador ${i + 1} conectado`);
      } catch (e) {
        console.log(`  ✗ Jugador ${i + 1}: ${e.message}`);
        metrics.crashes.push(`Jugador ${i + 1}: ${e.message}`);
        fallos++;
      }
    }

    if (jugadores.length < 4) {
      console.log(`\n⚠️ Solo ${jugadores.length}/4 jugadores conectados`);
      throw new Error(`Insufficient players: ${jugadores.length}`);
    }

    // Verificar que todos ven el mapa
    console.log("\nVerificando mapa en cada jugador...");
    for (const player of jugadores) {
      try {
        const estado = await player.page.evaluate(() => ({
          mapaId: window.gameState?.mapaId,
          playerId: window.gameState?.player?.id,
          room: !!window.gameState?.room,
        }));
        console.log(`  Jugador ${player.numero}: mapaId=${estado.mapaId}, playerId=${estado.playerId}, room=${estado.room}`);
        if (estado.mapaId !== "testflat") {
          metrics.errores.push(`Jugador ${player.numero}: mapaId mismatch (${estado.mapaId})`);
        }
      } catch (e) {
        metrics.errores.push(`Jugador ${player.numero} check: ${e.message}`);
      }
    }

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
    };

    async function medirLatencia(page) {
      const antes = Date.now();
      try {
        await page.evaluate(() => {
          window.gameState?.room?.send("ping", {});
        });
        await page.waitForTimeout(100);
      } catch {}
      return Date.now() - antes;
    }

    // Fase 1: Baseline individual
    console.log("\nFase 1: Latencia baseline (5 iteraciones/jugador)...");
    const promesas1 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 5; i++) {
          const latencia = await medirLatencia(player.page);
          player.latencias.push(latencia);
          metrics.latencias.push(latencia);
          await esperar(500);
        }
        const prom = (
          player.latencias.reduce((a, b) => a + b, 0) / player.latencias.length
        ).toFixed(1);
        console.log(`  Jugador ${player.numero}: ${prom}ms`);
      } catch (e) {
        metrics.errores.push(`Jugador ${player.numero} fase 1: ${e.message}`);
      }
    });
    await Promise.all(promesas1);

    // Fase 2: Simultáneo (acciones sin latencia measurement)
    console.log("\nFase 2: Acciones simultáneas (15 iter, 200ms spacing)...");
    const promesas2 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 15; i++) {
          const latencia = await medirLatencia(player.page);
          metrics.latencias.push(latencia);
          if (acciones[player.rol]) {
            await acciones[player.rol](player);
          }
          await esperar(200);
        }
      } catch (e) {
        metrics.errores.push(`Jugador ${player.numero} fase 2: ${e.message}`);
      }
    });
    await Promise.all(promesas2);

    // Fase 3: Verificar final
    console.log("\nFase 3: Verificación final...");
    for (const player of jugadores) {
      try {
        const vivo = await player.page.evaluate(() => {
          return !!window.gameState?.player;
        });
        if (!vivo) {
          metrics.errores.push(`Jugador ${player.numero}: desconectado al final`);
        }
      } catch (e) {
        metrics.crashes.push(`Jugador ${player.numero}: ${e.message}`);
      }
    }

    const elapsed = Date.now() - startTime;
    const latProm = metrics.latencias.reduce((a, b) => a + b, 0) / Math.max(1, metrics.latencias.length);
    
    console.log("\n=== RESULTADOS ===");
    console.log(`Duración: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Latencia: ${latProm.toFixed(1)}ms (min ${Math.min(...metrics.latencias)}, max ${Math.max(...metrics.latencias)})`);
    console.log(`Errores: ${metrics.errores.length}`);
    console.log(`Crashes: ${metrics.crashes.length}`);
    
    if (metrics.errores.length > 0) {
      console.log("\nErrores:");
      metrics.errores.slice(0, 5).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }

    await context.close();
    await browser.close();

    if (metrics.crashes.length > 0 || metrics.errores.length > 3) {
      fallos++;
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    fallos++;
  }

  process.exit(fallos ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
