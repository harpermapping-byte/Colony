import { Client, getStateCallbacks } from "colyseus.js";
import { SERVER_URL } from "./config";
import { WorldScene } from "./render3d/worldScene";
import { cargarInstanciaEntidad } from "./render3d/entityLoader";

// Colores de referencia de siempre (antes tint de Phaser) — se usan como
// `colorDebug` del placeholder mientras no exista un catálogo de personajes
// con su propio `colorDebug` por facción/clase (pendiente, ver
// docs/GDD_Motor_3D_Props.md).
const COLOR_JUGADOR_LOCAL = "#f6ad55";
const COLOR_JUGADOR_REMOTO = "#4fd1c5";

interface Direction {
  x: number;
  y: number;
}

/**
 * Arranca el juego: conecta a la sala "hub" de Colyseus y sincroniza cada
 * jugador del estado del servidor con una entidad 3D en `WorldScene`.
 * Sustituye a la antigua `MainScene` de Phaser — la lógica de red es
 * idéntica, solo cambia cómo se dibuja cada jugador (modelo/placeholder 3D
 * en vez de sprite plano).
 */
export async function iniciarJuego(contenedor: HTMLElement) {
  const escena = new WorldScene(contenedor, contenedor.clientWidth || 800, contenedor.clientHeight || 600);

  window.addEventListener("resize", () => {
    escena.resize(contenedor.clientWidth || 800, contenedor.clientHeight || 600);
  });

  const client = new Client(SERVER_URL);
  const room = await client.joinOrCreate("hub", {
    name: `Viewer-${Math.floor(Math.random() * 1000)}`,
  });
  const $ = getStateCallbacks(room);

  $(room.state).players.onAdd(async (player: any, sessionId: string) => {
    const esYo = sessionId === room.sessionId;
    const objeto = await cargarInstanciaEntidad({
      categoria: "personajes",
      id: "jugador",
      variante: { tipo: "numerada", indice: 0 },
      colorPlaceholder: esYo ? COLOR_JUGADOR_LOCAL : COLOR_JUGADOR_REMOTO,
      dimensiones: { ancho: 0.6, alto: 1.6, profundo: 0.6 },
    });
    escena.añadirEntidad(sessionId, objeto, player.x, player.y, player.name);
    if (esYo) escena.seguirPunto(player.x, player.y);

    $(player).onChange(() => {
      escena.moverEntidad(sessionId, player.x, player.y);
      if (esYo) escena.seguirPunto(player.x, player.y);
    });
  });

  $(room.state).players.onRemove((_player: any, sessionId: string) => {
    escena.quitarEntidad(sessionId);
  });

  const teclas = new Set<string>();
  window.addEventListener("keydown", (e) => teclas.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => teclas.delete(e.key.toLowerCase()));

  let ultimaDireccionEnviada: Direction = { x: 0, y: 0 };
  function bucle() {
    const x =
      (teclas.has("d") || teclas.has("arrowright") ? 1 : 0) - (teclas.has("a") || teclas.has("arrowleft") ? 1 : 0);
    const y = (teclas.has("s") || teclas.has("arrowdown") ? 1 : 0) - (teclas.has("w") || teclas.has("arrowup") ? 1 : 0);

    if (x !== ultimaDireccionEnviada.x || y !== ultimaDireccionEnviada.y) {
      ultimaDireccionEnviada = { x, y };
      room.send("input", ultimaDireccionEnviada);
    }

    escena.render();
    requestAnimationFrame(bucle);
  }
  bucle();
}
