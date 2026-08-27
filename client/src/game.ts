import { Client, getStateCallbacks } from "colyseus.js";
import { SERVER_URL } from "./config";
import { WorldScene } from "./render3d/worldScene";
import { crearRigHumanoide, type RigHumanoide } from "./render3d/rigHumanoide";
import { cargarMapa } from "./mapa/cargarMapa";
import { crearTerreno } from "./render3d/terreno";
import { crearPropsBakeados } from "./render3d/propsBakeados";

// Colores de referencia de siempre (antes tint de Phaser) — túnica del rig
// placeholder mientras no exista un catálogo de personajes con su propio
// `colorDebug` por facción/clase (pendiente, ver docs/GDD_Motor_3D_Props.md).
const COLOR_JUGADOR_LOCAL = "#f6ad55";
const COLOR_JUGADOR_REMOTO = "#4fd1c5";

// Mapa bakeado que carga el cliente (assets/mapas/<nombre>/ — el bakeador
// escribió ahí sus sectores; el cliente solo materializa lo que dicen).
const RUTA_MAPA = "/assets/mapas/demo";

const PIXELES_POR_UNIDAD = 32; // coords del servidor (px) -> unidades de mundo (1 = 1 casilla)

interface Direction {
  x: number;
  y: number;
}

interface EstadoJugador {
  rig: RigHumanoide;
  // posición REAL en unidades de mundo que dicta el servidor (destino)
  destinoX: number;
  destinoZ: number;
  // posición dibujada este frame (persigue al destino, para que los patches
  // de red a 15/seg no se vean como teletransportes)
  x: number;
  z: number;
}

/**
 * Arranca el juego: carga el mapa bakeado (terreno + props), conecta a la
 * sala "hub" de Colyseus y sincroniza cada jugador del estado del servidor
 * con un rig humanoide animado en `WorldScene`. La lógica de red es la de
 * siempre (mensaje "input" solo cuando cambia la dirección).
 */
export async function iniciarJuego(contenedor: HTMLElement) {
  const escena = new WorldScene(contenedor, contenedor.clientWidth || 800, contenedor.clientHeight || 600);

  window.addEventListener("resize", () => {
    escena.resize(contenedor.clientWidth || 800, contenedor.clientHeight || 600);
  });

  // --- Mundo bakeado: terreno + vegetación/rocas/fauna en sus casillas ---
  try {
    const mapa = await cargarMapa(RUTA_MAPA);
    escena.añadirEstatico(crearTerreno(mapa));
    escena.añadirEstatico(await crearPropsBakeados(mapa));
  } catch (err) {
    // Sin mapa no se corta el juego (los jugadores siguen sincronizando
    // sobre el suelo de emergencia), pero el fallo queda visible.
    console.error("No se pudo cargar el mapa bakeado:", err);
  }

  const client = new Client(SERVER_URL);
  const room = await client.joinOrCreate("hub", {
    name: `Viewer-${Math.floor(Math.random() * 1000)}`,
  });
  const $ = getStateCallbacks(room);

  const jugadores = new Map<string, EstadoJugador>();

  $(room.state).players.onAdd((player: any, sessionId: string) => {
    const esYo = sessionId === room.sessionId;
    const rig = crearRigHumanoide({ colorTunica: esYo ? COLOR_JUGADOR_LOCAL : COLOR_JUGADOR_REMOTO });
    const estado: EstadoJugador = {
      rig,
      destinoX: player.x / PIXELES_POR_UNIDAD,
      destinoZ: player.y / PIXELES_POR_UNIDAD,
      x: player.x / PIXELES_POR_UNIDAD,
      z: player.y / PIXELES_POR_UNIDAD,
    };
    jugadores.set(sessionId, estado);
    escena.añadirEntidad(sessionId, rig.objeto, player.x, player.y, player.name);
    if (esYo) escena.seguirPunto(player.x, player.y, true);

    $(player).onChange(() => {
      estado.destinoX = player.x / PIXELES_POR_UNIDAD;
      estado.destinoZ = player.y / PIXELES_POR_UNIDAD;
      if (esYo) escena.seguirPunto(player.x, player.y);
    });
  });

  $(room.state).players.onRemove((_player: any, sessionId: string) => {
    jugadores.delete(sessionId);
    escena.quitarEntidad(sessionId);
  });

  const teclas = new Set<string>();
  window.addEventListener("keydown", (e) => teclas.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => teclas.delete(e.key.toLowerCase()));

  let ultimaDireccionEnviada: Direction = { x: 0, y: 0 };
  let tAnterior = performance.now();

  function bucle(tAhora: number) {
    const dt = Math.min((tAhora - tAnterior) / 1000, 0.1); // techo: una pestaña en segundo plano no da un salto gigante al volver
    tAnterior = tAhora;

    const x =
      (teclas.has("d") || teclas.has("arrowright") ? 1 : 0) - (teclas.has("a") || teclas.has("arrowleft") ? 1 : 0);
    const y = (teclas.has("s") || teclas.has("arrowdown") ? 1 : 0) - (teclas.has("w") || teclas.has("arrowup") ? 1 : 0);

    if (x !== ultimaDireccionEnviada.x || y !== ultimaDireccionEnviada.y) {
      ultimaDireccionEnviada = { x, y };
      room.send("input", ultimaDireccionEnviada);
    }

    // Interpolación + animación: cada rig persigue su destino de servidor;
    // si se está moviendo de verdad, anima la zancada y encara la dirección.
    const factor = 1 - Math.exp(-12 * dt);
    for (const estado of jugadores.values()) {
      const dx = estado.destinoX - estado.x;
      const dz = estado.destinoZ - estado.z;
      const distancia = Math.hypot(dx, dz);
      const andando = distancia > 0.02;
      if (andando) estado.rig.orientar(dx, dz);
      estado.x += dx * factor;
      estado.z += dz * factor;
      estado.rig.objeto.position.set(estado.x, 0, estado.z);
      estado.rig.actualizar(dt, andando);
    }

    escena.actualizar(dt);
    escena.render();
    requestAnimationFrame(bucle);
  }
  requestAnimationFrame(bucle);
}
