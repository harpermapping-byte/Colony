"use strict";

/**
 * STRESS TEST: 4 jugadores simultáneos en testflat (corrected version)
 * Uses window.__colonyDebug for state and window.__test.enviar() for messages
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
    console.log("🚀 Stress test: 4 jugadores en testflat (corrected)\n");
    
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
        console.log(`  Conectando ${i + 1}/4 (${roles[i]})...`);
        await page.goto("http://localhost:5173/?mapaId=testflat", {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        
        // Esperar a que el jugador se sincronice (max 8s)
        const sincronizado = await page.waitForFunction(
          () => window.__colonyDebug?.x !== undefined,
          { timeout: 8000 }
        ).then(() => true).catch(() => false);

        if (!sincronizado) {
          metrics.crashes.push(`Jugador ${i + 1}: No sincronizado tras 8s`);
          continue;
        }

        jugadores.push({
          page,
          numero: i + 1,
          rol: roles[i],
          latencias: [],
        });
        console.log(`  ✓ Jugador ${i + 1} sincronizado`);
      } catch (e) {
        metrics.crashes.push(`Jugador ${i + 1}: ${e.message}`);
        fallos++;
      }
    }

    if (jugadores.length < 4) {
      console.log(`\n⚠️ Solo ${jugadores.length}/4 jugadores conectados`);
    }

    // Verificar posiciones
    console.log("\nVerificando posiciones iniciales...");
    for (const player of jugadores) {
      const pos = await player.page.evaluate(() => window.__colonyDebug);
      console.log(`  Jugador ${player.numero}: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}), estado=${pos.estado}`);
    }

    const acciones = {
      crafteo: (page) => page.evaluate(() => {
        window.__test?.enviar("crafteo:iniciar", {
          mesaId: "mesa_despiece",
          receta: "carrete_hilo_lino_craft",
        });
      }),
      cocina: (page) => page.evaluate(() => {
        window.__test?.enviar("crafteo:iniciar", {
          mesaId: "horno_piedra",
          receta: "pan_hogaza_craft",
        });
      }),
      combate: (page) => page.evaluate(() => {
        window.__test?.enviar("combate:iniciar", {
          adversarioId: "dummy_1",
        });
      }),
      recoleccion: (page) => page.evaluate(() => {
        window.__test?.enviar("coger", { x: 60, y: 94 });
      }),
    };

    async function medirLatencia(page) {
      const antes = Date.now();
      try {
        await page.evaluate(() => {
          window.__test?.enviar("ping", {});
        });
        await esperar(100);
      } catch {}
      return Date.now() - antes;
    }

    // Fase 1: Baseline latency
    console.log("\nFase 1: Medición de latencia base (5 iter/jugador)...");
    const promesas1 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 5; i++) {
          const lat = await medirLatencia(player.page);
          player.latencias.push(lat);
          metrics.latencias.push(lat);
          await esperar(500);
        }
        const prom = (
          player.latencias.reduce((a, b) => a + b, 0) / player.latencias.length
        ).toFixed(1);
        console.log(`  Jugador ${player.numero}: ${prom}ms`);
      } catch (e) {
        metrics.errores.push(`Jugador ${player.numero} fase 1: ${e.message}`);
        fallos++;
      }
    });
    await Promise.all(promesas1);

    // Fase 2: Simultaneous actions
    console.log("\nFase 2: Acciones simultáneas (10 iter, 300ms spacing)...");
    const promesas2 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 10; i++) {
          const lat = await medirLatencia(player.page);
          metrics.latencias.push(lat);
          
          if (acciones[player.rol]) {
            await acciones[player.rol](player.page);
          }
          await esperar(300);
        }
      } catch (e) {
        metrics.errores.push(`Jugador ${player.numero} fase 2: ${e.message}`);
        fallos++;
      }
    });
    await Promise.all(promesas2);

    // Fase 3: Final check
    console.log("\nFase 3: Verificación final...");
    for (const player of jugadores) {
      try {
        const vivo = await player.page.evaluate(() => !!window.__colonyDebug);
        if (!vivo) {
          metrics.errores.push(`Jugador ${player.numero}: Desconectado`);
          fallos++;
        }
      } catch (e) {
        metrics.crashes.push(`Jugador ${player.numero}: ${e.message}`);
        fallos++;
      }
    }

    const elapsed = Date.now() - startTime;
    const latProm = metrics.latencias.reduce((a, b) => a + b, 0) / Math.max(1, metrics.latencias.length);
    
    console.log("\n=== RESULTADOS ===");
    console.log(`Duración: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Latencia: ${latProm.toFixed(1)}ms (${Math.min(...metrics.latencias)}-${Math.max(...metrics.latencias)}ms)`);
    console.log(`Errores: ${metrics.errores.length}`);
    console.log(`Crashes: ${metrics.crashes.length}`);
    
    if (metrics.errores.length > 0) {
      console.log("\nErrores:");
      metrics.errores.slice(0, 3).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }

    await context.close();
    await browser.close();

    if (fallos === 0 && metrics.crashes.length === 0) {
      console.log("\n✅ Stress test PASSED");
      process.exit(0);
    } else {
      console.log(`\n⚠️ ${fallos} fallos detectados`);
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
