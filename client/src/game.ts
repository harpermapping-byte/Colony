import { Client, getStateCallbacks } from "colyseus.js";
import { SERVER_URL } from "./config";
import { WorldScene } from "./render3d/worldScene";
import { crearRigHumanoide, type RigHumanoide } from "./render3d/rigHumanoide";
import { cargarIndice, cargarSector } from "./mapa/cargarMapa";
import type { Group } from "three";
import { StreamingSectores } from "./mapa/streamingSectores";
import { crearSectorVisual, soltarSectorVisual } from "./render3d/sectorVisual";
import { crearPersonajeVoxel, type PersonajeExportado } from "./render3d/personajeVoxel";
import { crearAnimalVoxel, type AnimalExportado } from "./render3d/animalVoxel";
import type { IndiceMapa } from "./mapa/formatoMapa";
import { cargarParcelas, construirIndiceParcelas } from "./construccion/parcelasCliente";
import { RenderConstrucciones, type ConstruccionRed } from "./construccion/renderConstrucciones";
import { ModoConstruccion } from "./construccion/constructor";

// Colores de referencia de siempre (antes tint de Phaser) — túnica del rig
// placeholder mientras no exista un catálogo de personajes con su propio
// `colorDebug` por facción/clase (pendiente, ver docs/GDD_Motor_3D_Props.md).
const COLOR_JUGADOR_LOCAL = "#f6ad55";
const COLOR_JUGADOR_REMOTO = "#4fd1c5";

// Mapa bakeado que carga el cliente (assets/mapas/<nombre>/) — el MAPA
// PRINCIPAL del juego, servido por sectores vía streaming (mecánica
// principal pactada, ver GDD_Motor_3D_Props): nunca se carga entero.
// Sobrescribible por entorno (VITE_RUTA_MAPA) para que los tests que
// dependen de la geometría del demo (mecanicas.e2e.mjs) puedan pedirlo;
// el juego real siempre va al principal.
const RUTA_MAPA = (import.meta as any).env?.VITE_RUTA_MAPA || "/assets/mapas/principal";

interface Direction {
  x: number;
  y: number;
}

// Hundimiento visual del rig según el medio que dicta el servidor: nadando
// va medio cuerpo dentro del agua; buceando baja además ~0.4 por nivel.
const HUNDIMIENTO_NADANDO = 0.55;
const HUNDIMIENTO_POR_NIVEL = 0.4;

interface EstadoJugador {
  rig: RigHumanoide;
  // posición REAL en unidades de mundo (casillas) que dicta el servidor
  destinoX: number;
  destinoZ: number;
  destinoY: number; // altura visual (0 en tierra, negativa nadando/buceando)
  // posición dibujada este frame (persigue al destino, para que los patches
  // de red a 15/seg no se vean como teletransportes)
  x: number;
  z: number;
  y: number;
  nadando: boolean;
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

  // --- Mundo bakeado por STREAMING de sectores: solo se materializa el
  // anillo alrededor del jugador local; el resto se pide al acercarse y se
  // suelta (con histéresis) al alejarse. La lógica vive en
  // streamingSectores.ts; aquí solo se le enchufan fetch y escena.
  let streaming: StreamingSectores<Group> | null = null;
  let indiceMapa: IndiceMapa | null = null; // lo reusa el constructor (ancho del mapa en casillas)
  try {
    const indice = await cargarIndice(RUTA_MAPA);
    indiceMapa = indice;
    streaming = new StreamingSectores({
      indice,
      obtenerSector: (sx, sy) => cargarSector(RUTA_MAPA, sx, sy),
      materializar: async (sector) => {
        const grupo = await crearSectorVisual(indice, sector);
        escena.añadirEstatico(grupo);
        return grupo;
      },
      soltar: (grupo) => {
        escena.quitarEstatico(grupo);
        soltarSectorVisual(grupo);
      },
    });
    // Sonda de depuración/pruebas e2e: estado del streaming en vivo.
    (window as any).__streaming = () => streaming!.estadisticas();
  } catch (err) {
    // Sin mapa no se corta el juego (los jugadores siguen sincronizando
    // sobre el suelo de emergencia), pero el fallo queda visible.
    console.error("No se pudo cargar el mapa bakeado:", err);
  }

  // --- Demo de personajes/animales del generador (assets/personajes/
  // demo_personajes.json, escrito por personajes/src/exportar_demo.js):
  // valida el circuito entero catálogo → generador → JSON → rig animado.
  // Cuando el servidor pueble NPCs de verdad, consumirán este mismo
  // formato y esta plaza fija desaparece. Si el JSON no está, no pasa nada.
  const animables: { actualizar(dt: number, andando?: boolean): void }[] = [];
  try {
    const r = await fetch("/assets/personajes/demo_personajes.json");
    if (r.ok) {
      const demo = await r.json();
      const indiceMapa = await cargarIndice(RUTA_MAPA).catch(() => null);
      const base = indiceMapa?.ciudad || { x: 24, y: 24 };
      (demo.npcs as PersonajeExportado[]).forEach((npc, i) => {
        const rig = crearPersonajeVoxel(npc);
        rig.orientar(1, 1); // encarados hacia la cámara isométrica
        escena.añadirEntidad(`demo_npc_${i}`, rig.objeto, base.x + 3 + i * 1.6, base.y + 3, npc.ficha.npcId);
        animables.push(rig);
      });
      (demo.animales as AnimalExportado[]).forEach((animal, i) => {
        const criatura = crearAnimalVoxel(animal);
        criatura.orientar(1, 1);
        escena.añadirEntidad(`demo_animal_${i}`, criatura.objeto, base.x + 2 + i * 1.9, base.y + 5.5, animal.ficha.especieId);
        animables.push(criatura);
      });
      (window as any).__demoPersonajes = { npcs: demo.npcs.length, animales: demo.animales.length };
    }
  } catch (err) {
    console.error("Demo de personajes no disponible:", err);
  }

  // Parcelas del mapa (dato estático de la herramienta admin) ANTES del
  // join: así el constructor nace completo y los onMessage se registran nada
  // más entrar, sin ventana en la que se pierdan mensajes del servidor.
  const parcelasArchivo = await cargarParcelas(RUTA_MAPA);

  // Nombre del jugador local: ?nombre=... en la URL si viene (tests e2e y
  // futuro login), si no el Viewer-aleatorio de siempre. Math.random vale:
  // no es generación determinista, solo un apodo de sesión.
  const nombreJugador =
    new URLSearchParams(location.search).get("nombre") || `Viewer-${Math.floor(Math.random() * 1000)}`;

  const client = new Client(SERVER_URL);
  const room = await client.joinOrCreate("hub", { name: nombreJugador });
  const $ = getStateCallbacks(room);

  // --- Constructor y render de construcciones (GDD_Construccion §4 y §6) ---
  // El ancho del mapa en casillas es la base de las claves numéricas
  // casilla→parcela/ocupación; sin índice de mapa no hay parcelas útiles.
  const anchoMapa = indiceMapa ? indiceMapa.anchoChunks * indiceMapa.tamanoChunk : 0;
  const indiceParcelas =
    parcelasArchivo && anchoMapa > 0 ? construirIndiceParcelas(parcelasArchivo, anchoMapa) : new Map<number, string>();
  const renderConstrucciones = new RenderConstrucciones(escena, anchoMapa || 1 << 16);
  const modoConstruccion = new ModoConstruccion({
    contenedor,
    escena,
    nombreJugador,
    anchoMapa: anchoMapa || 1 << 16,
    parcelas: parcelasArchivo,
    indiceParcelas,
    render: renderConstrucciones,
    enviarConstruir: (mensaje) => room.send("construir", mensaje),
  });
  // Los onMessage se registran SIEMPRE (aunque el servidor desplegado aún no
  // emita estos mensajes): un mensaje sin handler registrado es un error de
  // consola en colyseus.js — tolerar la ausencia es gratis, la presencia no.
  room.onMessage("parcelas:estado", (estado: Record<string, { dueno: string | null }>) =>
    modoConstruccion.actualizarDuenos(estado),
  );
  room.onMessage("construcciones:lista", (lista: ConstruccionRed[]) => renderConstrucciones.aplicarLista(lista || []));
  room.onMessage("construccion:nueva", (c: ConstruccionRed) => renderConstrucciones.aplicarNueva(c));
  room.onMessage("construccion:quitada", (m: { id: number }) => renderConstrucciones.aplicarQuitada(m.id));
  // Contador de rechazos para la sonda: el e2e distingue "el servidor aceptó"
  // (sube construcciones) de "el servidor rechazó" (sube este contador) sin
  // rascar el DOM del panel.
  let erroresConstruir = { n: 0, motivo: "" };
  room.onMessage("construir:error", (m: { motivo: string }) => {
    erroresConstruir = { n: erroresConstruir.n + 1, motivo: m?.motivo || "" };
    modoConstruccion.mostrarError(m?.motivo || "");
  });

  // Sonda SOLO-PARA-TESTS (e2e con Playwright): manejar el modo construcción
  // sin simular ratón sobre el canvas. No usar desde código de juego.
  (window as any).__construccion = {
    activo: () => modoConstruccion.activo(),
    activar: () => modoConstruccion.activar(),
    seleccionar: (id: string) => modoConstruccion.seleccionar(id),
    rotar: () => modoConstruccion.rotar(),
    colocarEn: (x: number, y: number) => modoConstruccion.colocarEn(x, y),
    construcciones: () => renderConstrucciones.cantidad(),
    parcelas: () => modoConstruccion.estadoParcelas(),
    // el cliente no expone la room: la sonda cubre el único send que el e2e
    // necesita fuera del colocador (asignación de parcela por el jarl, §4)
    asignarParcela: (parcelaId: string, nombreJugador: string) =>
      room.send("parcela:asignar", { parcelaId, nombreJugador }),
    errores: () => erroresConstruir,
  };

  const jugadores = new Map<string, EstadoJugador>();
  let jugadorLocal: EstadoJugador | null = null;

  $(room.state).players.onAdd((player: any, sessionId: string) => {
    const esYo = sessionId === room.sessionId;
    const rig = crearRigHumanoide({ colorTunica: esYo ? COLOR_JUGADOR_LOCAL : COLOR_JUGADOR_REMOTO });
    // yaw primero y luego la inclinación de nado, en el eje que mira el PJ
    rig.objeto.rotation.order = "YXZ";
    const estado: EstadoJugador = {
      rig,
      destinoX: player.x,
      destinoZ: player.y,
      destinoY: 0,
      x: player.x,
      z: player.y,
      y: 0,
      nadando: false,
    };
    jugadores.set(sessionId, estado);
    escena.añadirEntidad(sessionId, rig.objeto, player.x, player.y, player.name);
    if (esYo) {
      jugadorLocal = estado;
      escena.seguirPunto(player.x, player.y, true);
      // Primer anillo de sectores YA, sin esperar al primer frame.
      streaming?.actualizar(estado.x, estado.z);
    }

    $(player).onChange(() => {
      estado.destinoX = player.x;
      estado.destinoZ = player.y;
      estado.nadando = player.estado !== "tierra";
      estado.destinoY = estado.nadando ? -HUNDIMIENTO_NADANDO + player.nivel * HUNDIMIENTO_POR_NIVEL : 0;
      if (esYo) {
        escena.seguirPunto(player.x, player.y);
        // gancho para los tests E2E (Playwright lee la verdad del servidor)
        (window as any).__colonyDebug = { x: player.x, y: player.y, estado: player.estado, nivel: player.nivel };
      }
    });
  });

  $(room.state).players.onRemove((_player: any, sessionId: string) => {
    jugadores.delete(sessionId);
    escena.quitarEntidad(sessionId);
  });

  const teclas = new Set<string>();
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    // bucear/subir: pulsación, no mantenida (el servidor valida el medio)
    if (k === "q" && !teclas.has("q")) room.send("nivel", -1);
    if (k === "e" && !teclas.has("e")) room.send("nivel", 1);
    // modo construcción: B entra/sale (ESC y R los gestiona el propio modo)
    if (k === "b" && !teclas.has("b")) modoConstruccion.alternar();
    teclas.add(k);
  });
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
      // La MARCHA se deduce del hueco hasta el destino de servidor (los
      // patches llegan a 15/seg: andar deja ~0.25 casillas de hueco).
      // Cuando el servidor haga correr a alguien (sprint, huida, montura),
      // la animación de carrera embebida se dispara SOLA — sin cablear nada.
      const andando = distancia > 0.02;
      const marcha = !andando ? 0 : distancia > 0.34 ? 2 : 1;
      if (andando) estado.rig.orientar(dx, dz);
      estado.x += dx * factor;
      estado.z += dz * factor;
      estado.y += (estado.destinoY - estado.y) * factor;
      estado.rig.objeto.position.set(estado.x, estado.y, estado.z);
      // nadando el cuerpo se tumba hacia delante; en tierra vuelve a vertical
      const inclinacionObjetivo = estado.nadando ? -1.1 : 0;
      estado.rig.objeto.rotation.x += (inclinacionObjetivo - estado.rig.objeto.rotation.x) * factor;
      estado.rig.actualizar(dt, marcha);
    }

    // Streaming de sectores: seguir al jugador local (barato — solo
    // reevalúa el anillo tras moverse un umbral de casillas).
    if (jugadorLocal) streaming?.actualizar(jugadorLocal.x, jugadorLocal.z);

    // Demo de personajes/animales: animación idle (respirar, colas, alas)
    for (const animable of animables) animable.actualizar(dt);

    escena.actualizar(dt);
    escena.render();
    requestAnimationFrame(bucle);
  }
  requestAnimationFrame(bucle);
}
