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
import { crearInteriorVisual, type InteriorBakeado } from "./render3d/interiorVisual";
import { PointLight } from "three";
import { tiempoMundo } from "./mundo/tiempoMundo";

// Colores de referencia de siempre (antes tint de Phaser) — túnica del rig
// placeholder mientras no exista un catálogo de personajes con su propio
// `colorDebug` por facción/clase (pendiente, ver docs/GDD_Motor_3D_Props.md).
const COLOR_JUGADOR_LOCAL = "#f6ad55";
const COLOR_JUGADOR_REMOTO = "#4fd1c5";

// Sistema de puertas (docs/GDD_Sistema_Puertas.md): qué sala Colyseus tocar
// y qué mapa cargar viene de la URL — un cambio de sala/instancia es una
// RECARGA de página con otros parámetros (más simple y robusto que
// reconstruir la escena de Three.js en caliente; el pulido de transición
// sin recarga queda como mejora futura). Sin `sala` en la URL = Hub, el
// comportamiento de siempre.
const parametros = new URLSearchParams(location.search);
// "mazmorra" (docs/GDD_Bakeador_Dungeons.md): MISMA sala Colyseus que un
// interior normal (misma carga/escaleras/salida), solo que además trae
// enemigos activos — se distingue aquí para unirse a la room correcta.
type TipoSala = "hub" | "region" | "interior" | "mazmorra";
const SALA: TipoSala = (parametros.get("sala") as TipoSala) || "hub";
const MAPA_ID = parametros.get("mapaId") || "";
const EDIFICIO_ID = parametros.get("edificio") || "";
// Planta del interior (0 = planta baja); subir/bajar por una escalera
// cambia esto y recarga, como cualquier otro portal.
const NIVEL = parametros.has("nivel") ? Number(parametros.get("nivel")) : 0;
const ENTRADA_X = parametros.has("entradaX") ? Number(parametros.get("entradaX")) : undefined;
const ENTRADA_Y = parametros.has("entradaY") ? Number(parametros.get("entradaY")) : undefined;
// A qué volver al salir de un interior: la región de la que colgaba (con
// la puerta exacta por la que se entró) o directamente el hub.
const ORIGEN_SALA: TipoSala = (parametros.get("origenSala") as TipoSala) || "hub";
const PUERTA_X = parametros.has("puertaX") ? Number(parametros.get("puertaX")) : undefined;
const PUERTA_Y = parametros.has("puertaY") ? Number(parametros.get("puertaY")) : undefined;
// "interior" y "mazmorra" comparten TODA la lógica de carga/streaming/escaleras
// de abajo (docs/GDD_Bakeador_Dungeons.md) — solo cambia a qué room de
// Colyseus se conecta y que además pinta enemigos.
const ES_INTERIOR = SALA === "interior" || SALA === "mazmorra";

function navegarA(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  location.search = q.toString();
}

// Mapa bakeado que carga el cliente (assets/mapas/<nombre>/) — el MAPA
// PRINCIPAL del juego si estamos en el Hub, servido por sectores vía
// streaming (mecánica principal pactada, ver GDD_Motor_3D_Props): nunca se
// carga entero. Sobrescribible por entorno (VITE_RUTA_MAPA) para que los
// tests que dependen de la geometría del demo (mecanicas.e2e.mjs) puedan
// pedirlo. Una REGIÓN usa el MISMO formato de sectores, solo cambia la ruta.
const RUTA_MAPA =
  SALA === "region"
    ? `/assets/mapas/${MAPA_ID}`
    : (import.meta as any).env?.VITE_RUTA_MAPA || "/assets/mapas/principal";

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
  // streamingSectores.ts; aquí solo se le enchufan fetch y escena. Un
  // INTERIOR (docs/GDD_Sistema_Puertas.md) no es terreno bakeado por
  // sectores: se salta este bloque entero y se renderiza más abajo.
  let streaming: StreamingSectores<Group> | null = null;
  let indiceMapa: IndiceMapa | null = null; // lo reusa el constructor (ancho del mapa en casillas)
  if (!ES_INTERIOR) {
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
  }

  // --- Demo de personajes/animales del generador (assets/personajes/
  // demo_personajes.json, escrito por personajes/src/exportar_demo.js):
  // valida el circuito entero catálogo → generador → JSON → rig animado.
  // Cuando el servidor pueble NPCs de verdad, consumirán este mismo
  // formato y esta plaza fija desaparece. Si el JSON no está, no pasa nada.
  // --- NPCs REALES del asentamiento (GDD_Agentes_Moviles.md): si el mapa
  // trae poblacion.json bakeado, sus vóxeles por slotId — la posición viva
  // la manda el servidor por el estado (state.npcs) y se consume más abajo.
  // "Vida en interiores" (v1.2): un edificio del MISMO asentamiento comparte
  // el mismo poblacion.json (por eso se pide con MAPA_ID, no RUTA_MAPA —
  // esta última en un interior apunta al bake de la PLANTA, no al pueblo).
  const voxPorSlot = new Map<string, PersonajeExportado>();
  try {
    const rutaPoblacion = ES_INTERIOR ? `/assets/mapas/${MAPA_ID}/poblacion.json` : `${RUTA_MAPA}/poblacion.json`;
    const r = await fetch(rutaPoblacion);
    if (r.ok) {
      const poblacion = await r.json();
      for (const npc of poblacion.npcs as { slotId: string; vox: PersonajeExportado }[]) {
        voxPorSlot.set(npc.slotId, npc.vox);
      }
    }
  } catch {
    /* mapa sin población: sin NPCs, sin error */
  }

  // --- Pool de aspecto de ENEMIGOS de mazmorra (docs/GDD_Bakeador_Dungeons.md
  // §4.1): assets/enemigos/pool.json trae varias variantes YA generadas
  // (vóxeles resueltos) por cada enemigoId — el servidor solo manda qué
  // enemigoId+variante le tocó a cada uno, nunca la geometría en directo.
  // Fetch SOLO en mazmorra: son ~15MB, no tiene sentido pedirlo si no hace falta.
  let poolEnemigos: Record<string, ({ tipoRig: "npc" } & PersonajeExportado | { tipoRig: "animal" } & AnimalExportado)[]> = {};
  if (SALA === "mazmorra") {
    try {
      const r = await fetch("/assets/enemigos/pool.json");
      if (r.ok) poolEnemigos = (await r.json()).pool;
    } catch (err) {
      console.error("Pool de enemigos no disponible:", err);
    }
  }

  // Solo en el Hub/regiones (un interior no tiene "plaza" donde ponerlos), y
  // solo si el mapa NO tiene población real (la demo era el circuito de
  // prueba de personajes; con NPCs de verdad estorba).
  const animables: { actualizar(dt: number, andando?: boolean): void }[] = [];
  if (!ES_INTERIOR && voxPorSlot.size === 0) {
    try {
      const r = await fetch("/assets/personajes/demo_personajes.json");
      if (r.ok) {
        const demo = await r.json();
        const indiceMapaDemo = await cargarIndice(RUTA_MAPA).catch(() => null);
        const base = indiceMapaDemo?.ciudad || { x: 24, y: 24 };
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
  }

  // Interior de edificio (docs/GDD_Sistema_Puertas.md): geometría
  // placeholder (cajas de color) del bake de interiores/, sin streaming ni
  // construcción — es una instancia pequeña y de un solo uso.
  if (ES_INTERIOR) {
    try {
      const r = await fetch(`/assets/mapas/${MAPA_ID}/interiores/${EDIFICIO_ID}.json`);
      if (r.ok) {
        const interior = (await r.json()) as InteriorBakeado;
        escena.añadirEstatico(crearInteriorVisual(interior, NIVEL));
      } else {
        console.error(`No se pudo cargar el interior "${EDIFICIO_ID}" de "${MAPA_ID}"`);
      }
    } catch (err) {
      console.error("Interior no disponible:", err);
    }
  }

  // Parcelas del mapa (dato estático de la herramienta admin) ANTES del
  // join: así el constructor nace completo y los onMessage se registran nada
  // más entrar, sin ventana en la que se pierdan mensajes del servidor.
  // Solo el Hub tiene parcelas/construcción (GDD_Construccion) — una
  // región/interior de ciudades/ no es terreno de jugadores todavía.
  const parcelasArchivo = SALA === "hub" ? await cargarParcelas(RUTA_MAPA) : null;

  // Nombre del jugador local: ?nombre=... en la URL si viene (tests e2e y
  // futuro login), si no el Viewer-aleatorio de siempre. Math.random vale:
  // no es generación determinista, solo un apodo de sesión.
  const nombreJugador =
    new URLSearchParams(location.search).get("nombre") || `Viewer-${Math.floor(Math.random() * 1000)}`;

  const client = new Client(SERVER_URL);
  // Sistema de puertas: qué sala Colyseus y con qué opciones (docs/
  // GDD_Sistema_Puertas.md) — region/interior usan filterBy(mapaId[,edificio])
  // en el servidor, así que dos jugadores en el MISMO sitio comparten room.
  const room =
    SALA === "region"
      ? await client.joinOrCreate("region", { name: nombreJugador, mapaId: MAPA_ID, entradaX: ENTRADA_X, entradaY: ENTRADA_Y })
      : ES_INTERIOR
        ? await client.joinOrCreate(SALA === "mazmorra" ? "mazmorra" : "interior", {
            name: nombreJugador,
            mapaId: MAPA_ID,
            edificio: EDIFICIO_ID,
            nivel: NIVEL,
            entradaX: ENTRADA_X,
            entradaY: ENTRADA_Y,
          })
        : await client.joinOrCreate("hub", { name: nombreJugador });
  const $ = getStateCallbacks(room);

  // Puertas: tecla de interacción (F) — pisar cerca de una y pulsar F pide
  // al servidor cruzarla; la respuesta decide la siguiente URL (recarga).
  room.onMessage(
    "portal:ir",
    (info: { tipo: TipoSala; mapaId?: string; edificio?: string; nivel?: number; esMazmorra?: boolean; x?: number; y?: number }) => {
    if (info.tipo === "interior") {
      // Una escalera manda dentro del MISMO edificio en el que ya estamos
      // (solo cambia `nivel`) — se conserva a qué región/puerta volver al
      // salir del edificio entero; aparecer en la planta destino cae justo
      // sobre la casilla del conector (info.x/y), no en el spawn genérico.
      // esMazmorra decide "interior" vs "mazmorra" (docs/GDD_Bakeador_Dungeons.md)
      // — MISMA URL/lógica de abajo salvo esa sala Colyseus.
      const esCambioDePlanta = ES_INTERIOR && info.edificio === EDIFICIO_ID;
      navegarA({
        nombre: nombreJugador,
        sala: info.esMazmorra ? "mazmorra" : "interior",
        mapaId: info.mapaId,
        edificio: info.edificio,
        nivel: info.nivel ?? 0,
        origenSala: esCambioDePlanta ? ORIGEN_SALA : SALA,
        entradaX: esCambioDePlanta ? info.x : undefined,
        entradaY: esCambioDePlanta ? info.y : undefined,
        puertaX: esCambioDePlanta ? PUERTA_X : info.x,
        puertaY: esCambioDePlanta ? PUERTA_Y : info.y,
      });
    } else if (info.tipo === "region") {
      navegarA({ nombre: nombreJugador, sala: "region", mapaId: info.mapaId });
    } else if (info.tipo === "hub") {
      navegarA({ nombre: nombreJugador });
    } else {
      // "volver": desde un interior a su región (a la puerta exacta) o al
      // hub si se entró directo desde ahí; desde una región, siempre al hub.
      if (ES_INTERIOR && ORIGEN_SALA === "region") {
        navegarA({ nombre: nombreJugador, sala: "region", mapaId: MAPA_ID, entradaX: PUERTA_X, entradaY: PUERTA_Y });
      } else {
        navegarA({ nombre: nombreJugador });
      }
    }
    },
  );
  room.onMessage("portal:error", (m: { motivo: string }) => console.log("[puerta]", m?.motivo));

  // --- Constructor y render de construcciones (GDD_Construccion §4 y §6) ---
  // Solo en el Hub: una región/interior de ciudades/ no es propiedad de
  // ningún jugador todavía (docs/GDD_Sistema_Puertas.md "Qué falta").
  const anchoMapa = indiceMapa ? indiceMapa.anchoChunks * indiceMapa.tamanoChunk : 0;
  let modoConstruccion: ModoConstruccion | null = null;
  if (SALA === "hub") {
    const indiceParcelas =
      parcelasArchivo && anchoMapa > 0 ? construirIndiceParcelas(parcelasArchivo, anchoMapa) : new Map<number, string>();
    const renderConstrucciones = new RenderConstrucciones(escena, anchoMapa || 1 << 16);
    modoConstruccion = new ModoConstruccion({
      contenedor,
      escena,
      nombreJugador,
      anchoMapa: anchoMapa || 1 << 16,
      parcelas: parcelasArchivo,
      indiceParcelas,
      render: renderConstrucciones,
      enviarConstruir: (mensaje) => room.send("construir", mensaje),
    });
    const modo = modoConstruccion;
    // Los onMessage se registran SIEMPRE (aunque el servidor desplegado aún no
    // emita estos mensajes): un mensaje sin handler registrado es un error de
    // consola en colyseus.js — tolerar la ausencia es gratis, la presencia no.
    room.onMessage("parcelas:estado", (estado: Record<string, { dueno: string | null }>) =>
      modo.actualizarDuenos(estado),
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
      modo.mostrarError(m?.motivo || "");
    });

    // Sonda SOLO-PARA-TESTS (e2e con Playwright): manejar el modo construcción
    // sin simular ratón sobre el canvas. No usar desde código de juego.
    (window as any).__construccion = {
      activo: () => modo.activo(),
      activar: () => modo.activar(),
      seleccionar: (id: string) => modo.seleccionar(id),
      rotar: () => modo.rotar(),
      colocarEn: (x: number, y: number) => modo.colocarEn(x, y),
      construcciones: () => renderConstrucciones.cantidad(),
      parcelas: () => modo.estadoParcelas(),
      // el cliente no expone la room: la sonda cubre el único send que el e2e
      // necesita fuera del colocador (asignación de parcela por el jarl, §4)
      asignarParcela: (parcelaId: string, nombreJugador: string) =>
        room.send("parcela:asignar", { parcelaId, nombreJugador }),
      errores: () => erroresConstruir,
    };
  }

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

  // --- NPCs del servidor (GDD_Agentes_Moviles.md): mismo circuito que los
  // jugadores (rig + interpolación de patches a 15/seg); los vóxeles reales
  // salen de poblacion.json por slotId, con rig plano de repuesto si el
  // bake y el estado no cuadraran (mapa re-bakeado sin re-poblar).
  const npcsVisual = new Map<string, EstadoJugador>();
  // metadatos por NPC que no son interpolación: pregón para la burbuja y
  // antorcha de los turnos de vigilancia (se enciende sola de noche)
  const npcsMeta = new Map<string, { nombre: string; grito: string; accion: string; antorcha: PointLight | null }>();
  $(room.state).npcs.onAdd((npc: any, slotId: string) => {
    const vox = voxPorSlot.get(slotId);
    const rig = vox ? crearPersonajeVoxel(vox) : crearRigHumanoide({ colorTunica: "#7a6248" });
    rig.objeto.rotation.order = "YXZ";
    rig.objeto.visible = npc.visible;
    const estado: EstadoJugador = {
      rig,
      destinoX: npc.x,
      destinoZ: npc.y,
      destinoY: 0,
      x: npc.x,
      z: npc.y,
      y: 0,
      nadando: false,
    };
    npcsVisual.set(slotId, estado);
    const meta = { nombre: npc.nombre, grito: npc.grito || "", accion: npc.accion, antorcha: null as PointLight | null };
    npcsMeta.set(slotId, meta);
    escena.añadirEntidad(`npc_${slotId}`, rig.objeto, npc.x, npc.y, npc.nombre);
    $(npc).onChange(() => {
      estado.destinoX = npc.x;
      estado.destinoZ = npc.y;
      rig.objeto.visible = npc.visible;
      meta.accion = npc.accion;
    });
  });
  $(room.state).npcs.onRemove((_npc: any, slotId: string) => {
    npcsVisual.delete(slotId);
    npcsMeta.delete(slotId);
    escena.quitarEntidad(`npc_${slotId}`);
  });
  // sonda para los tests E2E: cuántos NPCs llegaron del servidor y dónde están
  (window as any).__npcs = () => ({
    total: npcsVisual.size,
    visibles: [...npcsVisual.values()].filter((n) => n.rig.objeto.visible).length,
    muestra: [...npcsVisual.values()].slice(0, 3).map((n) => ({ x: +n.destinoX.toFixed(1), y: +n.destinoZ.toFixed(1) })),
  });

  // --- Enemigos de mazmorra (docs/GDD_Bakeador_Dungeons.md §4): sin
  // movimiento/combate todavía (el streamer lo explicará aparte) — aparecen
  // QUIETOS en su punto, con animación de reposo (mismo circuito que la
  // demo de personajes/animales: se cuelgan de `animables` en vez de la
  // interpolación de jugadores/NPCs, que aquí no hace falta).
  const enemigosVisual = new Map<string, { actualizar(dt: number): void }>();
  $(room.state).enemigos.onAdd((enemigo: any, id: string) => {
    const variantes = poolEnemigos[enemigo.enemigoId];
    const variante = variantes?.[enemigo.variante];
    if (!variante) {
      console.error(`Enemigo "${enemigo.enemigoId}" variante ${enemigo.variante}: sin aspecto en el pool`);
      return;
    }
    const figura = variante.tipoRig === "animal" ? crearAnimalVoxel(variante) : crearPersonajeVoxel(variante);
    figura.objeto.rotation.order = "YXZ";
    figura.orientar(1, 1);
    const etiqueta = enemigo.esBoss ? `☠ ${enemigo.enemigoId}` : enemigo.enemigoId;
    escena.añadirEntidad(`enemigo_${id}`, figura.objeto, enemigo.x, enemigo.y, etiqueta);
    enemigosVisual.set(id, figura);
    animables.push(figura);
  });
  $(room.state).enemigos.onRemove((_enemigo: any, id: string) => {
    enemigosVisual.delete(id);
    escena.quitarEntidad(`enemigo_${id}`);
  });
  (window as any).__enemigos = () => ({
    total: enemigosVisual.size,
    bosses: [...room.state.enemigos.values()].filter((e: any) => e.esBoss).length,
  });

  const teclas = new Set<string>();
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    // bucear/subir: pulsación, no mantenida (el servidor valida el medio)
    if (k === "q" && !teclas.has("q")) room.send("nivel", -1);
    if (k === "e" && !teclas.has("e")) room.send("nivel", 1);
    // modo construcción: B entra/sale (ESC y R los gestiona el propio modo)
    if (k === "b" && !teclas.has("b")) modoConstruccion?.alternar();
    // puertas (docs/GDD_Sistema_Puertas.md): F cerca de una la cruza
    if (k === "f" && !teclas.has("f")) room.send("portal:usar");
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
    // Jugadores y NPCs comparten interpolación y animación de marcha: un
    // NPC es "otro que se mueve por patches del servidor", nada más.
    for (const estado of [...jugadores.values(), ...npcsVisual.values()]) {
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

    // NPCs: antorcha de los turnos de vigilancia (se enciende de noche,
    // con un parpadeo de llama) y burbuja de pregón de los especiales
    // (~4 s de grito cada ~13, desfasado por NPC para que no coreen).
    const deNoche = !tiempoMundo().esDeDia;
    const tSeg = tAhora / 1000;
    for (const [slotId, meta] of npcsMeta) {
      const estadoNpc = npcsVisual.get(slotId);
      if (!estadoNpc) continue;
      const vigila = meta.accion === "vigilar" || meta.accion === "patrullar";
      if (vigila && deNoche && !meta.antorcha) {
        meta.antorcha = new PointLight(0xffa24d, 0, 7, 1.6);
        meta.antorcha.position.set(0.45, 1.6, 0.2);
        estadoNpc.rig.objeto.add(meta.antorcha);
      }
      if (meta.antorcha) {
        meta.antorcha.intensity = vigila && deNoche ? 1.5 + Math.sin(tSeg * 9 + slotId.length) * 0.25 : 0;
      }
      if (meta.grito) {
        const fase = (tSeg + slotId.length * 1.7) % 13;
        escena.textoEtiqueta(`npc_${slotId}`, fase < 4 ? meta.grito : meta.nombre, fase < 4);
      }
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
