"use strict";

/**
 * STRESS TEST: 8 jugadores simultáneos en testflat
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
    console.log("🚀 Stress test: 8 jugadores en testflat\n");
    
    const browser = await chromium.launch({
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
    });

    console.log("Conectando 8 jugadores...");
    const context = await browser.newContext();
    const roles = ["crafteo", "cocina", "sasteria", "cultivos", "combate", "recoleccion", "monturas", "construccion"];

    // Crear 8 jugadores
    const jugadores = [];
    for (let i = 0; i < 8; i++) {
      try {
        const page = await context.newPage();
        await page.goto("http://localhost:5173/?mapaId=testflat", {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        
        const sincronizado = await page.waitForFunction(
          () => window.__colonyDebug?.x !== undefined,
          { timeout: 8000 }
        ).then(() => true).catch(() => false);

        if (!sincronizado) {
          metrics.crashes.push(`Jugador ${i + 1}: Timeout`);
          continue;
        }

        jugadores.push({
          page,
          numero: i + 1,
          rol: roles[i],
          latencias: [],
        });
        console.log(`  ✓ Jugador ${i + 1} (${roles[i]})`);
      } catch (e) {
        metrics.crashes.push(`Jugador ${i + 1}: ${e.message}`);
      }
    }

    console.log(`\n${jugadores.length}/8 conectados`);

    const acciones = {
      crafteo: (page) => page.evaluate(() => window.__test?.enviar("crafteo:iniciar", { mesaId: "mesa_despiece", receta: "carrete_hilo_lino_craft" })),
      cocina: (page) => page.evaluate(() => window.__test?.enviar("crafteo:iniciar", { mesaId: "horno_piedra", receta: "pan_hogaza_craft" })),
      sasteria: (page) => page.evaluate(() => window.__test?.enviar("crafteo:iniciar", { mesaId: "telar_lino", receta: "camisa_lino_campesina_craft" })),
      cultivos: (page) => page.evaluate(() => window.__test?.enviar("cultivo:plantar", { x: 150, y: 100, semillaId: "semilla_trigo" })),
      combate: (page) => page.evaluate(() => window.__test?.enviar("combate:iniciar", { adversarioId: "dummy_1" })),
      recoleccion: (page) => page.evaluate(() => window.__test?.enviar("coger", { x: 60, y: 94 })),
      monturas: (page) => page.evaluate(() => window.__test?.enviar("animal:domesticar", { animalId: "testflat-01|fauna_0" })),
      construccion: (page) => page.evaluate(() => window.__test?.enviar("construccion:colocar", { x: 96, y: 120, objeto: "cama_individual", rot: 0 })),
    };

    async function medirLatencia(page) {
      const antes = Date.now();
      try {
        await page.evaluate(() => window.__test?.enviar("ping", {}));
        await esperar(100);
      } catch {}
      return Date.now() - antes;
    }

    // Fase 1: Latencia base
    console.log("\nFase 1: Latencia base (5 iteraciones)...");
    const promesas1 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 5; i++) {
          const lat = await medirLatencia(player.page);
          player.latencias.push(lat);
          metrics.latencias.push(lat);
          await esperar(400);
        }
        const prom = (player.latencias.reduce((a, b) => a + b, 0) / player.latencias.length).toFixed(1);
        console.log(`  Jugador ${player.numero}: ${prom}ms`);
      } catch (e) {
        metrics.errores.push(`${player.numero} F1: ${e.message}`);
      }
    });
    await Promise.all(promesas1);

    // Fase 2: Simultáneo
    console.log("\nFase 2: Acciones simultáneas (8 iteraciones)...");
    const promesas2 = jugadores.map(async (player) => {
      try {
        for (let i = 0; i < 8; i++) {
          const lat = await medirLatencia(player.page);
          metrics.latencias.push(lat);
          if (acciones[player.rol]) {
            await acciones[player.rol](player.page);
          }
          await esperar(250);
        }
      } catch (e) {
        metrics.errores.push(`${player.numero} F2: ${e.message}`);
      }
    });
    await Promise.all(promesas2);

    // Fase 3: Check final
    console.log("\nFase 3: Verificación final...");
    for (const player of jugadores) {
      try {
        const vivo = await player.page.evaluate(() => !!window.__colonyDebug);
        if (!vivo) {
          metrics.errores.push(`${player.numero}: Desconectado`);
        }
      } catch (e) {
        metrics.crashes.push(`${player.numero}: ${e.message}`);
      }
    }

    const elapsed = Date.now() - startTime;
    const latProm = metrics.latencias.reduce((a, b) => a + b, 0) / Math.max(1, metrics.latencias.length);
    
    console.log("\n=== RESULTADOS ===");
    console.log(`Duración: ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Jugadores: ${jugadores.length}/8`);
    console.log(`Latencia: ${latProm.toFixed(1)}ms (${Math.min(...metrics.latencias)}-${Math.max(...metrics.latencias)})`);
    console.log(`Errores: ${metrics.errores.length}`);
    console.log(`Crashes: ${metrics.crashes.length}`);

    await context.close();
    await browser.close();

    process.exit((fallos || metrics.crashes.length > 0) ? 1 : 0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
