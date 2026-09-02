"use strict";

/**
 * Diagnostic test: single player connecting to testflat
 * Waits for proper state synchronization before testing
 */

const { chromium } = require("playwright");
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  try {
    console.log("🔍 Diagnostic: Connecting one player to testflat...\n");
    
    const browser = await chromium.launch({
      headless: true,
      executablePath: "/opt/pw-browsers/chromium",
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("Loading http://localhost:5173/?mapaId=testflat");
    await page.goto("http://localhost:5173/?mapaId=testflat", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    
    console.log("Waiting 3 seconds for initial load...");
    await esperar(3000);

    // Check what's available
    const checkInitial = await page.evaluate(() => ({
      location: location.search,
      hasGameState: !!window.gameState,
      hasDebug: !!window.__colonyDebug,
    }));

    console.log("\nInitial check:");
    console.log(`  URL: ${checkInitial.location}`);
    console.log(`  window.gameState exists: ${checkInitial.hasGameState}`);
    console.log(`  window.__colonyDebug exists: ${checkInitial.hasDebug}`);

    // Wait for room connection and player sync (max 10s)
    console.log("\nWaiting for room connection and player sync...");
    const playerReady = await page.waitForFunction(
      () => window.__colonyDebug?.x !== undefined,
      { timeout: 10000 }
    ).then(() => true).catch(() => false);

    if (!playerReady) {
      console.log("❌ Player failed to sync (timeout after 10s)");
      const debugState = await page.evaluate(() => ({
        debug: window.__colonyDebug,
        gameState: typeof window.gameState,
        errors: window.__debugErrors ? window.__debugErrors.slice(-3) : [],
      }));
      console.log("Debug state:", JSON.stringify(debugState, null, 2));
    } else {
      console.log("✓ Player synchronized");
      const debugState = await page.evaluate(() => window.__colonyDebug);
      console.log(`  Position: (${debugState.x.toFixed(1)}, ${debugState.y.toFixed(1)})`);
      console.log(`  Estado: ${debugState.estado}`);
      console.log(`  Nivel: ${debugState.nivel}`);

      // Try a simple action
      console.log("\nSending test message (ping)...");
      const antes = Date.now();
      await page.evaluate(() => {
        window.gameState?.room?.send("ping", {});
      });
      await esperar(200);
      const latencia = Date.now() - antes;
      console.log(`✓ Message sent (${latencia}ms latency)`);

      // Verify still alive
      const afterAction = await page.evaluate(() => window.__colonyDebug);
      console.log(`  Still alive: ${!!afterAction}`);
    }

    await context.close();
    await browser.close();
    console.log("\n✅ Diagnostic complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

main();
