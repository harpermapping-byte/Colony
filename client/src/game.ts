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
import { crearInteriorVisual, type InteriorBakeado, type LuzInterior, INTENSIDAD_LUZ as INTENSIDAD_LUZ_INTERIOR } from "./render3d/interiorVisual";
import { PointLight, Color, Mesh, ConeGeometry, MeshBasicMaterial } from "three";
import { tiempoMundo } from "./mundo/tiempoMundo";
import { PanelCombate } from "./combate/panelCombate";
import { PanelMascotas, type MascotaVista, type ProgresoDomesticar } from "./mascotas/panelMascotas";

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
// "arena" (docs/GDD_Combate.md §9.2): room instanciada de un combate — se
// entra vía portal:ir tipo:"combate" (nunca por elección directa del
// jugador, como cualquier otro portal).
type TipoSala = "hub" | "region" | "interior" | "mazmorra" | "arena";
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
// Solo con sala=arena (docs/GDD_Combate.md §9.2) — id del combate al que unirse.
const COMBATE_ID = parametros.get("combateId") || "";
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
    : SALA === "arena"
    ? `/assets/mapas/arenas/${MAPA_ID}` // aquí MAPA_ID es el id de la arena bakeada (§9.4), no un asentamiento
    : (import.meta as any).env?.VITE_RUTA_MAPA || "/assets/mapas/principal";

interface Direction {
  x: number;
  y: number;
  /** Sprint (docs/GDD_Personaje.md §3.4) — Shift mientras se mueve, sin efecto sin estamina. */
  correr?: boolean;
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
  // Farolas/focos exteriores (ciudades/src/index.js, capa "luces" de
  // indice.json) — hasta ahora el cliente nunca las leía (pendiente del
  // GDD_Bakeador_POIs: "ciclo día/noche, consumir luces"). Pocas por
  // asentamiento (unas pocas decenas como mucho en una gran_capital), así
  // que se cargan TODAS de una vez al entrar en vez de por streaming de
  // sector — mismo criterio que fauna.json/poblacion.json.
  const farolasExterior: LuzInterior[] = [];
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

      for (const farola of indice.luces ?? []) {
        const luz = new PointLight(new Color(farola.color).getHex(), 0, farola.radio, 2);
        luz.position.set(farola.x, 3.2, farola.y);
        escena.añadirEstatico(luz);
        farolasExterior.push({ luz, fase: (farola.x * 31 + farola.y * 17) % 1000 / 1000 });
      }
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

  // Fauna doméstica urbana (v1.3) — solo exterior (state.fauna no existe
  // en un interior, y no hace falta): mismo criterio que poblacion.json,
  // vox por id en fauna.json.
  const voxFaunaPorId = new Map<string, AnimalExportado>();
  if (!ES_INTERIOR) {
    try {
      const r = await fetch(`${RUTA_MAPA}/fauna.json`);
      if (r.ok) {
        const datos = await r.json();
        for (const a of datos.fauna as { id: string; vox: AnimalExportado }[]) voxFaunaPorId.set(a.id, a.vox);
      }
    } catch {
      /* mapa sin fauna: sin animales, sin error */
    }
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
  const lucesInterior: LuzInterior[] = [];
  let actualizarConoVision: ((x: number, z: number) => void) | null = null;
  let actualizarLuzAmbiente: ((hora: number) => void) | null = null;
  if (ES_INTERIOR) {
    try {
      const r = await fetch(`/assets/mapas/${MAPA_ID}/interiores/${EDIFICIO_ID}.json`);
      if (r.ok) {
        const interior = (await r.json()) as InteriorBakeado;
        const { grupo, luces, actualizarVisibilidad, actualizarLuzAmbiente: fnActualizarLuzAmbiente } = crearInteriorVisual(interior, NIVEL);
        escena.añadirEstatico(grupo);
        lucesInterior.push(...luces);
        actualizarConoVision = actualizarVisibilidad;
        actualizarLuzAmbiente = fnActualizarLuzAmbiente;
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

  // Login con Twitch (docs/GDD_Twitch.md §7, pedido 2026-08-30): el token
  // llega en la URL solo la primera vez (redirect de vuelta de /auth/twitch/
  // callback) — se guarda en sessionStorage porque `navegarA` (más abajo)
  // recarga la página entera con OTROS query params al cruzar un portal, y
  // el login debe sobrevivir a eso mientras dure la pestaña. El nombre del
  // PJ (`nombreJugador`, arriba) sigue siendo libre e independiente — el
  // login de Twitch NUNCA lo sustituye, solo identifica al jugador de cara
  // al chat/títulos (docs/GDD_Twitch.md §0).
  const twitchSessionDeUrl = new URLSearchParams(location.search).get("twitchSession");
  if (twitchSessionDeUrl) sessionStorage.setItem("twitchSession", twitchSessionDeUrl);
  const twitchSession = twitchSessionDeUrl || sessionStorage.getItem("twitchSession") || undefined;

  const client = new Client(SERVER_URL);
  // Sistema de puertas: qué sala Colyseus y con qué opciones (docs/
  // GDD_Sistema_Puertas.md) — region/interior usan filterBy(mapaId[,edificio])
  // en el servidor, así que dos jugadores en el MISMO sitio comparten room.
  const room =
    SALA === "region"
      ? await client.joinOrCreate("region", { name: nombreJugador, mapaId: MAPA_ID, entradaX: ENTRADA_X, entradaY: ENTRADA_Y, twitchSession })
      : SALA === "arena"
        ? await client.joinOrCreate("arena", { name: nombreJugador, combateId: COMBATE_ID, twitchSession })
        : ES_INTERIOR
          ? await client.joinOrCreate(SALA === "mazmorra" ? "mazmorra" : "interior", {
              name: nombreJugador,
              mapaId: MAPA_ID,
              edificio: EDIFICIO_ID,
              nivel: NIVEL,
              entradaX: ENTRADA_X,
              entradaY: ENTRADA_Y,
              twitchSession,
            })
          : await client.joinOrCreate("hub", { name: nombreJugador, twitchSession });
  const $ = getStateCallbacks(room);

  // Puertas: tecla de interacción (F) — pisar cerca de una y pulsar F pide
  // al servidor cruzarla; la respuesta decide la siguiente URL (recarga).
  // Lo que hay que mandarle al servidor en combate:iniciar/unirse (docs/
  // GDD_Combate.md §9.2) para poder volver EXACTAMENTE de donde salió al
  // terminar el combate — opaco para el servidor, se lo queda tal cual y lo
  // reenvía en el portal:ir de vuelta ("volverDeCombate" más abajo).
  function retornoDeCombate() {
    return {
      nombre: nombreJugador, sala: SALA, mapaId: MAPA_ID, edificio: EDIFICIO_ID, nivel: NIVEL,
      origenSala: ORIGEN_SALA, puertaX: PUERTA_X, puertaY: PUERTA_Y,
    };
  }

  room.onMessage(
    "portal:ir",
    (info: { tipo: TipoSala | "combate" | "volverDeCombate"; mapaId?: string; mapaArenaId?: string; combateId?: string; edificio?: string; nivel?: number; esMazmorra?: boolean; x?: number; y?: number; [clave: string]: unknown }) => {
    if (info.tipo === "combate") {
      // Se va a pelear a una arena instanciada (§9.2) — reload directo, sin
      // más lógica: qué mapa cargar/room usar lo dice el propio mensaje.
      navegarA({ nombre: nombreJugador, sala: "arena", mapaId: info.mapaArenaId, combateId: info.combateId });
    } else if (info.tipo === "volverDeCombate") {
      // El servidor reenvía TAL CUAL lo que se mandó en retornoDeCombate() —
      // el cliente no interpreta nada, solo navega a donde le dicen.
      const { tipo: _tipo, ...resto } = info;
      navegarA(resto as Record<string, string | number | undefined>);
    } else if (info.tipo === "interior") {
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
    escena.actualizarVida(sessionId, player.vida, player.vidaMax);
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
      escena.actualizarVida(sessionId, player.vida, player.vidaMax);
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
    escena.actualizarVida(`npc_${slotId}`, npc.vida, npc.vidaMax);
    $(npc).onChange(() => {
      estado.destinoX = npc.x;
      estado.destinoZ = npc.y;
      rig.objeto.visible = npc.visible;
      meta.accion = npc.accion;
      escena.actualizarVida(`npc_${slotId}`, npc.vida, npc.vidaMax);
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

  // --- Fauna doméstica (GDD_Agentes_Moviles.md v1.3): mismo circuito que
  // los NPCs (rig + interpolación + marcha automática al moverse), vóxel
  // real de fauna.json por id.
  const faunaVisual = new Map<string, EstadoJugador>();
  $(room.state).fauna.onAdd((animal: any, id: string) => {
    const vox = voxFaunaPorId.get(id);
    const criatura = vox ? crearAnimalVoxel(vox) : crearAnimalVoxel({ ficha: { especieId: animal.especieId, esqueleto: "cuadrupedo", escala: 1 }, piezas: [] });
    criatura.orientar(1, 1);
    const estado: EstadoJugador = {
      rig: criatura,
      destinoX: animal.x, destinoZ: animal.y, destinoY: 0,
      x: animal.x, z: animal.y, y: 0,
      nadando: false,
    };
    faunaVisual.set(id, estado);
    escena.añadirEntidad(`fauna_${id}`, criatura.objeto, animal.x, animal.y);
    escena.actualizarVida(`fauna_${id}`, animal.vida, animal.vidaMax);
    $(animal).onChange(() => {
      estado.destinoX = animal.x;
      estado.destinoZ = animal.y;
      escena.actualizarVida(`fauna_${id}`, animal.vida, animal.vidaMax);
    });
  });
  $(room.state).fauna.onRemove((_animal: any, id: string) => {
    faunaVisual.delete(id);
    escena.quitarEntidad(`fauna_${id}`);
  });

  // Mascotas (docs/GDD_Mascotas.md) — mismo circuito visual que fauna
  // doméstica (sin vox propio por id: nace de un spawn de fauna.json que ya
  // no existe, así que siempre usa el fallback genérico por especie).
  const mascotasVisual = new Map<string, EstadoJugador>();
  $(room.state).mascotas.onAdd((mascota: any, id: string) => {
    const criatura = crearAnimalVoxel({ ficha: { especieId: mascota.especieId, esqueleto: "cuadrupedo", escala: 1 }, piezas: [] });
    criatura.orientar(1, 1);
    const estado: EstadoJugador = {
      rig: criatura,
      destinoX: mascota.x, destinoZ: mascota.y, destinoY: 0,
      x: mascota.x, z: mascota.y, y: 0,
      nadando: false,
    };
    mascotasVisual.set(id, estado);
    escena.añadirEntidad(`mascota_${id}`, criatura.objeto, mascota.x, mascota.y, `🐾 ${mascota.especieId} de ${mascota.duenoNombre}`);
    $(mascota).onChange(() => {
      estado.destinoX = mascota.x;
      estado.destinoZ = mascota.y;
    });
  });
  $(room.state).mascotas.onRemove((_mascota: any, id: string) => {
    mascotasVisual.delete(id);
    escena.quitarEntidad(`mascota_${id}`);
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
    escena.actualizarVida(`enemigo_${id}`, enemigo.vida, enemigo.vidaMax);
    enemigosVisual.set(id, figura);
    animables.push(figura);
    $(enemigo).onChange(() => escena.actualizarVida(`enemigo_${id}`, enemigo.vida, enemigo.vidaMax));
  });
  $(room.state).enemigos.onRemove((_enemigo: any, id: string) => {
    enemigosVisual.delete(id);
    escena.quitarEntidad(`enemigo_${id}`);
  });
  (window as any).__enemigos = () => ({
    total: enemigosVisual.size,
    bosses: [...room.state.enemigos.values()].filter((e: any) => e.esBoss).length,
  });

  // --- Combate táctico (docs/GDD_Combate.md, ✅ confirmado 2026-08-30) ---
  // Panel PLACEHOLDER de testeo (sin arena/grid dibujado, ver panelCombate.ts).
  // Tecla C: ataca al objetivo hostil más cercano dentro de RADIO_COMBATE —
  // mismo criterio de "sin UI de targeting" que ya usa "coger"/"portal:usar".
  const RADIO_COMBATE_CLIENTE = 2.2; // debe coincidir con RADIO_INTERACCION del servidor (server/src/rooms/base/RoomExteriorBase.ts)
  const panelCombate = new PanelCombate({
    contenedor,
    sessionIdPropio: room.sessionId,
    enviarAccion: (combateId, objetivoId) => room.send("combate:accion", { combateId, objetivoId }),
    enviarPasarTurno: (combateId) => room.send("combate:pasarTurno", { combateId }),
    enviarHuir: (combateId) => room.send("combate:huir", { combateId }),
    enviarComenzarYa: (combateId) => room.send("combate:comenzarYa", { combateId }),
  });
  const actualizarPanelCombate = () => panelCombate.actualizar(room.state.combates as any);
  $(room.state).combates.onAdd(() => actualizarPanelCombate());
  $(room.state).combates.onRemove(() => actualizarPanelCombate());
  room.onStateChange(() => actualizarPanelCombate());

  // --- Mascotas (docs/GDD_Mascotas.md) — panel PLACEHOLDER de testeo (ver panelMascotas.ts). Tecla G: dar de comer al animal domesticable más cercano. ---
  const panelMascotas = new PanelMascotas({
    contenedor,
    llamar: (mascotaId) => room.send("mascota:llamar", { mascotaId }),
    dejarEnPropiedad: (mascotaId, propiedadId) => room.send("mascota:dejarEnPropiedad", { mascotaId, propiedadId }),
  });
  room.onMessage("mascota:lista", (lista: MascotaVista[]) => panelMascotas.actualizarListado(lista));
  room.onMessage("mascota:progreso", (m: ProgresoDomesticar) => panelMascotas.actualizarProgreso(m));
  room.onMessage("mascota:domesticada", () => { panelMascotas.actualizarProgreso(null); room.send("mascota:listar"); });
  room.onMessage("mascota:actualizada", () => room.send("mascota:listar"));
  room.onMessage("mascota:error", (m: { motivo: string }) => console.log("[mascota]", m?.motivo));
  room.send("mascota:listar");

  // --- Login con Twitch (docs/GDD_Twitch.md §7) — PLACEHOLDER de testeo,
  // mismo criterio que el resto de paneles de esta pasada: un enlace suelto
  // si no has iniciado sesión, un texto si ya lo hiciste. Sin esto, el chat
  // solo te reconoce cuando tu PJ se llama igual que tu usuario de Twitch
  // (identidad v1, ver GDD_Construccion.md) — el login soluciona ESO
  // concretamente, no sustituye el nombre del PJ en el resto del juego.
  const cajaTwitch = document.createElement("div");
  cajaTwitch.style.position = "absolute";
  cajaTwitch.style.left = "16px";
  cajaTwitch.style.top = "16px";
  cajaTwitch.style.background = "rgba(20,16,10,0.88)";
  cajaTwitch.style.color = "#f0e8d8";
  cajaTwitch.style.font = "13px sans-serif";
  cajaTwitch.style.padding = "6px 10px";
  cajaTwitch.style.borderRadius = "6px";
  cajaTwitch.style.border = "1px solid #6a5a3a";
  if (twitchSession) {
    cajaTwitch.textContent = "🎮 Twitch: conectando...";
  } else {
    const urlLogin = `${SERVER_URL.replace(/^ws/, "http")}/auth/twitch/login`;
    cajaTwitch.innerHTML = `<a href="${urlLogin}" style="color:#a970ff">Conectar con Twitch</a> (para que el chat te reconozca)`;
  }
  contenedor.appendChild(cajaTwitch);
  room.onMessage("twitch:loginConfirmado", (m: { twitchLogin: string }) => {
    cajaTwitch.textContent = `🎮 Twitch: conectado como ${m.twitchLogin}`;
  });

  // Marcador de "combate en curso" en el mapa de origen mientras la pelea
  // vive instanciada en su propia arena (docs/GDD_Combate.md §9.2) — cono
  // rojo placeholder girando despacio, sin arte todavía (misma UI de
  // testeo que el resto de esta pasada).
  $(room.state).combatesEnCurso.onAdd((marcador: any, id: string) => {
    const cono = new Mesh(new ConeGeometry(0.35, 1, 6), new MeshBasicMaterial({ color: 0xd94040 }));
    cono.position.y = 1.4;
    escena.añadirEntidad(`combate_${id}`, cono, marcador.x, marcador.y, "⚔ combate en curso");
    animables.push({ actualizar: (dt: number) => { cono.rotation.y += dt; } });
  });
  $(room.state).combatesEnCurso.onRemove((_marcador: any, id: string) => escena.quitarEntidad(`combate_${id}`));

  function objetivoHostilMasCercano(): string | null {
    if (!jugadorLocal) return null;
    let mejorId: string | null = null;
    let mejorDist = RADIO_COMBATE_CLIENTE;
    for (const [id, f] of room.state.fauna.entries()) {
      const d = Math.hypot(f.x - jugadorLocal.x, f.y - jugadorLocal.z);
      if (d < mejorDist) { mejorDist = d; mejorId = id; }
    }
    for (const [id, e] of room.state.enemigos.entries()) {
      const d = Math.hypot(e.x - jugadorLocal.x, e.y - jugadorLocal.z);
      if (d < mejorDist) { mejorDist = d; mejorId = id; }
    }
    return mejorId;
  }

  /** Combate en ventana de unión (fase "pendiente", §9.1) más cercano al que el jugador todavía no pertenece. */
  function combatePendienteMasCercano(): string | null {
    if (!jugadorLocal) return null;
    let mejorId: string | null = null;
    let mejorDist = RADIO_COMBATE_CLIENTE;
    for (const [id, c] of room.state.combates.entries()) {
      if ((c as any).fase !== "pendiente" || (c as any).unidades.get(room.sessionId)) continue;
      const ox = (c as any).gx0 + (c as any).ancho / 2, oy = (c as any).gy0 + (c as any).alto / 2;
      const d = Math.hypot(ox - jugadorLocal.x, oy - jugadorLocal.z);
      if (d < mejorDist) { mejorDist = d; mejorId = id; }
    }
    return mejorId;
  }

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
    // combate (docs/GDD_Combate.md): C ataca al hostil más cercano — sin UI
    // de targeting, mismo criterio que "coger"/"portal:usar". `retorno`
    // (§9.2) es lo que hace falta para volver aquí exacto al terminar.
    if (k === "c" && !teclas.has("c")) {
      const objetivoId = objetivoHostilMasCercano();
      if (objetivoId) room.send("combate:iniciar", { objetivoId, retorno: retornoDeCombate() });
    }
    // V: unirse a un combate cercano que todavía esté en ventana de unión
    // (§9.1) — mismo criterio sin targeting que el resto de teclas de acción.
    if (k === "v" && !teclas.has("v")) {
      const combateId = combatePendienteMasCercano();
      if (combateId) room.send("combate:unirse", { combateId, retorno: retornoDeCombate() });
    }
    // Mascotas (docs/GDD_Mascotas.md): G da de comer al animal domesticable
    // más cercano (perro/gato urbano) — sin UI de targeting, el servidor
    // decide si hay algo cerca y si se puede (no-op fuera de una región con
    // fauna urbana). Cinco veces lo convierte en mascota.
    if (k === "g" && !teclas.has("g")) room.send("mascota:darComida");
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
    const correr = teclas.has("shift");

    if (
      x !== ultimaDireccionEnviada.x ||
      y !== ultimaDireccionEnviada.y ||
      correr !== !!ultimaDireccionEnviada.correr
    ) {
      ultimaDireccionEnviada = { x, y, correr };
      room.send("input", ultimaDireccionEnviada);
    }

    // Interpolación + animación: cada rig persigue su destino de servidor;
    // si se está moviendo de verdad, anima la zancada y encara la dirección.
    const factor = 1 - Math.exp(-12 * dt);
    // Jugadores y NPCs comparten interpolación y animación de marcha: un
    // NPC es "otro que se mueve por patches del servidor", nada más.
    for (const estado of [...jugadores.values(), ...npcsVisual.values(), ...faunaVisual.values(), ...mascotasVisual.values()]) {
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
    const { hora: horaMundo, esDeDia } = tiempoMundo();
    const deNoche = !esDeDia;
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

    // Luces de interior (antorchas/candelabros/lámparas — capa "iluminacion"
    // de interiores/catalogo/elementos.json): siempre encendidas, mismo
    // parpadeo de llama que la antorcha del guardia, cada una desfasada.
    for (const { luz, fase } of lucesInterior) {
      luz.intensity = INTENSIDAD_LUZ_INTERIOR + Math.sin(tSeg * 9 + fase * 13) * 0.25;
    }
    // Cono de visión (conoVision.ts): qué paredes este/sur ocultar según en
    // qué sala está el jugador — barato, solo recalcula al cambiar de sala.
    if (actualizarConoVision && jugadorLocal) actualizarConoVision(jugadorLocal.x, jugadorLocal.z);
    // Luz ambiente por hora del día (luzInteriores.ts): sube/baja con el
    // reloj de mundo, sala a sala según su propia ventana.
    if (actualizarLuzAmbiente) actualizarLuzAmbiente(horaMundo);
    // Farolas exteriores (ciudades/src/index.js, "luces"): solo de noche,
    // mismo parpadeo.
    for (const { luz, fase } of farolasExterior) {
      luz.intensity = deNoche ? 1.6 + Math.sin(tSeg * 9 + fase * 13) * 0.3 : 0;
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
