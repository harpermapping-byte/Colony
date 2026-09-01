import { Client, getStateCallbacks } from "colyseus.js";
import { SERVER_URL } from "./config";
import { WorldScene } from "./render3d/worldScene";
import { crearRigHumanoide, type RigHumanoide } from "./render3d/rigHumanoide";
import { cargarIndice, cargarSector } from "./mapa/cargarMapa";
import { StreamingSectores } from "./mapa/streamingSectores";
import { crearSectorVisual, soltarSectorVisual, type HandleSector } from "./render3d/sectorVisual";
import { crearPersonajeVoxel, type PersonajeExportado } from "./render3d/personajeVoxel";
import { crearAnimalVoxel, type AnimalExportado } from "./render3d/animalVoxel";
import type { IndiceMapa } from "./mapa/formatoMapa";
import { cargarParcelas, construirIndiceParcelas } from "./construccion/parcelasCliente";
import { RenderConstrucciones, type ConstruccionRed } from "./construccion/renderConstrucciones";
import { PanelMapaMundo } from "./mapa/panelMapaMundo";
import { ModoConstruccion } from "./construccion/constructor";
import { ColocadorPlantillas } from "./construccion/colocadorPlantillas";
import { obtenerConstruibleOPlantilla } from "./construccion/catalogoConstruccion";
import { MenuInteraccion, type OpcionMenuInteraccion } from "./ui/menuInteraccion";
import { ModalInstrumento } from "./ui/modalInstrumento";
import { PanelCofre } from "./construccion/panelCofre";
import { PanelSastreLegendario, type DisenoSastre } from "./construccion/panelSastreLegendario";
import { PanelCarpinteroLegendario, type DisenoCarpintero } from "./construccion/panelCarpinteroLegendario";
import { PanelIngenieroLegendario, type ProyectoIngeniero } from "./construccion/panelIngenieroLegendario";
import { reproducirMidi, detenerReproduccion, type TipoInstrumento } from "./audio/instrumentos";
import { crearInteriorVisual, type InteriorBakeado, type LuzInterior, INTENSIDAD_LUZ as INTENSIDAD_LUZ_INTERIOR } from "./render3d/interiorVisual";
import { PointLight, Color, Mesh, ConeGeometry, SphereGeometry, MeshBasicMaterial, Raycaster, Vector2 } from "three";
import { tiempoMundo } from "./mundo/tiempoMundo";
import { PanelCombate } from "./combate/panelCombate";
import { PanelForja } from "./construccion/panelForja";
import { PanelMascotas, type MascotaVista, type ProgresoDomesticar } from "./mascotas/panelMascotas";
import { PanelComercio, type EstadoComercioVista } from "./comercio/panelComercio";
import { PanelPesca, type EstadoPescaVista } from "./pesca/panelPesca";
import { PanelCultivo, type EstadoCultivoVista } from "./agricultura/panelCultivo";
import { PanelInjerto } from "./agricultura/panelInjerto";
import { PanelCocina, type IngredienteVista } from "./cocina/panelCocina";
import { aplicarEquipoAlRig, type BlueprintRopaResuelto } from "./render3d/equipoVisual";
import { PanelJugador } from "./personaje/panelJugador";
import { crearPlaceholder } from "./render3d/placeholder";
import { animalPlaceholder } from "./render3d/animalPlaceholder";
import { aplicarMonturaAlAnimal } from "./render3d/monturaVisual";
import { crearBarcoVisual } from "./render3d/barcoVisual";
import { aplicarAnatomiaCompleta } from "./render3d/anatomiaVisual";
import { PanelMedico, ZONAS, type Zona, type EstadoZonaVista, type EstadoEnfermedadesVista } from "./personaje/panelMedico";
import { PanelCompanero } from "./personaje/panelCompanero";
import { PanelResumen, type PropiedadVista } from "./personaje/panelResumen";
import { PanelLoginAdmin } from "./admin/panelLoginAdmin";
import { PanelJarl } from "./admin/panelJarl";
import { PanelDebugTestZone } from "./admin/panelDebugTestZone";
import { PanelContenedorTest } from "./mundo/panelContenedorTest";
import { PanelAjedrez } from "./minijuegos/panelAjedrez";
import { posicionSilla as posicionSillaMesaJuego, type Silla as SillaMesaJuego } from "./minijuegos/mesasJuego";

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
    : MAPA_ID
    // Hub de un mapa exterior DISTINTO al principal (barcos, Test Zone vía
    // ?mapaId=...): el join de más abajo ya elige la room "hub_mapa" para
    // esto — este ternario se le había olvidado a esa misma pasada (bug real
    // encontrado probando la Test Zone 2026-08-31), así que el cliente
    // seguía pintando siempre el mapa principal aunque conectara a la room
    // correcta, dejando el terreno vacío/desincronizado del estado real.
    ? `/assets/mapas/${MAPA_ID}`
    : (import.meta as any).env?.VITE_RUTA_MAPA || "/assets/mapas/principal";

// El grid táctico de una arena (server/src/rooms/ArenaCombateRoom.ts) sale
// 1:1 del bake real y queda pequeño (petición streamer: "el mapa generado
// se ve enano"). Este margen es SOLO visual (sectorVisual.ts,
// extenderConMargenClamp): terreno de relleno fuera del grid, sin tocar
// bake/colisión/lógica de combate — el jugador nunca sale del grid real.
const MARGEN_VISUAL_ARENA = 6;

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
// Sentarse/tumbarse (pedido 2026-08-31): mismo mecanismo de "bajar el rig"
// que nadando, para que la pose de piernas dobladas (rigHumanoide.ts) no
// deje al personaje flotando por encima del asiento/suelo.
const HUNDIMIENTO_SENTADO = 0.25;
const HUNDIMIENTO_SENTADO_SUELO = 0.4;

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
  // Enfermedades (docs/GDD_Enfermedades.md, pedido 2026-08-30): SOLO
  // jugadores reales (nunca NPCs/fauna/mascotas, que comparten esta misma
  // interfaz de interpolación) — nombre para poder revertir la etiqueta tras
  // la burbuja de tos/tiritona periódica.
  name?: string;
  catarro?: boolean;
  gripe?: boolean;
  // Instrumentos musicales (docs/GDD_Instrumentos.md, pedido 2026-08-31):
  // true mientras este jugador tiene un MIDI sonando — dispara la pose
  // genérica "tocando" del rig (rigHumanoide.ts) en vez de reservar una
  // Marcha nueva. Solo jugadores reales lo usan de verdad; NPCs/fauna/
  // mascotas/compañeros comparten esta misma interfaz y simplemente nunca
  // lo ponen a true.
  tocandoInstrumento?: boolean;
  // Sentarse/tumbarse (pedido 2026-08-31) — mismo criterio que
  // tocandoInstrumento: booleanos replicados que solo mueven la POSE del
  // rig, la lógica real vive en el servidor. Solo jugadores reales.
  sentado?: boolean;
  sentadoSuelo?: boolean;
  durmiendo?: boolean;
  // Compañero NPC (docs/GDD_Companeros.md) — SOLO compañeros: texto de queja
  // por hambre que ya manda listo el servidor (bucle(), burbuja periódica).
  // Espejo local del campo `quejaTexto` de CompaneroSchema — mirar el mapa
  // local en vez de `room.state.companeros` directamente evita la ventana
  // de carrera de justo después de unirse a la room (ver docs/GDD_Companeros.md §8).
  quejaTexto?: string;
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
  let streaming: StreamingSectores<HandleSector> | null = null;
  let indiceMapa: IndiceMapa | null = null; // lo reusa el constructor (ancho del mapa en casillas)

  // Exclusiones de sector (docs/GDD_Bosques.md §7, pedido 2026-08-30: "si se
  // puede recolectar/talar/matar y se hace, acaba desapareciendo" — también
  // visualmente, no solo en el inventario). Antes de materializar un sector
  // se pregunta al servidor qué posiciones bakeadas de ESE sector ya no
  // existen (recogidas/taladas) para no dibujarlas — request/response
  // correlado por sector, con timeout de seguridad (si el servidor no
  // responde, el sector carga igual sin exclusiones, igual que antes de
  // este arreglo, nunca se queda colgado). Definido aquí, antes de que
  // `room` exista más abajo: solo se INVOCA desde `materializar`, que
  // streaming.actualizar() no dispara hasta bastante después del connect
  // (cuando el jugador local ya está sincronizado) — para cuando corre,
  // `room` ya está asignado.
  const pendientesExclusiones = new Map<string, (posiciones: string[]) => void>();
  function pedirExclusiones(sectorX: number, sectorY: number, tilesPorSector: number): Promise<Set<string>> {
    return new Promise((resolve) => {
      const k = `${sectorX}_${sectorY}`;
      let resuelto = false;
      const terminar = (posiciones: string[]) => {
        if (resuelto) return;
        resuelto = true;
        pendientesExclusiones.delete(k);
        resolve(new Set(posiciones));
      };
      pendientesExclusiones.set(k, terminar);
      room.send("sector:exclusiones", {
        sectorX, sectorY,
        tileX0: sectorX * tilesPorSector, tileY0: sectorY * tilesPorSector,
        tileX1: (sectorX + 1) * tilesPorSector, tileY1: (sectorY + 1) * tilesPorSector,
      });
      setTimeout(() => terminar([]), 3000);
    });
  }

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
      const tilesPorSector = indice.tamanoSectorChunks * indice.tamanoChunk;
      streaming = new StreamingSectores({
        indice,
        obtenerSector: (sx, sy) => cargarSector(RUTA_MAPA, sx, sy),
        materializar: async (sector) => {
          const excluidos = await pedirExclusiones(sector.sectorX, sector.sectorY, tilesPorSector);
          const handle = await crearSectorVisual(indice, sector, excluidos, SALA === "arena" ? MARGEN_VISUAL_ARENA : 0);
          escena.añadirEstatico(handle.grupo);
          return handle;
        },
        soltar: (handle) => {
          escena.quitarEstatico(handle.grupo);
          soltarSectorVisual(handle);
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

  // Sesión de admin (docs/GDD_Admin.md, pedido 2026-08-30) — MISMO patrón
  // que la de Twitch justo arriba: llega en la URL una vez (redirect de
  // /auth/twitch/callback si la cuenta de Twitch está vinculada a un admin,
  // o el propio login por usuario/contraseña la guarda directo en
  // sessionStorage y recarga, ver panelLoginAdmin.ts), sobrevive a
  // `navegarA` (recarga de página) mientras dure la pestaña.
  const adminSessionDeUrl = new URLSearchParams(location.search).get("adminSession");
  if (adminSessionDeUrl) sessionStorage.setItem("adminSession", adminSessionDeUrl);
  const adminSession = adminSessionDeUrl || sessionStorage.getItem("adminSession") || undefined;

  const client = new Client(SERVER_URL);
  // Sistema de puertas: qué sala Colyseus y con qué opciones (docs/
  // GDD_Sistema_Puertas.md) — region/interior usan filterBy(mapaId[,edificio])
  // en el servidor, así que dos jugadores en el MISMO sitio comparten room.
  const room =
    SALA === "region"
      ? await client.joinOrCreate("region", { name: nombreJugador, mapaId: MAPA_ID, entradaX: ENTRADA_X, entradaY: ENTRADA_Y, twitchSession, adminSession })
      : SALA === "arena"
        ? await client.joinOrCreate("arena", { name: nombreJugador, combateId: COMBATE_ID, twitchSession, adminSession })
        : ES_INTERIOR
          ? await client.joinOrCreate(SALA === "mazmorra" ? "mazmorra" : "interior", {
              name: nombreJugador,
              mapaId: MAPA_ID,
              edificio: EDIFICIO_ID,
              nivel: NIVEL,
              entradaX: ENTRADA_X,
              entradaY: ENTRADA_Y,
              twitchSession,
              adminSession,
            })
          : MAPA_ID
            // Barcos y navegación marítima (docs/GDD_Barcos.md, pedido
            // 2026-08-30): cruzar un borde mar_abierto lleva a un Hub de OTRO
            // mapa exterior — mismo "hub" de siempre, pero server/src/index.ts
            // lo registra también como "hub_mapa" (filterBy mapaId) para no
            // tocar el join normal (sin mapaId) de toda la vida.
            ? await client.joinOrCreate("hub_mapa", { name: nombreJugador, mapaId: MAPA_ID, twitchSession, adminSession })
            : await client.joinOrCreate("hub", { name: nombreJugador, twitchSession, adminSession });
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
      // x/y opcionales (docs/GDD_Muerte_Respawn.md: respawn junto a tu cama,
      // no en el spawn genérico de la región) — sin ellos, spawn por defecto de siempre.
      navegarA({ nombre: nombreJugador, sala: "region", mapaId: info.mapaId, entradaX: info.x, entradaY: info.y });
    } else if (info.tipo === "hub") {
      // mapaId presente = venimos de cruzar un borde mar_abierto en barco
      // (docs/GDD_Barcos.md) — recarga apuntando al Hub de ESE mapa; sin él,
      // el hub de siempre.
      navegarA({ nombre: nombreJugador, mapaId: info.mapaId });
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
  // Rechazo de combate:iniciar/accion (lejos, pvp deshabilitado, ya en
  // combate...) — no había NINGÚN listener para esto (encontrado probando
  // la Test Zone 2026-08-31): el jugador pulsaba C y no pasaba nada, sin
  // ninguna pista de por qué. Solo consola por ahora (mismo criterio que
  // "[puerta]" arriba), no hay panel de combate con hueco para un texto.
  room.onMessage("combate:error", (m: { motivo: string }) => console.log("[combate]", m?.motivo));
  // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): solo informativo — F ya
  // cruza el borde si de verdad hay mapa vecino (mismo criterio "sin UI de
  // targeting/confirmación" que cualquier otra puerta), esto es únicamente
  // para depurar en consola mientras no haya un segundo mapa de producción.
  room.onMessage("mapa:vecino", (m: { direccion: string; nombre: string }) => console.log("[barco] mapa vecino a la vista:", m?.direccion, m?.nombre));
  room.onMessage("barco:error", (m: { motivo: string }) => console.log("[barco]", m?.motivo));

  // --- Constructor y render de construcciones (GDD_Construccion §4 y §6) ---
  // Solo en el Hub: una región/interior de ciudades/ no es propiedad de
  // ningún jugador todavía (docs/GDD_Sistema_Puertas.md "Qué falta").
  const anchoMapa = indiceMapa ? indiceMapa.anchoChunks * indiceMapa.tamanoChunk : 0;
  let modoConstruccion: ModoConstruccion | null = null;
  let colocadorPlantillas: ColocadorPlantillas | null = null;
  let panelMapaMundo: PanelMapaMundo | null = null;
  // Mesas de minijuego (docs/GDD_Mesas_Minijuego.md) — igual que
  // `modoConstruccion`, izadas fuera del `if (SALA === "hub")` de abajo
  // porque la tecla F (más adelante, fuera de este bloque) necesita leerlas.
  let renderConstrucciones: RenderConstrucciones | null = null;
  let panelAjedrez: PanelAjedrez | null = null;
  // Captura genérica de "último mensaje visto de este tipo" (barrido de
  // sistemas 2026-08-31), izada por el MISMO motivo que renderConstrucciones/
  // panelAjedrez arriba: los mensajes de médico (más abajo, fuera del
  // `if (SALA === "hub")`) también necesitan escribir aquí, y `__test`
  // (dentro del bloque hub) necesita LEER lo que ellos escriban.
  const ultimosMensajes = new Map<string, unknown>();
  if (SALA === "hub") {
    const indiceParcelas =
      parcelasArchivo && anchoMapa > 0 ? construirIndiceParcelas(parcelasArchivo, anchoMapa) : new Map<number, string>();
    renderConstrucciones = new RenderConstrucciones(escena, anchoMapa || 1 << 16);
    // Alias narrowed no-null para el resto de este bloque (mismo motivo que
    // "const modo = modoConstruccion" un poco más abajo: TypeScript no
    // conserva el narrowing de un `let` a través de un closure/callback).
    const render = renderConstrucciones;
    modoConstruccion = new ModoConstruccion({
      contenedor,
      escena,
      nombreJugador,
      anchoMapa: anchoMapa || 1 << 16,
      parcelas: parcelasArchivo,
      indiceParcelas,
      render,
      enviarConstruir: (mensaje) => room.send("construir", mensaje),
    });
    const modo = modoConstruccion;

    let ultimaPlantillaColocada: { construccionId: number; plantillaId: string } | null = null;
    // docs/GDD_Economia.md §9: mercaderes NPC por oficio — cacheados para la
    // sonda de test __construccion, mismo criterio que ultimaPlantillaColocada
    // (sin UI real todavía que los muestre).
    let ultimoEscaparateMercader: unknown = null;
    let ultimaCompraMercader: unknown = null;
    let ultimaVentaMercader: unknown = null;
    let ultimoErrorMercader: string | null = null;
    // --- Colocador de plantillas del jarl (docs/GDD_Produccion.md, pedido
    // 2026-08-31: "el admin o superadmin tendrá el mismo tipo de colocador
    // que el de las construcciones o amueblamiento de los jugadores") —
    // tecla Z, gateada a jarl/superadmin más abajo (identidadAdminActual).
    // `capital` espeja `MapaCargado.spawnX/Y` del servidor (indice.ciudad,
    // o el centro del mapa si no hay ciudad bakeada) — RADIO_* mismo valor
    // por defecto que `RADIO_PLANTILLAS_JARL_CASILLAS` del servidor, solo
    // feedback local, el servidor manda si se desincroniza vía env var.
    if (indiceMapa) {
      const RADIO_PLANTILLAS_JARL_CASILLAS_CLIENTE = 80;
      const capital = indiceMapa.ciudad ?? {
        x: Math.floor((indiceMapa.anchoChunks * indiceMapa.tamanoChunk) / 2),
        y: Math.floor((indiceMapa.altoChunks * indiceMapa.tamanoChunk) / 2),
      };
      colocadorPlantillas = new ColocadorPlantillas({
        contenedor,
        escena,
        anchoMapa: anchoMapa || 1 << 16,
        indiceParcelas,
        render: renderConstrucciones,
        capital,
        radioMax: RADIO_PLANTILLAS_JARL_CASILLAS_CLIENTE,
        enviarColocar: (mensaje) => room.send("plantilla:colocar", mensaje),
      });
      // "plantilla:error" también lo dispara plantilla:asignarTrabajador
      // (docs/GDD_Produccion.md §3bis), disponible para CUALQUIER jugador,
      // no solo el jarl — de ahí el console.log además de avisar al
      // colocador (que solo el jarl puede llegar a abrir).
      room.onMessage("plantilla:error", (m: { motivo: string }) => {
        colocadorPlantillas?.mostrarError(m?.motivo || "");
        console.log("[plantilla]", m?.motivo);
      });
      // Confirmación del servidor — "construccion:nueva" (arriba) ya pinta la
      // pieza; se guarda además para la sonda de test __construccion (no hay
      // UI de "comprar plantilla" todavía, ver comprarPlantilla más abajo).
      room.onMessage("plantilla:colocada", (m: { construccionId: number; plantillaId: string }) => {
        ultimaPlantillaColocada = m;
      });
    }

    // --- Mapa de mundo con niebla de guerra (docs/GDD_Mapa_Mundo.md,
    // pedido 2026-08-31): tecla M — "la M es mapa" (montura se movió a X).
    if (indiceMapa) {
      panelMapaMundo = new PanelMapaMundo({
        contenedor,
        rutaMapa: RUTA_MAPA,
        indice: indiceMapa,
        parcelasArchivo,
        nombreJugador,
        obtenerDuenos: () => modo.estadoParcelas(),
        posicionJugador: () => (jugadorLocal ? { x: jugadorLocal.x, z: jugadorLocal.z } : null),
        consultarExploracion: () => room.send("mapa:consultarExploracion"),
      });
      room.onMessage("mapa:exploracion", (m: { sectores: number[]; tilesPorSector: number }) => panelMapaMundo?.aplicarExploracion(m));
    }

    // Los onMessage se registran SIEMPRE (aunque el servidor desplegado aún no
    // emita estos mensajes): un mensaje sin handler registrado es un error de
    // consola en colyseus.js — tolerar la ausencia es gratis, la presencia no.
    room.onMessage("parcelas:estado", (estado: Record<string, { dueno: string | null }>) =>
      modo.actualizarDuenos(estado),
    );
    room.onMessage("construcciones:lista", (lista: ConstruccionRed[]) => render.aplicarLista(lista || []));
    room.onMessage("construccion:nueva", (c: ConstruccionRed) => render.aplicarNueva(c));
    room.onMessage("construccion:quitada", (m: { id: number }) => render.aplicarQuitada(m.id));
    // Contador de rechazos para la sonda: el e2e distingue "el servidor aceptó"
    // (sube construcciones) de "el servidor rechazó" (sube este contador) sin
    // rascar el DOM del panel.
    let erroresConstruir = { n: 0, motivo: "" };
    room.onMessage("construir:error", (m: { motivo: string }) => {
      erroresConstruir = { n: erroresConstruir.n + 1, motivo: m?.motivo || "" };
      modo.mostrarError(m?.motivo || "");
    });

    // Panel real de cofre/arcón (pedido 2026-08-31) — cofreObjetivo lo fija
    // el clic "Abrir X" del menú de interacción, más abajo.
    let cofreObjetivo: { id: number; nombre: string } | null = null;
    const panelCofre = new PanelCofre({
      contenedor,
      sacar: (construccionId, instanciaId) => room.send("cofre:sacarItem", { construccionId, instanciaId }),
    });

    // Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre legendario, pedido 2026-08-31).
    const panelSastre = new PanelSastreLegendario({
      contenedor,
      aceptar: (construccionId, texto, tintes, nombre) => room.send("sastre:tejerAceptar", { construccionId, texto, tintes, nombre }),
      craftearCopia: (construccionId, prendaGeneradaId) => room.send("sastre:tejerCopia", { construccionId, prendaGeneradaId }),
      pedirMisDisenos: () => room.send("sastre:misDisenos"),
    });
    room.onMessage("sastre:error", (m: { motivo: string }) => panelSastre.mostrarError(m?.motivo || "No se pudo tejer."));
    room.onMessage("sastre:tejerResultado", () => panelSastre.confirmarCreada());
    room.onMessage("sastre:tejerCopiaResultado", () => {});
    room.onMessage("sastre:misDisenos", (m: { disenos: DisenoSastre[] }) => panelSastre.actualizarMisDisenos(m?.disenos || []));
    // Sonda SOLO-PARA-TESTS (mismo criterio que window.__construccion/__ajedrez de arriba): abre el panel sin depender de acertar el raycast del clic 3D sobre el telar.
    (window as any).__sastre = { abrirPanel: (construccionId: number) => panelSastre.abrir(construccionId) };

    // Carpintero legendario (docs/GDD_Ropa_Procedural.md §Carpintero legendario) — MISMO patrón que el sastre.
    const panelCarpintero = new PanelCarpinteroLegendario({
      contenedor,
      aceptar: (construccionId, texto, nombre) => room.send("carpintero:tallarAceptar", { construccionId, texto, nombre }),
      tallarCopia: (construccionId, muebleGeneradoId) => room.send("carpintero:tallarCopia", { construccionId, muebleGeneradoId }),
      pedirMisDisenos: () => room.send("carpintero:misDisenos"),
    });
    room.onMessage("carpintero:error", (m: { motivo: string }) => panelCarpintero.mostrarError(m?.motivo || "No se pudo tallar."));
    room.onMessage("carpintero:tallarResultado", () => panelCarpintero.confirmarCreado());
    room.onMessage("carpintero:tallarCopiaResultado", () => {});
    room.onMessage("carpintero:misDisenos", (m: { disenos: DisenoCarpintero[] }) => panelCarpintero.actualizarMisDisenos(m?.disenos || []));
    (window as any).__carpintero = { abrirPanel: (construccionId: number) => panelCarpintero.abrir(construccionId) };

    // Ingeniero legendario (docs/GDD_Ropa_Procedural.md §Ingeniero legendario) — alcance reducido a propósito, ver GDD.
    const panelIngeniero = new PanelIngenieroLegendario({
      contenedor,
      aceptar: (construccionId, texto, nombre) => room.send("ingeniero:proyectarAceptar", { construccionId, texto, nombre }),
      pedirMisDisenos: () => room.send("ingeniero:misDisenos"),
    });
    room.onMessage("ingeniero:error", (m: { motivo: string }) => panelIngeniero.mostrarError(m?.motivo || "No se pudo proyectar."));
    room.onMessage("ingeniero:proyectarResultado", () => panelIngeniero.confirmarCreado());
    room.onMessage("ingeniero:misDisenos", (m: { disenos: ProyectoIngeniero[] }) => panelIngeniero.actualizarMisDisenos(m?.disenos || []));
    (window as any).__ingeniero = { abrirPanel: (construccionId: number) => panelIngeniero.abrir(construccionId) };

    // --- Instrumentos musicales (docs/GDD_Instrumentos.md, pedido
    // 2026-08-31): clic sobre un objeto construido → menú de interacción
    // GENÉRICO (menuInteraccion.ts) — pensado para colgar aquí futuras
    // interacciones sin bindear más teclas ("iremos añadiendo aquí para
    // evitar bindear de tanta tecla", pedido explícito). Hoy la única
    // interacción real es "Tocar" sobre los 4 instrumentos craftables;
    // cualquier otro objeto clicado simplemente no ofrece nada.
    const menuInteraccion = new MenuInteraccion();
    let instrumentoObjetivo: { id: number; nombre: string } | null = null;
    const modalInstrumento = new ModalInstrumento({
      tocar: (midiUrl) => {
        if (!instrumentoObjetivo) return;
        room.send("instrumento:tocar", { construccionId: instrumentoObjetivo.id, midiUrl });
      },
    });
    const raycasterClic = new Raycaster();
    escena.renderer.domElement.addEventListener("click", (e) => {
      if (modo.activo()) return; // el modo construcción ya consume sus propios clics (colocar/rotar)
      const r = escena.renderer.domElement.getBoundingClientRect();
      const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycasterClic.setFromCamera(ndc, escena.camera);
      const impactos = raycasterClic.intersectObjects(render.mallas(), false);
      if (impactos.length === 0) {
        // Clic sin ningún mueble debajo (pedido 2026-08-31: "también puedes
        // sentarte en el suelo... dando click sobre suelo") — sin raycast
        // real de terreno, se ofrece siempre que el clic no tocara ningún
        // mueble: sentar:suelo se sienta donde YA está el jugador, así que
        // no hace falta saber la casilla exacta del clic.
        menuInteraccion.mostrar(e.clientX, e.clientY, "Suelo", [
          { etiqueta: "Sentarse en el suelo", accion: () => room.send("sentar:suelo", {}) },
        ]);
        return;
      }
      const datos = render.datosDeMalla(impactos[0].object);
      if (!datos) return;
      const construible = obtenerConstruibleOPlantilla(datos.objeto);
      const nombre = construible?.nombre ?? datos.objeto;
      const opciones: OpcionMenuInteraccion[] = [];
      if (construible?.instrumento) {
        opciones.push({
          etiqueta: `Tocar ${nombre}`,
          accion: () => {
            instrumentoObjetivo = { id: datos.id, nombre };
            modalInstrumento.mostrar(nombre);
          },
        });
      }
      if (construible?.esSilla) {
        opciones.push({ etiqueta: `Sentarse en ${nombre}`, accion: () => room.send("sentar:iniciar", { construccionId: datos.id }) });
      }
      if (construible?.esCama) {
        opciones.push({ etiqueta: `Tumbarse en ${nombre}`, accion: () => room.send("dormir:iniciar", { construccionId: datos.id }) });
      }
      if (construible?.esContenedor) {
        opciones.push({
          etiqueta: `Abrir ${nombre}`,
          accion: () => {
            cofreObjetivo = { id: datos.id, nombre };
            room.send("cofre:consultar", { construccionId: datos.id });
          },
        });
      }
      if (datos.objeto === "telar") {
        opciones.push({ etiqueta: "Tejer prenda legendaria", accion: () => panelSastre.abrir(datos.id) });
      }
      if (datos.objeto === "banco_carpintero") {
        opciones.push({ etiqueta: "Tallar mueble legendario", accion: () => panelCarpintero.abrir(datos.id) });
      }
      if (datos.objeto === "mesa_planos_ingenieria") {
        opciones.push({ etiqueta: "Proyectar edificio legendario", accion: () => panelIngeniero.abrir(datos.id) });
      }
      // Trabajador de producción (docs/GDD_Produccion.md §3bis, pedido
      // 2026-08-31: "trabajador de producción como NPC real" + "podrás sacar
      // [al compañero] de su puesto... y reasignarlos también") — sin saber
      // el estado actual (el cliente no lo trae, ver ConstruccionRed), las 3
      // opciones se ofrecen siempre que la construcción NECESITE trabajador;
      // el servidor decide si aplica y responde con plantilla:error/
      // companero:error si no ("sin UI de targeting", mismo criterio que el
      // resto del proyecto).
      if (construible?.produccion?.requiereTrabajador) {
        opciones.push({ etiqueta: "Contratar trabajador (50₣)", accion: () => room.send("plantilla:asignarTrabajador", { construccionId: datos.id, activo: true }) });
        opciones.push({ etiqueta: "Despedir trabajador", accion: () => room.send("plantilla:asignarTrabajador", { construccionId: datos.id, activo: false }) });
        opciones.push({ etiqueta: "Poner a mi compañero a trabajar aquí", accion: () => room.send("companero:asignarTrabajo", { construccionId: datos.id }) });
      }
      menuInteraccion.mostrar(e.clientX, e.clientY, nombre, opciones);
    });

    // El servidor ya validó proximidad+catálogo antes de retransmitir — el
    // cliente solo descarga/sintetiza (audio/instrumentos.ts) y, si algo
    // falla en SU propio lado (URL rota, MIDI corrupto...), avisa al
    // servidor para que no se quede "tocando" sin sonido real.
    room.onMessage("instrumento:tocando", (m: { sessionId: string; tipo: TipoInstrumento; midiUrl: string }) => {
      const esMio = m?.sessionId === room.sessionId;
      reproducirMidi(m.sessionId, m.tipo, m.midiUrl, () => {
        if (esMio) room.send("instrumento:parar");
      }).catch((err) => {
        console.log("[instrumento] fallo al reproducir:", err?.message || err);
        if (esMio) {
          modalInstrumento.mostrarError("No se pudo reproducir ese MIDI (URL rota o formato inválido).");
          room.send("instrumento:parar");
        }
      });
    });
    room.onMessage("instrumento:parado", (m: { sessionId: string }) => detenerReproduccion(m?.sessionId));
    room.onMessage("instrumento:error", (m: { motivo: string }) => {
      console.log("[instrumento]", m?.motivo);
      modalInstrumento.mostrarError(m?.motivo || "No se pudo tocar.");
    });
    room.onMessage("cofre:error", (m: { motivo: string }) => console.log("[cofre]", m?.motivo));
    room.onMessage("cofre:estado", (m: { construccionId: number; ancho: number; alto: number; items: { id: number; itemId: string; cantidad: number }[] }) => {
      if (cofreObjetivo) panelCofre.abrir(cofreObjetivo.nombre);
      panelCofre.actualizarEstado(m.construccionId, m.items || []);
    });
    // Sentarse (pedido 2026-08-31) — sin panel propio (no hay nada que
    // mostrar salvo la pose, que ya se ve en el rig), solo consola por si
    // falla (mismo criterio que combate:error/puerta arriba).
    room.onMessage("sentar:error", (m: { motivo: string }) => console.log("[sentar]", m?.motivo));

    // Sonda SOLO-PARA-TESTS (e2e con Playwright): manejar el modo construcción
    // sin simular ratón sobre el canvas. No usar desde código de juego.
    (window as any).__construccion = {
      activo: () => modo.activo(),
      activar: () => modo.activar(),
      seleccionar: (id: string) => modo.seleccionar(id),
      rotar: () => modo.rotar(),
      colocarEn: (x: number, y: number) => modo.colocarEn(x, y),
      construcciones: () => render.cantidad(),
      parcelas: () => modo.estadoParcelas(),
      // el cliente no expone la room: la sonda cubre el único send que el e2e
      // necesita fuera del colocador (asignación de parcela por el jarl, §4)
      asignarParcela: (parcelaId: string, nombreJugador: string) =>
        room.send("parcela:asignar", { parcelaId, nombreJugador }),
      // docs/GDD_Produccion.md §3bis: comprar una plantilla del jarl (aserradero...)
      // tampoco tiene UI todavía — mismo criterio que asignarParcela arriba.
      comprarPlantilla: (construccionId: number) => room.send("plantilla:comprar", { construccionId }),
      ultimaPlantillaColocada: () => ultimaPlantillaColocada,
      // docs/GDD_Produccion.md §3ter: transporte y cofres tampoco tienen UI
      // todavía (transporte:*/cofre:* son protocolo puro) — mismo criterio.
      contratarTransporte: (origenConstruccionId: number, destino: { destinoTenderoteId?: string; destinoConstruccionId?: number }) =>
        room.send("transporte:contratar", { origenConstruccionId, ...destino }),
      consultarCofre: (construccionId: number) => room.send("cofre:consultar", { construccionId }),
      meterEnCofre: (construccionId: number, instanciaId: number) => room.send("cofre:meterItem", { construccionId, instanciaId }),
      sacarDeCofre: (construccionId: number, instanciaId: number) => room.send("cofre:sacarItem", { construccionId, instanciaId }),
      // docs/GDD_Economia.md §9: mercaderes NPC por oficio — protocolo npc:*
      // tampoco tiene UI todavía, mismo criterio que arriba.
      mercadoEscaparate: () => room.send("npc:comercioEscaparate"),
      mercadoComprar: (npcId: string, itemId: string, cantidad: number) => room.send("npc:comprar", { npcId, itemId, cantidad }),
      mercadoVender: (npcId: string, instanciaId: number, cantidad: number) => room.send("npc:vender", { npcId, instanciaId, cantidad }),
      ultimoEscaparateMercader: () => ultimoEscaparateMercader,
      ultimaCompraMercader: () => ultimaCompraMercader,
      ultimaVentaMercader: () => ultimaVentaMercader,
      ultimoErrorMercader: () => ultimoErrorMercader,
      errores: () => erroresConstruir,
      // ids de todas las construcciones vivas de un objeto de catálogo (p.ej.
      // "mesa_ajedrez") — usado por el e2e de mesas de minijuego para ubicar
      // lo recién colocado sin tener que adivinar el id que asignó el servidor.
      idsDeObjeto: (objeto: string) => render.idsDeObjeto(objeto),
    };
    room.onMessage("npc:error", (m: { motivo: string }) => { ultimoErrorMercader = m?.motivo ?? ""; console.log("[npc]", m?.motivo); });
    room.onMessage("npc:comercioEscaparate", (m: unknown) => { ultimoEscaparateMercader = m; console.log("[npc] escaparate", m); });
    room.onMessage("npc:compraResultado", (m: unknown) => { ultimaCompraMercader = m; console.log("[npc] compraResultado", m); });
    room.onMessage("npc:ventaResultado", (m: unknown) => { ultimaVentaMercader = m; console.log("[npc] ventaResultado", m); });

    // --- Agricultura (docs/GDD_Agricultura.md, pedido 2026-08-30) — panel
    // PLACEHOLDER de testeo (ver panelCultivo.ts). Sin tecla dedicada: el
    // panel aparece solo al acercarse a un bancal/maceta (mismo criterio
    // "sin UI de targeting" que el resto — auto-apuntado por proximidad,
    // RenderConstrucciones.plantableMasCercana) y sus botones ya mandan
    // los mensajes cultivo:*.
    const panelCultivo = new PanelCultivo({
      contenedor,
      plantar: (construccionId, instanciaId) => room.send("cultivo:plantar", { construccionId, instanciaId }),
      regar: (construccionId) => room.send("cultivo:regar", { construccionId }),
      abonar: (construccionId) => room.send("cultivo:abonar", { construccionId }),
      cosechar: (construccionId) => room.send("cultivo:cosechar", { construccionId }),
    });
    let cultivoCercanoId: number | null = null;
    room.onMessage("cultivo:estado", (m: EstadoCultivoVista) => {
      render.tintarSuelo(m.construccionId, m.agua, m.fertilizante);
      if (m.construccionId === cultivoCercanoId) panelCultivo.actualizar(m);
    });
    room.onMessage("cultivo:cosechado", (m: { itemId: string; cantidad: number }) => console.log(`[cultivo] cosechado: ${m?.cantidad}x ${m?.itemId}`));
    room.onMessage("cultivo:error", (m: { motivo: string }) => console.log("[cultivo]", m?.motivo));
    room.onMessage("objeto:abierto", (m: { itemId: string; cantidad: number }) => console.log(`[objeto] abierto: ${m?.cantidad}x ${m?.itemId}`));
    // RADIO_INTERACCION del servidor (2.2, mismo valor que el resto de
    // auto-apuntados del cliente) — chequeo cada 500ms, no cada frame: la
    // proximidad a un bancal no necesita 60hz.
    setInterval(() => {
      if (!jugadorLocal) return;
      const id = render.plantableMasCercana(jugadorLocal.x, jugadorLocal.z, 2.2);
      if (id !== cultivoCercanoId) {
        cultivoCercanoId = id;
        if (id == null) panelCultivo.actualizar(null);
        else room.send("cultivo:consultar", { construccionId: id });
      }
    }, 500);

    // --- Injertos (docs/GDD_Agricultura.md §4) — mismo criterio de panel
    // placeholder por proximidad, ahora apuntando a "mesa_injertos" en vez
    // de a cualquier plantable.
    const panelInjerto = new PanelInjerto({
      contenedor,
      crear: (construccionId, instanciaIdA, instanciaIdB) => room.send("injerto:crear", { construccionId, instanciaIdA, instanciaIdB }),
    });
    let injertoCercanoId: number | null = null;
    room.onMessage("injerto:creado", (m: { nombre: string }) => console.log(`[injerto] nueva especie: ${m?.nombre}`));
    setInterval(() => {
      if (!jugadorLocal) return;
      const id = render.deObjetoMasCercana("mesa_injertos", jugadorLocal.x, jugadorLocal.z, 2.2);
      if (id !== injertoCercanoId) {
        injertoCercanoId = id;
        panelInjerto.actualizar(id);
      }
    }, 500);

    // --- Cocina (docs/GDD_Cocina.md, pedido 2026-08-30) — panel PLACEHOLDER
    // de testeo (ver panelCocina.ts). Auto-apuntado por proximidad a
    // cualquier estación de cocina (hoguera o vasija); qué UI mostrar la
    // decide `RenderConstrucciones.cocinaMasCercana` (ya trae la metadata).
    const panelCocina = new PanelCocina({
      contenedor,
      cocinarSimple: (construccionId, instanciaId) => room.send("cocina:simple", { construccionId, instanciaId }),
      llenarAgua: (construccionId, instanciaId) => room.send("cocina:llenarAgua", { construccionId, instanciaId }),
      anadir: (construccionId, instanciaId, cantidad) => room.send("cocina:anadir", { construccionId, instanciaId, cantidad }),
      preparar: (construccionId) => room.send("cocina:preparar", { construccionId }),
    });
    let cocinaCercanaId: number | null = null;
    room.onMessage("cocina:estado", (m: { construccionId: number; ingredientes: IngredienteVista[]; conAgua: boolean; hirviendo: boolean; segundosParaHervir: number }) => {
      if (m.construccionId === cocinaCercanaId) {
        panelCocina.actualizarEstado({ ingredientes: m.ingredientes, conAgua: m.conAgua, hirviendo: m.hirviendo, segundosParaHervir: m.segundosParaHervir });
      }
    });
    room.onMessage("cocina:cocinado", (m: { itemId: string }) => console.log(`[cocina] cocinado: ${m?.itemId}`));
    room.onMessage("cocina:preparado", (m: { nombre: string; cantidad: number; mezclaBonus: boolean }) =>
      console.log(`[cocina] preparado: ${m?.cantidad}x ${m?.nombre}${m?.mezclaBonus ? " (bonus de mezcla)" : ""}`));
    room.onMessage("cocina:error", (m: { motivo: string }) => console.log("[cocina]", m?.motivo));
    setInterval(() => {
      if (!jugadorLocal) return;
      const cercana = render.cocinaMasCercana(jugadorLocal.x, jugadorLocal.z, 2.2);
      const id = cercana?.id ?? null;
      if (id !== cocinaCercanaId) {
        cocinaCercanaId = id;
        if (!cercana) panelCocina.actualizarCercania(null, false);
        else {
          panelCocina.actualizarCercania(id, cercana.cocina!.esVasija, cercana.cocina!.vasija, cercana.cocina!.capacidad, cercana.cocina!.hierveAgua);
          if (cercana.cocina!.esVasija) room.send("cocina:consultar", { construccionId: id });
        }
      }
    }, 500);

    // --- Mesas de minijuego: ajedrez (docs/GDD_Mesas_Minijuego.md, pedido
    // 2026-08-30) — panel PLACEHOLDER de testeo (ver panelAjedrez.ts).
    // Mueble craftable/colocable normal (misma "construir" de arriba); el
    // popup se abre solo cuando el ESTADO dice fase:"activo" (mismo criterio
    // que PanelCombate reaccionando a `combates`), reactivo a
    // `state.mesasAjedrez` con el mismo trío onAdd/onRemove/onStateChange
    // que combate/comercio.
    panelAjedrez = new PanelAjedrez({
      contenedor,
      sessionIdPropio: room.sessionId,
      enviarMover: (construccionId, desde, hasta, promocion) => room.send("mesa:mover", { construccionId, desde, hasta, promocion }),
      enviarLevantarse: () => room.send("mesa:levantarse"),
    });
    const elPanelAjedrez = panelAjedrez;
    const actualizarPanelAjedrez = () => elPanelAjedrez.actualizar((room.state as any).mesasAjedrez);
    $(room.state).mesasAjedrez.onAdd(() => actualizarPanelAjedrez());
    $(room.state).mesasAjedrez.onRemove(() => actualizarPanelAjedrez());
    room.onStateChange(() => actualizarPanelAjedrez());
    room.onMessage("mesa:error", (m: { motivo: string }) => console.log("[mesa]", m?.motivo));

    // Hint de "sentarse" (proximidad, sin UI de targeting): mismo cadencia
    // de 500ms que cultivo/injerto/cocina de arriba — busca la mesa de
    // ajedrez más cercana (radio ancho: la huella 3x2 hace que el CENTRO de
    // la mesa pueda estar algo más lejos que RADIO_INTERACCION aunque una
    // silla concreta sí esté al alcance) y, de sus 2 sillas, la más cercana
    // que esté libre y de verdad dentro de RADIO_INTERACCION real.
    setInterval(() => {
      if (!jugadorLocal) return;
      if (miMesaAjedrezActual() != null) return; // ya sentado: actualizarPanelAjedrez ya oculta el hint
      const asiento = asientoAjedrezAlcanzable(jugadorLocal.x, jugadorLocal.z);
      elPanelAjedrez.actualizarHint(asiento ? "Pulsa F para sentarte a jugar al ajedrez" : null);
    }, 500);

    // Asiento genérico (docs/GDD_Personaje.md §3.6bis, pedido 2026-08-31):
    // hint pequeño e independiente del de ajedrez de arriba — mismo criterio
    // de proximidad de 500ms, pero para cualquier silla/banco/taburete/
    // mecedora/sofa/trono (`esAsiento:true`). No compite con el hint de
    // ajedrez: solo se muestra si NO hay una mesa de ajedrez alcanzable
    // (evita 2 hints a la vez si un jugador está entre ambos).
    const hintAsiento = document.createElement("div");
    hintAsiento.style.cssText =
      "position:absolute;left:50%;bottom:60px;transform:translateX(-50%);background:rgba(20,16,10,0.85);color:#f0e8d8;font:13px sans-serif;padding:6px 12px;border-radius:6px;border:1px solid #6a5a3a;display:none;pointer-events:none;";
    hintAsiento.textContent = "Pulsa F para sentarte";
    contenedor.appendChild(hintAsiento);
    setInterval(() => {
      if (!jugadorLocal) { hintAsiento.style.display = "none"; return; }
      if (enAsientoGenerico() || miMesaAjedrezActual() != null || asientoAjedrezAlcanzable(jugadorLocal.x, jugadorLocal.z)) {
        hintAsiento.style.display = "none";
        return;
      }
      const idAsiento = asientoGenericoAlcanzable(jugadorLocal.x, jugadorLocal.z);
      hintAsiento.style.display = idAsiento != null ? "block" : "none";
    }, 500);
    room.onMessage("asiento:error", (m: { motivo: string }) => console.log("[asiento]", m?.motivo));
    room.onMessage("asiento:cancelado", () => console.log("[asiento] cancelado (te has movido)"));

    // Sonda SOLO-PARA-TESTS (e2e con Playwright): el crafteo (docs/
    // GDD_Crafteo.md) todavía no tiene panel de cliente (ninguna receta lo
    // usa desde el navegador hoy — el mecanismo es server-only por ahora),
    // así que esto manda el protocolo Colyseus REAL tal cual lo haría un
    // futuro panel, sin inventar un mensaje nuevo. mesa:sentarse/levantarse
    // SÍ tienen UI real (tecla F, ver más abajo) — la sonda las deja
    // disponibles igualmente por si un test quiere fijar la silla exacta.
    let ultimoCrafteoCompletado: { itemId: string; cantidad: number; enSuelo: boolean } | null = null;
    room.onMessage("crafteo:completado", (m: { itemId: string; cantidad: number; enSuelo: boolean }) => { ultimoCrafteoCompletado = m; });
    room.onMessage("crafteo:error", (m: { motivo: string }) => console.log("[crafteo]", m?.motivo));
    (window as any).__ajedrez = {
      elegirIngeniero: () => room.send("oficio:elegir", { oficio: "ingeniero" }),
      craftear: (construccionIdMesa: number) => room.send("crafteo:iniciar", { recetaId: "mesa_ajedrez_craft", construccionId: construccionIdMesa }),
      recolectarCrafteo: () => room.send("crafteo:recolectar"),
      ultimoCrafteoCompletado: () => ultimoCrafteoCompletado,
      sentarse: (construccionId: number, silla: SillaMesaJuego) => room.send("mesa:sentarse", { construccionId, silla }),
      levantarse: () => room.send("mesa:levantarse"),
      mover: (construccionId: number, desde: string, hasta: string) => room.send("mesa:mover", { construccionId, desde, hasta }),
      estado: (construccionId: number) => {
        const m = (room.state as any).mesasAjedrez?.get(String(construccionId));
        return m ? { sillaBlancas: m.sillaBlancas, sillaNegras: m.sillaNegras, fen: m.fen, fase: m.fase, turnoDe: m.turnoDe, ganador: m.ganador } : null;
      },
      // posición mundo (x,y) de una silla concreta — para que el e2e sepa
      // exactamente a dónde caminar (mismo cálculo que usa el propio juego).
      posicionSilla: (construccionId: number, silla: SillaMesaJuego) => {
        const datos = renderConstrucciones?.datosDe(construccionId);
        return datos ? posicionSillaMesaJuego("mesa_ajedrez", datos, silla) : null;
      },
      sessionId: () => room.sessionId,
    };

    // Sonda SOLO-PARA-TESTS (e2e con Playwright, barrido de sistemas
    // pedido 2026-08-31): comercio/combate ya tienen panel real más abajo
    // (mandan el MISMO mensaje que esto); gremios sigue sin panel de
    // cliente todavía (mismo caso que crafteo/ajedrez arriba, sin mecánica
    // de UI que lo use hoy). En vez de una sonda a medida por mensaje, esto
    // es un paso GENÉRICO al protocolo Colyseus real (mismo room.send que
    // usaría cualquier botón, nunca un atajo que salte validación del
    // servidor) más una lectura de estado sincronizado — evita duplicar
    // cableado de mensajes que YA manda un panel real solo para poder
    // dirigirlo desde un test.
    let ultimoEstadoGremio: unknown = null;
    let ultimaInvitacionGremio: unknown = null;
    room.onMessage("gremio:estado", (m: unknown) => { ultimoEstadoGremio = m; });
    room.onMessage("gremio:invitacionRecibida", (m: { gremioId: number; gremioNombre: string; invitadoPor: string }) => {
      ultimaInvitacionGremio = m;
      console.log("[gremio] invitación recibida", m);
    });
    room.onMessage("gremio:error", (m: { motivo: string }) => console.log("[gremio]", m?.motivo));

    // Captura genérica de "último mensaje visto de este tipo" (barrido de
    // sistemas 2026-08-31: tenderete/cocina/crafteo/oficio no tienen panel
    // de cliente todavía, igual que gremios arriba) — evita añadir una
    // variable+listener dedicados cada vez que un e2e nuevo necesita leer
    // la respuesta de un mensaje sin estado replicado propio. nanoevents
    // (motor de colyseus.js onMessage) acumula listeners, así que esto
    // convive sin pisar los console.log de "xxx:error" ya registrados.
    // (`ultimosMensajes` está izado arriba del `if`, no declarado aquí.)
    for (const tipo of [
      "tenderete:escaparate", "tenderete:gestion", "tenderete:compraResultado", "tenderete:error",
      "cocina:estado", "cocina:preparado", "cocina:error",
      "crafteo:iniciado", "crafteo:completado", "crafteo:error",
      // Minijuego de forja (docs/GDD_Crafteo.md §Minijuego de Herrería,
      // pedido 2026-09-01) — mismo criterio que el resto de esta lista: sin
      // panel de cliente todavía, protocolo real disponible vía
      // window.__test.enviar("crafteo:herreria:accion", {accion}) /
      // "crafteo:herreria:cancelar".
      "crafteo:herreria:iniciado", "crafteo:herreria:progreso", "crafteo:herreria:completado", "crafteo:herreria:cancelado",
      "oficio:elegido", "oficio:error",
    ]) {
      room.onMessage(tipo, (m: unknown) => ultimosMensajes.set(tipo, m));
    }
    (window as any).__test = {
      enviar: (tipo: string, msg?: unknown) => room.send(tipo, msg),
      sessionId: () => room.sessionId,
      ultimoMensaje: (tipo: string) => ultimosMensajes.get(tipo) ?? null,
      ultimoEstadoGremio: () => ultimoEstadoGremio,
      ultimaInvitacionGremio: () => ultimaInvitacionGremio,
      // vista pública+privada de un jugador (el propio, o cualquiera dentro
      // de esta room) — mismo subconjunto que ya replica Player Schema.
      jugador: (sessionId: string) => {
        const p = room.state.players.get(sessionId);
        if (!p) return null;
        const anatomia: Record<string, EstadoZonaVista> = {} as Record<string, EstadoZonaVista>;
        for (const z of ZONAS) {
          const zs = (p.anatomia as any)[z];
          anatomia[z] = { sangrado: zs.sangrado, fractura: zs.fractura, infectado: zs.infectado, amputado: zs.amputado, protesis: zs.protesis, curando: zs.curando };
        }
        return {
          sentado: p.sentado, oficio: p.oficio,
          gremioId: p.gremioId, gremioNombre: p.gremioNombre,
          vida: p.vida, vidaMax: p.vidaMax, anatomia,
        };
      },
      // el comercio (si hay uno) en el que participa el jugador de ESTA página.
      comercioPropio: () => {
        for (const c of ((room.state as any).comercios as Map<string, any>).values()) {
          if (c.jugadorA === room.sessionId || c.jugadorB === room.sessionId) {
            return {
              jugadorA: c.jugadorA, jugadorB: c.jugadorB,
              ofertaA: [...c.ofertaA].map((o: any) => ({ instanciaId: o.instanciaId, itemId: o.itemId, cantidad: o.cantidad })),
              ofertaB: [...c.ofertaB].map((o: any) => ({ instanciaId: o.instanciaId, itemId: o.itemId, cantidad: o.cantidad })),
              confirmadoA: c.confirmadoA, confirmadoB: c.confirmadoB,
            };
          }
        }
        return null;
      },
      inventarioCuerpo: (sessionId?: string) => {
        const p = room.state.players.get(sessionId ?? room.sessionId);
        return p ? [...p.inventario.cuerpo.items].map((it: any) => ({ id: it.id, itemId: it.itemId, cantidad: it.cantidad })) : [];
      },
      // fauna viva cerca de (x,y) — para el barrido de combate PvE: localizar
      // un objetivo real sin adivinar coordenadas de bake a mano.
      faunaCercana: (x: number, y: number, radio: number) => {
        let mejor: { id: string; especieId: string; x: number; y: number; dist: number } | null = null;
        for (const [id, f] of (room.state as any).fauna.entries()) {
          const dist = Math.hypot(f.x - x, f.y - y);
          if (dist <= radio && (!mejor || dist < mejor.dist)) mejor = { id, especieId: f.especieId, x: f.x, y: f.y, dist };
        }
        return mejor;
      },
      combateEstado: (combateId: string) => {
        const c = (room.state as any).combates.get(combateId);
        if (!c) return null;
        return { fase: c.fase, unidades: [...c.unidades.keys()] };
      },
      // todos los combates activos (dataset pequeño) — para localizar por
      // qué id se abrió uno recién iniciado sin depender de un mensaje de
      // vuelta que lo confirme.
      combates: () => {
        const salida: { id: string; fase: string; unidades: string[] }[] = [];
        for (const [id, c] of ((room.state as any).combates as Map<string, any>).entries()) {
          salida.push({ id, fase: c.fase, unidades: [...c.unidades.keys()] });
        }
        return salida;
      },
    };
  }

  // Anatomía/médico (docs/GDD_Anatomia.md, pedido 2026-08-30) — panel
  // PLACEHOLDER de testeo (ver panelMedico.ts), universal (no depende de
  // construcción habilitada, a diferencia de cocina: cualquier jugador
  // puede sangrar o vendarse).
  const panelMedico = new PanelMedico({
    contenedor,
    vendar: (zona, conUnguento) => room.send("medico:vendar", { targetSessionId: room.sessionId, zona, conUnguento }),
    entablillar: (zona) => room.send("medico:entablillar", { targetSessionId: room.sessionId, zona }),
    cirugia: (targetSessionId) => room.send("medico:cirugia", { targetSessionId }),
    protesis: (targetSessionId, zona) => room.send("medico:protesis", { targetSessionId, zona }),
    tomarUnguento: () => room.send("medico:tomarUnguento"),
    tomarJarabe: () => room.send("medico:tomarJarabe"),
  });

  // Compañero NPC (docs/GDD_Companeros.md, pedido 2026-08-30) — panel
  // PLACEHOLDER de testeo, mismo criterio que panelMedico.
  const panelCompanero = new PanelCompanero({
    contenedor,
    intentarReclutar: () => room.send("companero:intentarReclutar"),
    comprarDeVendedor: (npcVendedorId) => room.send("companero:comprarDeVendedor", { npcVendedorId }),
    darItem: (instanciaId) => room.send("companero:darItem", { instanciaId }),
    quitarItem: (instanciaId) => room.send("companero:quitarItem", { instanciaId }),
    equipar: (instanciaId, slot) => room.send("companero:equipar", { instanciaId, slot }),
    desequipar: (slot) => room.send("companero:desequipar", { slot }),
    llamar: () => room.send("companero:llamar"),
    fijarParticipaCombate: (activo) => room.send("companero:fijarParticipaCombate", { activo }),
  });
  room.onMessage("companero:error", (m: { motivo: string }) => console.log("[compañero]", m?.motivo));
  room.onMessage("companero:persuasionFallida", (m: { nombre: string }) => console.log(`[compañero] ${m?.nombre} no se deja convencer todavía`));
  room.onMessage("companero:reclutado", (m: { nombre: string; coste: number }) => console.log(`[compañero] ${m?.nombre} se une por ${m?.coste} Farycoins`));
  // Trabajador de producción (docs/GDD_Produccion.md §3bis, pedido 2026-08-31):
  // confirmación de que el trabajador contratado/compañero cambió — el
  // objeto colocado se repinta solo (no lleva estado visual propio todavía),
  // esto es solo para que quede constancia en consola mientras no haya panel dedicado.
  room.onMessage("companero:actualizado", (m: { ubicacion: string; propiedadId?: string }) => console.log("[compañero]", m));
  room.onMessage("plantilla:actualizada", (m: { construccionId: number; trabajadorAsignado?: boolean }) => console.log("[plantilla]", m));
  // Transporte y cofres (docs/GDD_Produccion.md §3ter) — sin panel propio
  // todavía (protocolo puro, ver sonda __construccion arriba), solo consola.
  room.onMessage("transporte:error", (m: { motivo: string }) => console.log("[transporte]", m?.motivo));
  const leerAnatomiaVista = (schema: any): Record<Zona, EstadoZonaVista> => {
    const vista = {} as Record<Zona, EstadoZonaVista>;
    for (const zona of ZONAS) {
      const z = schema[zona];
      vista[zona] = { sangrado: !!z?.sangrado, fractura: !!z?.fractura, infectado: !!z?.infectado, amputado: !!z?.amputado, protesis: !!z?.protesis, curando: !!z?.curando };
    }
    return vista;
  };
  room.onMessage("anatomia:golpe", (m: { zona: string; sangrado: boolean; fractura: boolean; amputacion: boolean }) =>
    console.log(`[anatomía] golpe en ${m?.zona}`, m));
  room.onMessage("medico:error", (m: { motivo: string }) => console.log("[médico]", m?.motivo));
  room.onMessage("medico:vendado", (m: { zona: string }) => console.log(`[médico] vendado: ${m?.zona}`));
  room.onMessage("medico:entablillado", (m: { zona: string }) => console.log(`[médico] entablillado: ${m?.zona}`));
  room.onMessage("medico:operado", () => console.log("[médico] cirugía completada"));
  room.onMessage("medico:protesisInstalada", (m: { zona: string }) => console.log(`[médico] prótesis instalada: ${m?.zona}`));
  room.onMessage("medico:unguentoTomado", (m: { unguentosTomados: number; curado: boolean }) =>
    console.log(`[enfermedades] ungüento tomado (${m?.unguentosTomados}/4)${m?.curado ? " — ¡catarro curado!" : ""}`));
  room.onMessage("medico:jarabeTomado", () => console.log("[enfermedades] jarabe tomado — ¡gripe curada!"));
  const leerEnfermedadesVista = (schema: any): EstadoEnfermedadesVista => ({
    catarro: !!schema?.catarro, unguentosTomados: schema?.unguentosTomados ?? 0, gripe: !!schema?.gripe,
  });
  // Mismo mecanismo de "último mensaje visto" que tenderete/cocina/crafteo
  // (barrido de sistemas 2026-08-31) — faltaba para médico, que vive fuera
  // del bloque hub: sin esto, __test.ultimoMensaje("medico:operado") daba
  // SIEMPRE null pese a que el servidor sí lo mandaba (bug del propio test,
  // no del servidor).
  for (const tipo of ["medico:error", "medico:vendado", "medico:entablillado", "medico:operado", "medico:protesisInstalada"]) {
    room.onMessage(tipo, (m: unknown) => ultimosMensajes.set(tipo, m));
  }

  // Logging real de "xxx:error" para los sistemas SIN panel de cliente
  // todavía (confirmado por grep, 2026-08-31): estos 21 tipos los manda el
  // servidor pero ningún fichero de client/src/ los escuchaba — se perdían
  // en silencio, ni en juego ni en consola/logs de test. Mismo criterio que
  // medico:error/cocina:error de arriba (CLAUDE.md), un simple console.log
  // del motivo — no necesitan `ultimosMensajes` (eso es solo para que los
  // e2e sin panel lean la RESPUESTA de una acción; esto es puro logging de
  // rechazo, igual que combate:error/tenderete:error/oficio:error ya
  // arreglados antes en esta misma sesión de barrido).
  for (const [tipo, etiqueta] of [
    ["actividad:error", "actividad"],
    ["animal:error", "animal"],
    ["coger:error", "coger"],
    ["curtidor:error", "curtidor"],
    ["dormir:error", "dormir"],
    ["habitacion:error", "habitación"],
    ["higiene:error", "higiene"],
    ["inmueble:error", "inmueble"],
    ["motriz:error", "motriz"],
    ["npc:error", "npc"],
    ["personaje:error", "personaje"],
    ["piel:error", "piel"],
    ["plantilla:error", "plantilla"],
    ["produccion:error", "producción"],
    ["quesera:error", "quesera"],
    ["recipiente:error", "recipiente"],
    ["refinamiento:error", "refinamiento"],
    ["soltar:error", "soltar"],
    ["transporte:error", "transporte"],
  ] as const) {
    room.onMessage(tipo, (m: { motivo?: string }) => console.log(`[${etiqueta}]`, m?.motivo));
  }

  // Tenderete/oficio (docs/GDD_Mercado.md, docs/GDD_Profesiones.md): sin
  // panel de cliente todavía (protocolo probado por e2e mandando el mensaje
  // Colyseus real), pero sus "xxx:error" se colaban sin loguear — bug real
  // encontrado en el barrido de sistemas (2026-08-31), mismo patrón que
  // combate:error la vez anterior: sin este listener, un rechazo del
  // servidor (precio inválido, no eres el dueño, oficio desconocido...) era
  // invisible tanto en juego como en consola.
  room.onMessage("tenderete:error", (m: { motivo: string }) => console.log("[tenderete]", m?.motivo));
  room.onMessage("oficio:error", (m: { motivo: string }) => console.log("[oficio]", m?.motivo));

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
      name: player.name,
      catarro: false,
      gripe: false,
      tocandoInstrumento: false,
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

    // Equipo (docs/GDD_Equipo.md): armadura/accesorios/mochilas puestos —
    // se regenera entero (mismo criterio "reconstruye, no diferencies, en
    // eventos discretos" que ya usa el servidor) cada vez que CUALQUIER
    // slot cambia, para jugador local Y remoto por igual (cualquiera debe
    // ver el equipo de los demás). `sessionId` como semilla: determinista
    // por jugador, así dos piezas iguales no salen idénticas letra a letra
    // entre jugadores distintos (variación de color por vóxel).
    // Sastre legendario (docs/GDD_Ropa_Procedural.md §Sastre legendario,
    // pedido 2026-08-31): `equipoBlueprintRopa` es slot->prendaGeneradaId
    // (solo para los slots con una prenda legendaria puesta) — se resuelve
    // contra `room.state.blueprintsRopa` (cargado perezosamente por el
    // servidor la primera vez que hace falta) para que se vea IGUAL que en
    // el panel del telar, para cualquier jugador que la vea puesta, no
    // solo su creador.
    const resolverBlueprintsRopa = (): Record<string, BlueprintRopaResuelto> => {
      const resueltos: Record<string, BlueprintRopaResuelto> = {};
      for (const [slot, id] of player.inventario.equipoBlueprintRopa.entries()) {
        const bp = room.state.blueprintsRopa.get(String(id));
        if (!bp) continue;
        try {
          resueltos[slot] = {
            prendaBaseId: bp.prendaBaseId, materialId: bp.materialId,
            detalle: JSON.parse(bp.detalleJson), tintes: JSON.parse(bp.tintesJson),
          };
        } catch { /* blueprint corrupto/a medias de sincronizar — ese slot cae al catálogo estático hasta el próximo cambio */ }
      }
      return resueltos;
    };
    const actualizarEquipoVisual = () => aplicarEquipoAlRig(rig.objeto, player.inventario.equipo, sessionId, resolverBlueprintsRopa());
    actualizarEquipoVisual();
    $(player.inventario.equipo).onAdd(actualizarEquipoVisual);
    $(player.inventario.equipo).onRemove(actualizarEquipoVisual);
    $(player.inventario.equipoBlueprintRopa).onAdd(actualizarEquipoVisual);
    $(player.inventario.equipoBlueprintRopa).onRemove(actualizarEquipoVisual);

    // Montura (docs/GDD_Monturas.md, pedido 2026-08-30): mientras
    // `monturaEspecieId` no esté vacío, `estado.rig` pasa a ser el animal
    // (mismo bucle de interpolación/animación que ya trata jugadores/NPCs/
    // fauna por igual, RigHumanoide y AnimalVoxel comparten forma
    // {objeto,actualizar,orientar}) — el rig humanoide de siempre se queda
    // oculto pero VIVO (nunca se destruye: conserva el equipo puesto) para
    // volver a él tal cual al desmontar.
    let monturaActual = "";
    // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): a diferencia de una
    // montura animal, el barco NO fusiona el rig (su propia entidad ya se
    // pinta aparte en state.barcos.onAdd, arriba) — mientras barcoId>0
    // simplemente se oculta el rig humanoide/montura del ocupante, sea
    // capitán o pasajero.
    let barcoActual = 0;
    $(player).onChange(() => {
      estado.destinoX = player.x;
      estado.destinoZ = player.y;
      estado.nadando = player.estado !== "tierra";
      estado.destinoY = estado.nadando ? -HUNDIMIENTO_NADANDO + player.nivel * HUNDIMIENTO_POR_NIVEL : 0;
      escena.actualizarVida(sessionId, player.vida, player.vidaMax);
      // Anatomía (docs/GDD_Anatomia.md): siempre sobre el rig HUMANOIDE (no
      // el de montura/barco, si el jugador está montado/embarcado ahora
      // mismo) — se aplica igual para jugador local y remoto.
      aplicarAnatomiaCompleta(rig.objeto, player.anatomia);
      if (esYo) panelMedico.actualizarEstado(leerAnatomiaVista(player.anatomia));
      // Enfermedades (docs/GDD_Enfermedades.md): catarro/gripe son
      // condición GLOBAL, no del rig — el panel solo se refresca para el
      // jugador local, pero la burbuja de tos/tiritona (bucle()) es de
      // cualquier jugador visible, remoto incluido.
      estado.catarro = !!player.enfermedades?.catarro;
      estado.gripe = !!player.enfermedades?.gripe;
      if (esYo) panelMedico.actualizarEnfermedades(leerEnfermedadesVista(player.enfermedades));
      // Instrumentos musicales (docs/GDD_Instrumentos.md): la POSE se rige
      // por este booleano replicado (mismo criterio que `durmiendo`) — así
      // un jugador que llega a mitad de canción también ve al que toca en
      // la pose correcta, aunque se perdiera el broadcast puntual que
      // dispara el AUDIO (ver "instrumento:tocando"/"instrumento:parado").
      estado.tocandoInstrumento = !!player.tocandoInstrumento;
      // Sentarse/tumbarse (pedido 2026-08-31) — mismo criterio que
      // tocandoInstrumento arriba: la pose se rige por el booleano
      // replicado, no por si ESTE cliente fue quien lo pidió.
      estado.sentado = !!player.sentado;
      estado.sentadoSuelo = !!player.sentadoSuelo;
      estado.durmiendo = !!player.durmiendo;
      if (!estado.nadando) {
        estado.destinoY = estado.sentado
          ? -HUNDIMIENTO_SENTADO
          : estado.sentadoSuelo
          ? -HUNDIMIENTO_SENTADO_SUELO
          : 0;
      }
      if (player.monturaEspecieId !== monturaActual) {
        monturaActual = player.monturaEspecieId;
        if (monturaActual) {
          const animalRig = crearAnimalVoxel(animalPlaceholder(monturaActual));
          animalRig.objeto.rotation.order = "YXZ";
          aplicarMonturaAlAnimal(animalRig.objeto, null);
          rig.objeto.visible = false;
          estado.rig = animalRig;
        } else {
          rig.objeto.visible = true;
          estado.rig = rig;
        }
        escena.añadirEntidad(sessionId, estado.rig.objeto, estado.x, estado.z, player.name);
      }
      if (player.barcoId !== barcoActual) {
        barcoActual = player.barcoId;
        estado.rig.objeto.visible = !barcoActual;
      }
      if (esYo) {
        escena.seguirPunto(player.x, player.y);
        panelJugador?.actualizar(player);
        // gancho para los tests E2E (Playwright lee la verdad del servidor)
        (window as any).__colonyDebug = { x: player.x, y: player.y, estado: player.estado, nivel: player.nivel };
      }
    });
    if (esYo) panelJugador?.actualizar(player);
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
    // NPC tutorial (docs/GDD_Profesiones.md ronda 3, pedido 2026-08-30:
    // "se generan vestidos") — sin vóxeles bakeados propios (no vienen de
    // poblacion/), así que se visten reusando TAL CUAL el pipeline de
    // equipo del jugador (equipoVisual.ts) sobre el rig humanoide de
    // repuesto; `npc.equipo` viene vacío para cualquier NPC normal.
    if (npc.equipo && [...npc.equipo.keys()].length > 0) aplicarEquipoAlRig(rig.objeto, npc.equipo, slotId);
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
      // Suciedad (docs/GDD_Personaje.md §3.6, pedido 2026-08-30): el
      // servidor cambia `npc.grito` un momento para soltar una frase de
      // "hueles mal" — sin esto la burbuja se quedaría con el pregón
      // capturado al aparecer el NPC, sin enterarse nunca del cambio.
      meta.grito = npc.grito || "";
      escena.actualizarVida(`npc_${slotId}`, npc.vida, npc.vidaMax);
    });
  });
  $(room.state).npcs.onRemove((_npc: any, slotId: string) => {
    npcsVisual.delete(slotId);
    npcsMeta.delete(slotId);
    escena.quitarEntidad(`npc_${slotId}`);
  });

  // --- Compañero NPC (docs/GDD_Companeros.md, pedido 2026-08-30): mismo
  // circuito que un Npc de poblacion/ (mismo vóxel real, por npcOrigenSlot —
  // sigue viéndose igual que antes de reclutarlo), pero clave "companero_<id>"
  // porque comparte namespace de etiquetas con jugadores/NPCs. Al mucho UN
  // compañero visible a la vez en este cliente (el del jugador local o el de
  // otro jugador cercano — cada jugador solo tiene el suyo).
  const companerosVisual = new Map<string, EstadoJugador>();
  const esMiCompanero = (c: any) => c.duenoNombre === room.state.players.get(room.sessionId)?.name;
  const actualizarPanelCompanero = (c: any) => {
    panelCompanero.actualizarEstado({ nombre: c.nombre, nivel: c.nivel, vida: c.vida, vidaMax: c.vidaMax, participaEnCombate: c.participaEnCombate });
    panelResumen.actualizarCompanero({ nombre: c.nombre, nivel: c.nivel, vida: c.vida, vidaMax: c.vidaMax, x: c.x, y: c.y, quejaTexto: c.quejaTexto });
  };
  $(room.state).companeros.onAdd((c: any, id: string) => {
    const vox = voxPorSlot.get(c.npcOrigenSlot);
    const rig = vox ? crearPersonajeVoxel(vox) : crearRigHumanoide({ colorTunica: "#7a6248" });
    rig.objeto.rotation.order = "YXZ";
    const estado: EstadoJugador = {
      rig, destinoX: c.x, destinoZ: c.y, destinoY: 0, x: c.x, z: c.y, y: 0, nadando: false, name: c.nombre,
      quejaTexto: c.quejaTexto,
    };
    companerosVisual.set(id, estado);
    escena.añadirEntidad(`companero_${id}`, rig.objeto, c.x, c.y, c.nombre);
    escena.actualizarVida(`companero_${id}`, c.vida, c.vidaMax);
    if (esMiCompanero(c)) actualizarPanelCompanero(c);
    $(c).onChange(() => {
      estado.destinoX = c.x;
      estado.destinoZ = c.y;
      estado.quejaTexto = c.quejaTexto;
      escena.actualizarVida(`companero_${id}`, c.vida, c.vidaMax);
      if (esMiCompanero(c)) actualizarPanelCompanero(c);
    });
  });
  $(room.state).companeros.onRemove((c: any, id: string) => {
    companerosVisual.delete(id);
    escena.quitarEntidad(`companero_${id}`);
    if (esMiCompanero(c)) { panelCompanero.actualizarEstado(null); panelResumen.actualizarCompanero(null); }
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
    const criatura = vox ? crearAnimalVoxel(vox) : crearAnimalVoxel(animalPlaceholder(animal.especieId));
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
  // no existe, así que siempre usa la caja placeholder por especie,
  // animalPlaceholder.ts). Con silla puesta (docs/GDD_Monturas.md,
  // `mascota.montura`), lleva la silla puesta SIEMPRE que se la ve —
  // siguiendo o "aparcada" — no solo mientras se está montando.
  const mascotasVisual = new Map<string, EstadoJugador>();
  $(room.state).mascotas.onAdd((mascota: any, id: string) => {
    const criatura = crearAnimalVoxel(animalPlaceholder(mascota.especieId));
    criatura.orientar(1, 1);
    if (mascota.montura) aplicarMonturaAlAnimal(criatura.objeto, null);
    const estado: EstadoJugador = {
      rig: criatura,
      destinoX: mascota.x, destinoZ: mascota.y, destinoY: 0,
      x: mascota.x, z: mascota.y, y: 0,
      nadando: false,
    };
    mascotasVisual.set(id, estado);
    escena.añadirEntidad(`mascota_${id}`, criatura.objeto, mascota.x, mascota.y, `🐾 ${mascota.especieId} de ${mascota.duenoNombre}`);
    let monturaVisible = !!mascota.montura;
    $(mascota).onChange(() => {
      estado.destinoX = mascota.x;
      estado.destinoZ = mascota.y;
      if (mascota.montura !== monturaVisible) {
        monturaVisible = mascota.montura;
        if (monturaVisible) aplicarMonturaAlAnimal(criatura.objeto, null);
      }
    });
  });
  $(room.state).mascotas.onRemove((_mascota: any, id: string) => {
    mascotasVisual.delete(id);
    escena.quitarEntidad(`mascota_${id}`);
  });

  // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30) — SIEMPRE visibles en
  // state.barcos (a diferencia de una mascota montada, que desaparece del
  // Schema): varias plazas, el barco es su propia entidad aunque esté
  // ocupado. Los ocupantes (Player.barcoId>0) solo ocultan su rig humanoide
  // más abajo, en el onChange de players — este bloque solo pinta el casco.
  const barcosVisual = new Map<string, EstadoJugador>();
  $(room.state).barcos.onAdd((barco: any, id: string) => {
    const criatura = crearBarcoVisual(barco.tipoId);
    const estado: EstadoJugador = {
      rig: criatura as unknown as EstadoJugador["rig"],
      destinoX: barco.x, destinoZ: barco.y, destinoY: 0,
      x: barco.x, z: barco.y, y: 0,
      nadando: false,
    };
    barcosVisual.set(id, estado);
    escena.añadirEntidad(`barco_${id}`, criatura.objeto, barco.x, barco.y);
    $(barco).onChange(() => {
      estado.destinoX = barco.x;
      estado.destinoZ = barco.y;
    });
  });
  $(room.state).barcos.onRemove((_barco: any, id: string) => {
    barcosVisual.delete(id);
    escena.quitarEntidad(`barco_${id}`);
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
    // Bandidos de mazmorra (pedido 2026-08-31): "serán bandido y punto,
    // nombre de lo que es" — respawnean cada tanto, así que NUNCA llevan
    // nombre de político (a diferencia de los bandidos del mapa exterior,
    // que sí son individuos permanentes — docs/GDD_Poblacion_NPCs.md). Se
    // etiquetan por su tipo, no por su enemigoId de catálogo crudo.
    const nombreMostrado = enemigo.enemigoId.includes("bandido") ? "Bandido" : enemigo.enemigoId;
    const etiqueta = enemigo.esBoss ? `☠ ${nombreMostrado}` : nombreMostrado;
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
  // Bug real encontrado en el barrido de sistemas 2026-08-31 (mismo motivo
  // que costó tiempo en el e2e de mesaAjedrez: un "*:error" del servidor
  // sin console.log en el cliente es invisible salvo un console.warn
  // genérico de colyseus.js "onMessage() not registered"): combate:error
  // era el ÚNICO *:error de todo game.ts sin logear su motivo (demasiado
  // lejos, ya en combate, pvp deshabilitado...) — mismo patrón que el resto.
  room.onMessage("combate:error", (m: { motivo: string }) => console.log("[combate]", m?.motivo));

  // --- Minijuego de forja (docs/GDD_Crafteo.md §Minijuego de Herrería,
  // pedido 2026-09-01) — panel PLACEHOLDER de testeo (ver panelForja.ts),
  // mismo criterio que panelCombate.ts. Arranca vía "crafteo:iniciar" (sin
  // UI de recetas todavía, igual que el resto de crafteo — window.__test),
  // reactivo solo a mensajes (una forja no tiene Schema replicado, es
  // efímera por sesión). ESPACIO golpea mientras hay una forja en FORJAR,
  // mismo hueco de tecla libre que el resto de acciones sin targeting.
  let forjaFaseActual: string | null = null;
  const panelForja = new PanelForja({
    contenedor,
    enviarAvivar: () => room.send("crafteo:herreria:accion", { accion: "avivar" }),
    enviarGolpear: () => room.send("crafteo:herreria:accion", { accion: "golpear" }),
    enviarTemplar: () => room.send("crafteo:herreria:accion", { accion: "templar" }),
    enviarCancelar: () => room.send("crafteo:herreria:cancelar"),
  });
  room.onMessage("crafteo:herreria:iniciado", (m: { cfg: any; sesion: any }) => {
    forjaFaseActual = m.sesion.fase;
    panelForja.mostrarSesion(m.cfg, m.sesion);
  });
  room.onMessage("crafteo:herreria:progreso", (m: { sesion: any }) => {
    forjaFaseActual = m.sesion.fase;
    panelForja.actualizarSesion(m.sesion);
  });
  room.onMessage("crafteo:herreria:completado", (m: any) => {
    forjaFaseActual = null;
    panelForja.mostrarResultado(m);
  });
  room.onMessage("crafteo:herreria:cancelado", () => {
    forjaFaseActual = null;
    panelForja.ocultar();
  });

  // --- Mascotas (docs/GDD_Mascotas.md) — panel PLACEHOLDER de testeo (ver panelMascotas.ts). Tecla G: dar de comer al animal domesticable más cercano. ---
  const panelMascotas = new PanelMascotas({
    contenedor,
    llamar: (mascotaId) => room.send("mascota:llamar", { mascotaId }),
    dejarEnPropiedad: (mascotaId, propiedadId) => room.send("mascota:dejarEnPropiedad", { mascotaId, propiedadId }),
    ponerMontura: (mascotaId) => room.send("mascota:ponerMontura", { mascotaId }),
  });
  room.onMessage("mascota:lista", (lista: MascotaVista[]) => { panelMascotas.actualizarListado(lista); panelResumen.actualizarMascotas(lista); });
  room.onMessage("mascota:progreso", (m: ProgresoDomesticar) => panelMascotas.actualizarProgreso(m));
  room.onMessage("mascota:domesticada", () => { panelMascotas.actualizarProgreso(null); room.send("mascota:listar"); });
  room.onMessage("mascota:actualizada", () => room.send("mascota:listar"));
  room.onMessage("mascota:error", (m: { motivo: string }) => console.log("[mascota]", m?.motivo));
  room.send("mascota:listar");

  // --- Panel "todo lo que tienes" (docs/GDD_Resumen_Jugador.md, pedido
  // 2026-08-31) — monturas y compañero se apuntan a los mismos flujos de
  // arriba/abajo, propiedades es el único mensaje nuevo. Tecla Tab.
  const panelResumen = new PanelResumen({
    contenedor,
    consultarPropiedades: () => room.send("propiedad:listarMias"),
  });
  room.onMessage("propiedad:misPropiedades", (lista: PropiedadVista[]) => panelResumen.actualizarPropiedades(lista));

  // --- Comercio jugador-jugador (docs/GDD_Comercio.md, pedido 2026-08-30) —
  // panel PLACEHOLDER de testeo (ver panelComercio.ts). Tecla T: propone
  // comerciar con el jugador más cercano; se abre solo cuando AMBOS la
  // pulsan apuntándose el uno al otro (mismo criterio "servidor decide" que
  // el resto de mecánicas de esta pasada).
  const panelComercio = new PanelComercio({
    contenedor,
    ofrecer: (instanciaId) => room.send("comercio:ofrecer", { instanciaId }),
    quitarOferta: (instanciaId) => room.send("comercio:quitarOferta", { instanciaId }),
    confirmar: () => room.send("comercio:confirmar"),
    cancelar: () => room.send("comercio:cancelar"),
  });
  function actualizarPanelComercio() {
    const comercios = room.state.comercios as any;
    let entrada: any = null;
    for (const c of comercios.values()) {
      if (c.jugadorA === room.sessionId || c.jugadorB === room.sessionId) { entrada = c; break; }
    }
    if (!entrada) return panelComercio.cerrar();
    const soyA = entrada.jugadorA === room.sessionId;
    const idPropio = soyA ? entrada.jugadorA : entrada.jugadorB;
    const idOtro = soyA ? entrada.jugadorB : entrada.jugadorA;
    const estado: EstadoComercioVista = {
      comercioId: "",
      nombrePropio: room.state.players.get(idPropio)?.name ?? "",
      nombreOtro: room.state.players.get(idOtro)?.name ?? "",
      ofertaPropia: [...(soyA ? entrada.ofertaA : entrada.ofertaB)].map((o: any) => ({ instanciaId: o.instanciaId, itemId: o.itemId, cantidad: o.cantidad })),
      ofertaOtro: [...(soyA ? entrada.ofertaB : entrada.ofertaA)].map((o: any) => ({ instanciaId: o.instanciaId, itemId: o.itemId, cantidad: o.cantidad })),
      confirmadoPropio: soyA ? entrada.confirmadoA : entrada.confirmadoB,
      confirmadoOtro: soyA ? entrada.confirmadoB : entrada.confirmadoA,
    };
    panelComercio.actualizar(estado);
  }
  $(room.state).comercios.onAdd(() => actualizarPanelComercio());
  $(room.state).comercios.onRemove(() => actualizarPanelComercio());
  room.onStateChange(() => actualizarPanelComercio());
  room.onMessage("comercio:cerrado", () => panelComercio.cerrar());
  room.onMessage("comercio:error", (m: { motivo: string }) => console.log("[comercio]", m?.motivo));
  room.onMessage("comercio:propuesta", (m: { deNombre: string }) => console.log(`[comercio] ${m?.deNombre} quiere comerciar contigo — pulsa T para aceptar`));

  // --- Equipo (docs/GDD_Equipo.md) — panel PLACEHOLDER de testeo (ver
  // panelJugador.ts), oculto hasta pulsar I (mismo criterio "condicional"
  // que panelCombate.ts). `equipo:error` es la única respuesta del
  // servidor — el propio cambio de Schema (inventario.equipo/cuerpo/extras)
  // ya dispara el refresco vía el onChange de player, sin mensaje aparte.
  const panelJugador = new PanelJugador({
    contenedor,
    equipar: (instanciaId, slot) => room.send("equipo:equipar", { instanciaId, slot }),
    desequipar: (slot) => room.send("equipo:desequipar", { slot }),
    // Grid drag&drop (docs/GDD_Inventario.md §10, pedido 2026-08-30).
    mover: (instanciaId, contenedorDestino, x, y, rot) => room.send("inventario:mover", { instanciaId, contenedorDestino, x, y, rot }),
  });
  room.onMessage("equipo:error", (m: { motivo: string }) => console.log("[equipo]", m?.motivo));
  room.onMessage("inventario:error", (m: { motivo: string }) => console.log("[inventario]", m?.motivo));

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
  room.onMessage("twitch:error", (m: { motivo?: string }) => console.log("[twitch]", m?.motivo));

  // --- Login de admin (docs/GDD_Admin.md, pedido 2026-08-30) — dual:
  // usuario/contraseña propios (formulario, PanelLoginAdmin) O una cuenta
  // de Twitch ya vinculada (el botón "Conectar con Twitch" de arriba sirve
  // para las dos cosas a la vez si esa cuenta está vinculada — ver
  // twitch/rutasOauth.ts, añade adminSession al redirect). Sin sesión de
  // admin, todo sigue exactamente igual que hasta ahora (jugador normal).
  let identidadAdminActual: { usuario: string; rol: "jarl" | "superadmin"; mapaId: string | null; esJarlAqui: boolean } | null = null;
  const cajaAdmin = document.createElement("div");
  cajaAdmin.style.position = "absolute";
  cajaAdmin.style.left = "16px";
  cajaAdmin.style.top = "56px";
  contenedor.appendChild(cajaAdmin);

  const mostrarEstadoAdmin = (texto: string) => {
    cajaAdmin.innerHTML = "";
    const caja = document.createElement("div");
    caja.style.background = "rgba(16,16,24,0.88)";
    caja.style.color = "#e0e0f0";
    caja.style.font = "13px sans-serif";
    caja.style.padding = "6px 10px";
    caja.style.borderRadius = "6px";
    caja.style.border = "1px solid #4a4a6a";
    caja.textContent = texto;
    cajaAdmin.appendChild(caja);
  };

  if (adminSession) {
    mostrarEstadoAdmin("👑 Admin: conectando...");
  } else {
    new PanelLoginAdmin({
      contenedor: cajaAdmin,
      serverUrlHttp: SERVER_URL.replace(/^ws/, "http"),
      onLoginOk: (token) => {
        sessionStorage.setItem("adminSession", token);
        location.reload(); // recarga para que el próximo join mande adminSession, mismo ciclo que el redirect de Twitch
      },
    });
  }
  let panelJarl: PanelJarl | null = null;
  let panelDebugTestZone: PanelDebugTestZone | null = null;
  room.onMessage(
    "admin:sesionConfirmada",
    (m: { usuario: string; rol: "jarl" | "superadmin"; mapaId: string | null; esJarlAqui: boolean }) => {
      identidadAdminActual = m;
      const etiquetaRol = m.rol === "superadmin" ? "⭐ Superadmin" : "👑 Jarl";
      mostrarEstadoAdmin(`${etiquetaRol}: ${m.usuario}${m.rol === "jarl" && !m.esJarlAqui ? " (sin jarl aquí)" : ""}`);

      // Panel de jarl/superadmin (docs/GDD_Admin.md): un jarl solo lo ve
      // cuando ES jarl DE ESTE mapa concreto (esJarlAqui) — en un mapa
      // ajeno no tiene ninguna herramienta que ofrecer. Un superadmin lo ve
      // SIEMPRE, en cualquier mapa (puedeActuarComoJarl ya lo trata como
      // jarl en todos lados), con la sección extra de gestión de cuentas.
      const puedeVerPanel = m.rol === "superadmin" || m.esJarlAqui;
      if (puedeVerPanel && !panelJarl && adminSession) {
        panelJarl = new PanelJarl({
          contenedor,
          esSuperadmin: m.rol === "superadmin",
          serverUrlHttp: SERVER_URL.replace(/^ws/, "http"),
          adminToken: adminSession,
          pvpFijar: (on) => room.send("pvp:fijar", { on }),
          simularCanje: (tipo) => room.send("twitch:simularCanje", { tipo }),
          simularComando: (comando) => room.send("twitch:simularComando", { comando }),
          forzarDirecto: (on) => room.send("twitch:forzarDirecto", { on }),
          renombrarCapital: (nombre) => room.send("admin:capital:renombrar", { nombre }),
        });
        room.send("admin:capital:consultar");
      }
      // Panel de debug de la Test Zone (docs/GDD_Admin.md, pedido
      // 2026-08-31): mismo criterio de visibilidad que PanelJarl — el
      // servidor es quien gatea de verdad cada admin:debug:*, esto es solo
      // conveniencia de UI para no tener que escribir comandos a mano.
      if (puedeVerPanel && !panelDebugTestZone && adminSession) {
        panelDebugTestZone = new PanelDebugTestZone({
          contenedor,
          darItem: (itemId, cantidad) => room.send("admin:debug:darItem", { itemId, cantidad }),
          limpiarInventario: () => room.send("admin:debug:limpiarInventario", {}),
          godMode: (activo) => room.send("admin:debug:godMode", { activo }),
          maxOficio: (slot) => room.send("admin:debug:maxOficio", { slot }),
          resetearNodo: (nodoId) => room.send("admin:debug:resetearNodo", { nodoId }),
          teleport: (x, y) => room.send("admin:debug:teleport", { x, y }),
        });
      }
    },
  );
  room.onMessage("pvp:actualizado", (m: { on: boolean }) => panelJarl?.actualizarPvp(m.on));
  room.onMessage("capital:renombrada", (m: { nombre: string }) => panelJarl?.actualizarCapital(m?.nombre ?? ""));
  room.onMessage("admin:debug:ok", (m: { accion: string }) => panelDebugTestZone?.mostrarResultado(`OK: ${m?.accion}`));
  room.onMessage("admin:error", (m: { motivo: string }) => panelDebugTestZone?.mostrarResultado(`Error: ${m?.motivo}`));
  room.onMessage("pvp:error", (m: { motivo?: string }) => console.log("[pvp]", m?.motivo));

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

  // --- Pesca (docs/GDD_Pesca.md, pedido 2026-08-30) — panel PLACEHOLDER de
  // testeo + una boya cosmética SOLO LOCAL (no viaja por el Schema — nadie
  // más necesita verla, mismo criterio de scope que el resto de esta
  // pasada). Tecla U: "usar" la caña — lanza si no se está pescando ya,
  // reacciona a la picada si la boya se está agitando.
  const panelPesca = new PanelPesca({ contenedor, cancelar: () => room.send("pesca:cancelar") });

  // --- Cofres de mundo de la Test Zone (docs/GDD_Admin.md, pedido
  // 2026-08-31) — sin gating (cualquier jugador del mapa testzone), sin
  // schema de cofres en el state todavía (lo está montando otro agente en
  // paralelo), así que sin detección de proximidad real: tecla Y abre el
  // cofre de prueba fijo `ID_COFRE_TEST_PRUEBA`.
  const ID_COFRE_TEST_PRUEBA = "cofre_test_1";
  const panelContenedorTest = new PanelContenedorTest({
    contenedor,
    tomar: (id, itemId, cantidad) => room.send("contenedorTest:tomar", { id, itemId, cantidad }),
    cerrar: () => {},
  });
  room.onMessage("contenedorTest:estado", (m: { id: string; items: { itemId: string; cantidad: number }[] }) =>
    panelContenedorTest.actualizarEstado(m?.id, m?.items ?? []));
  let estadoPesca: EstadoPescaVista = null;
  let boyaMesh: Mesh | null = null;
  const ID_BOYA = "pesca_boya_propia";
  function quitarBoya() {
    if (boyaMesh) { escena.quitarEntidad(ID_BOYA); boyaMesh = null; }
  }
  room.onMessage("pesca:lanzada", (m: { x: number; y: number }) => {
    estadoPesca = "esperando";
    panelPesca.actualizar(estadoPesca);
    quitarBoya();
    boyaMesh = new Mesh(new SphereGeometry(0.12, 8, 8), new MeshBasicMaterial({ color: 0xd9432a }));
    escena.añadirEntidad(ID_BOYA, boyaMesh, m.x, m.y, "🎣");
    const inicio = performance.now();
    animables.push({
      actualizar: () => {
        if (!boyaMesh) return;
        const t = (performance.now() - inicio) / 1000;
        const amplitud = estadoPesca === "picando" ? 0.18 : 0.05;
        const velocidad = estadoPesca === "picando" ? 10 : 2.5;
        boyaMesh.position.y = 0.15 + Math.sin(t * velocidad) * amplitud;
      },
    });
  });
  room.onMessage("pesca:pica", () => { estadoPesca = "picando"; panelPesca.actualizar(estadoPesca); });
  room.onMessage("pesca:escapado", () => { estadoPesca = "esperando"; panelPesca.actualizar(estadoPesca); });
  room.onMessage("pesca:capturado", (m: { itemId: string }) => {
    console.log(`[pesca] capturado: ${m?.itemId}`);
    estadoPesca = "esperando"; // el servidor sigue pescando (misma caña, mismo cebo ya consumido) — ver manejarPescaInteractuar
    panelPesca.actualizar(estadoPesca);
  });
  room.onMessage("pesca:cancelada", () => { estadoPesca = null; panelPesca.actualizar(null); quitarBoya(); });
  room.onMessage("pesca:error", (m: { motivo: string }) => {
    console.log("[pesca]", m?.motivo);
    // Un error al LANZAR no cambia nada (nunca se llegó a pescar). Un error
    // al reaccionar a una picada (p.ej. inventario lleno) sí — el servidor
    // sigue pescando, solo que sin capturar esta vez.
    if (estadoPesca === "picando") { estadoPesca = "esperando"; panelPesca.actualizar(estadoPesca); }
  });

  // --- Cadáveres/caza (docs/GDD_Caza.md; procesado rediseñado 2026-08-30
  // octava pasada) — placeholder de testeo, mismo criterio que el resto de
  // esta pasada (sin arte, sin panel propio): caja tumbada en el sitio,
  // tecla L lootea (da el ítem "cadáver entero" al inventario del jugador,
  // ya no carne/tendones/tripas sueltos). El cadáver YA NO se desuella en el
  // mundo — K/O procesan el que el jugador lleva ENCIMA (el primero que
  // encuentre): K desuella, O despieza, cada uno en dos pasos (iniciar/
  // recolectar, como crafteo) — más rápido/rinde más si `construccionId`
  // apunta a una mesa_despiece/mesa_corte propia cercana (sin UI de
  // targeting todavía, se manda sin construccionId = "en el sitio").
  $(room.state).cadaveres.onAdd((cadaver: any, id: string) => {
    const caja = crearPlaceholder("#5a3a2a", 1.1, 0.3, 0.6);
    escena.añadirEntidad(`cadaver_${id}`, caja, cadaver.x, cadaver.y, `💀 ${cadaver.especieOrigenId}`);
  });
  $(room.state).cadaveres.onRemove((_cadaver: any, id: string) => escena.quitarEntidad(`cadaver_${id}`));
  // true entre "procesarIniciado" y "procesado"/error — mismo criterio que
  // "sin cola" del resto del crafteo: como mucho un procesado a la vez, K/O
  // recolectan en vez de arrancar otro mientras esté en curso.
  let procesandoCadaver = false;
  room.onMessage("cadaver:error", (m: { motivo: string }) => { procesandoCadaver = false; console.log("[cadáver]", m?.motivo); });
  room.onMessage("cadaver:lootado", (m: { movidos: number }) => console.log("[cadáver] lootados", m?.movidos, "objeto(s)"));
  room.onMessage("cadaver:procesarIniciado", (m: { verbo: string; enMesa: boolean; terminaEn: number }) =>
    console.log("[cadáver] procesando", m?.verbo, m?.enMesa ? "(en mesa, rápido)" : "(en el sitio, lento)"));
  room.onMessage("cadaver:procesado", (m: { entregados: string[] }) => { procesandoCadaver = false; console.log("[cadáver] procesado, entregado:", m?.entregados); });

  /** El primer ítem "cadáver entero" que lleve encima el jugador — sin UI de targeting, mismo criterio que el resto de teclas de acción. */
  function cadaverEnInventario(): number | null {
    const yo = room.state.players.get(room.sessionId);
    if (!yo) return null;
    for (const it of yo.inventario.cuerpo.items as Iterable<{ id: number; itemId: string }>) {
      if (it.itemId.startsWith("cadaver_")) return it.id;
    }
    return null;
  }

  // --- Crecimiento de bosques (docs/GDD_Bosques.md) — placeholder de
  // testeo, mismo criterio que cadáveres: sin arte propio todavía. SOLO
  // los árboles NUEVOS (brote de propagación silvestre o plantado por un
  // jugador) viven aquí — los árboles del bake original siguen siendo la
  // decoración estática de siempre, ver "límite conocido" del GDD: talar
  // uno de esos no hace desaparecer su modelo todavía, aunque el servidor
  // ya deja pasar por su casilla de verdad. Tecla H tala el árbol más
  // cercano (exige hacha_talar en el inventario, el servidor lo valida).
  $(room.state).arbolesVivos.onAdd((arbol: any, id: string) => {
    const joven = arbol.etapa === "joven";
    const caja = crearPlaceholder(joven ? "#4a7a3a" : "#2f5a24", joven ? 0.3 : 0.7, joven ? 0.5 : 1.6, joven ? 0.3 : 0.7);
    escena.añadirEntidad(`arbol_${id}`, caja, arbol.x, arbol.y, `${joven ? "🌱" : "🌳"} ${arbol.especieId}`);
  });
  $(room.state).arbolesVivos.onRemove((_arbol: any, id: string) => escena.quitarEntidad(`arbol_${id}`));
  room.onMessage("arbol:error", (m: { motivo: string }) => console.log("[árbol]", m?.motivo));
  room.onMessage("arbol:talado", (m: { especieId: string; etapa: string; entregados: string[] }) =>
    console.log("[árbol] talado", m?.especieId, m?.etapa, "— entregado:", m?.entregados));
  room.onMessage("arbol:plantado", (m: { especieId: string }) => console.log("[árbol] plantado", m?.especieId));

  // Respuesta a pedirExclusiones (docs/GDD_Bosques.md §7) — correlada por sector.
  room.onMessage("sector:exclusiones", (m: { sectorX: number; sectorY: number; posiciones: string[] }) => {
    const k = `${m?.sectorX}_${m?.sectorY}`;
    pendientesExclusiones.get(k)?.(m?.posiciones ?? []);
  });

  // Ocultado EN VIVO (docs/GDD_Bosques.md §7): algo del bake (recolectable
  // o árbol) desaparece del servidor mientras su sector ya está
  // materializado delante del jugador — se apaga esa instancia concreta
  // sin reconstruir el sector entero. No-op si ese sector no está cargado
  // ahora mismo (nadie mirando) o esa posición no tenía nada instanciado.
  function ocultarPropBakeadoEnVivo(x: number, y: number) {
    if (!streaming || !indiceMapa) return;
    const tilesPorSector = indiceMapa.tamanoSectorChunks * indiceMapa.tamanoChunk;
    const sx = Math.floor(x / tilesPorSector);
    const sy = Math.floor(y / tilesPorSector);
    streaming.obtenerHandle(sx, sy)?.ocultarPosicion(Math.floor(x), Math.floor(y));
  }
  // Recolectables (docs/GDD_Inventario.md §7 — el servidor YA emitía esto,
  // nadie lo escuchaba todavía): bayas/setas/arbustos cogidos por CUALQUIER
  // jugador, no solo el que los cogió (broadcast).
  room.onMessage("mundo:objetoQuitado", (m: { origen?: string; x: number; y: number }) => {
    if (m?.origen === "exterior") ocultarPropBakeadoEnVivo(m.x, m.y);
  });
  // Árboles de origen bake talados por CUALQUIER jugador (docs/GDD_Bosques.md §7).
  room.onMessage("arbol:baketalado", (m: { x: number; y: number }) => ocultarPropBakeadoEnVivo(m.x, m.y));

  // Mesas de minijuego (docs/GDD_Mesas_Minijuego.md) — mismo criterio "sin
  // UI de targeting" que el resto de esta sección: la tecla (F, reusada de
  // puertas/barcos) auto-apunta a la silla libre alcanzable más cercana.
  const RADIO_MESA_AJEDREZ_CLIENTE = 2.2; // debe coincidir con RADIO_INTERACCION del servidor

  /** construccionId de la mesa de ajedrez en la que este jugador está sentado (blancas o negras), o null. */
  function miMesaAjedrezActual(): number | null {
    const mesas = (room.state as any).mesasAjedrez;
    if (!mesas) return null;
    for (const [id, m] of mesas.entries()) {
      if ((m as any).sillaBlancas === room.sessionId || (m as any).sillaNegras === room.sessionId) return Number(id);
    }
    return null;
  }

  /**
   * Mesa de ajedrez + silla concreta alcanzable desde (px,py): primero
   * busca la mesa_ajedrez más cercana con un radio ANCHO (la huella 3x2
   * hace que el CENTRO de la mesa pueda quedar más lejos que
   * RADIO_INTERACCION aunque una silla del borde sí esté al alcance), y
   * dentro de esa mesa exige que la silla LIBRE concreta esté de verdad
   * dentro de RADIO_INTERACCION real — mismo espejo local de siempre, la
   * verdad la dicta el servidor con "mesa:error" si discrepa.
   */
  function asientoAjedrezAlcanzable(px: number, py: number): { construccionId: number; silla: SillaMesaJuego } | null {
    if (!renderConstrucciones) return null;
    const id = renderConstrucciones.deObjetoMasCercana("mesa_ajedrez", px, py, RADIO_MESA_AJEDREZ_CLIENTE + 2);
    if (id == null) return null;
    const datos = renderConstrucciones.datosDe(id);
    const mesa = (room.state as any).mesasAjedrez?.get(String(id));
    if (!datos) return null;
    for (const silla of ["blancas", "negras"] as const) {
      const ocupante = mesa ? (silla === "blancas" ? mesa.sillaBlancas : mesa.sillaNegras) : "";
      if (ocupante) continue;
      const pos = posicionSillaMesaJuego("mesa_ajedrez", datos, silla);
      if (pos && Math.hypot(pos.x - px, pos.y - py) <= RADIO_MESA_AJEDREZ_CLIENTE) return { construccionId: id, silla };
    }
    return null;
  }

  const RADIO_ASIENTO_CLIENTE = 2.2; // debe coincidir con RADIO_INTERACCION del servidor

  /** ¿Estoy sentado en un asiento genérico (silla/banco/...) ahora mismo? Espejo de `jugadorLocal.sentado` — la construcción concreta la sabe el servidor, aquí solo hace falta el sí/no para decidir qué hace F. */
  function enAsientoGenerico(): boolean {
    return !!jugadorLocal && !!(room.state.players.get(room.sessionId) as any)?.sentado;
  }

  /** Asiento genérico alcanzable desde (px,py) — mismo criterio "sin UI de targeting" que `asientoAjedrezAlcanzable`, pero de una sola plaza y sin geometría de rotación (el punto de la construcción YA es el asiento). */
  function asientoGenericoAlcanzable(px: number, py: number): number | null {
    return renderConstrucciones?.asientoMasCercano(px, py, RADIO_ASIENTO_CLIENTE) ?? null;
  }

  function cadaverMasCercano(): string | null {
    if (!jugadorLocal) return null;
    let mejorId: string | null = null;
    let mejorDist = RADIO_COMBATE_CLIENTE;
    for (const [id, c] of room.state.cadaveres.entries()) {
      const d = Math.hypot((c as any).x - jugadorLocal.x, (c as any).y - jugadorLocal.z);
      if (d < mejorDist) { mejorDist = d; mejorId = id; }
    }
    return mejorId;
  }

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
    // NPCs hostiles (patrulla bandida, y el dummy de combate de la Test
    // Zone, docs/GDD_TestZone.md pedido 2026-08-31) — el servidor ya
    // soportaba "npc" como combatiente, pero nunca se proponían aquí.
    for (const [id, n] of room.state.npcs.entries()) {
      if (!n.hostil) continue;
      const d = Math.hypot(n.x - jugadorLocal.x, n.y - jugadorLocal.z);
      if (d < mejorDist) { mejorDist = d; mejorId = id; }
    }
    // PvP (docs/GDD_PvP.md, pedido 2026-08-30): el cliente propone el jugador
    // más cercano como cualquier otro objetivo — el servidor es quien decide
    // si el PvP está habilitado en esta zona (rechaza con combate:error si no).
    for (const [id, p] of room.state.players.entries()) {
      if (id === room.sessionId) continue;
      const d = Math.hypot(p.x - jugadorLocal.x, p.y - jugadorLocal.z);
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
    // Mapa de mundo (docs/GDD_Mapa_Mundo.md, pedido 2026-08-31): "la M es mapa".
    if (k === "m" && !teclas.has("m")) panelMapaMundo?.alternar();
    // Colocador de plantillas del jarl (docs/GDD_Produccion.md, pedido
    // 2026-08-31): Z entra/sale, gateado a jarl de este mapa o superadmin
    // (mismo criterio de visibilidad que PanelJarl) — el resto de letras
    // "naturales" (P, B, M...) ya están tomadas por otros sistemas.
    if (k === "z" && !teclas.has("z") && (identidadAdminActual?.esJarlAqui || identidadAdminActual?.rol === "superadmin")) {
      colocadorPlantillas?.alternar();
    }
    // Jugador (docs/GDD_Equipo.md): I abre/cierra el panel de equipo/inventario
    if (k === "i" && !teclas.has("i")) {
      panelJugador.alternar();
      if (panelJugador.estaVisible()) panelJugador.actualizar(room.state.players.get(room.sessionId));
    }
    // Panel "todo lo que tienes" (docs/GDD_Resumen_Jugador.md, pedido
    // 2026-08-31): Tab — última tecla libre, las 26 letras ya estaban
    // todas tomadas; preventDefault evita que el navegador robe el foco.
    if (k === "tab" && !teclas.has("tab")) {
      e.preventDefault();
      panelResumen.alternar();
    }
    // puertas (docs/GDD_Sistema_Puertas.md): F cerca de una la cruza.
    // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): MISMA tecla cruza un
    // borde mar_abierto pilotando un barco — mismo criterio "sin UI de
    // targeting", el servidor decide si aplica (no-op si no estás en el borde).
    if (k === "f" && !teclas.has("f")) {
      room.send("portal:usar");
      room.send("mapa:viajarVecino");
      // Mesas de minijuego (docs/GDD_Mesas_Minijuego.md, pedido 2026-08-30):
      // MISMA tecla F, mismo criterio "manda sin UI de targeting, el
      // servidor decide" que puertas/barcos de arriba — toggle sentarse/
      // levantarse según si ya estás sentado en alguna mesa de ajedrez.
      if (jugadorLocal) {
        const miMesa = miMesaAjedrezActual();
        if (miMesa != null) {
          room.send("mesa:levantarse");
        } else if (enAsientoGenerico()) {
          // Asiento genérico (docs/GDD_Personaje.md §3.6bis, pedido
          // 2026-08-31): mismo toggle que la mesa de ajedrez, pero para
          // cualquier silla/banco/taburete/mecedora/sofa/trono del catálogo
          // (`esAsiento:true`) — no solo la mesa jugable.
          room.send("asiento:levantarse");
        } else {
          const asiento = asientoAjedrezAlcanzable(jugadorLocal.x, jugadorLocal.z);
          if (asiento) {
            room.send("mesa:sentarse", { construccionId: asiento.construccionId, silla: asiento.silla });
          } else {
            const idAsiento = asientoGenericoAlcanzable(jugadorLocal.x, jugadorLocal.z);
            if (idAsiento != null) room.send("asiento:sentarse", { construccionId: idAsiento });
          }
        }
      }
    }
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
    // Minijuego de forja (docs/GDD_Crafteo.md §Minijuego de Herrería):
    // ESPACIO golpea mientras el panel está en fase FORJAR — mismo criterio
    // "tecla de acción sin targeting" que el resto de este bloque.
    if (k === " " && !teclas.has(" ") && forjaFaseActual === "FORJAR") {
      e.preventDefault();
      room.send("crafteo:herreria:accion", { accion: "golpear" });
    }
    // Movimiento EN COMBATE (docs/GDD_Combate.md §9.3, pedido streamer: "el
    // movimiento cambia al del mundo en general [...] esto es solo en
    // combate, en el grid de combate [...] fuera de combate no") — MISMAS
    // teclas WASD/flechas que el mundo abierto, pero el resultado es un
    // paso DISCRETO en el grid táctico (combate:mover, PA real, validado
    // por el servidor) en vez del movimiento libre continuo de bucle() de
    // más abajo (que se salta entero mientras SALA==="arena", ver ahí). Solo
    // manda algo si de verdad es tu turno — fuera de eso, no-op silencioso,
    // igual que cualquier otra tecla de acción sin condición cumplida.
    if (SALA === "arena" && !teclas.has(k)) {
      const dir =
        k === "w" || k === "arrowup" ? { dx: 0, dy: -1 } :
        k === "s" || k === "arrowdown" ? { dx: 0, dy: 1 } :
        k === "a" || k === "arrowleft" ? { dx: -1, dy: 0 } :
        k === "d" || k === "arrowright" ? { dx: 1, dy: 0 } :
        null;
      if (dir) {
        const combate = (room.state as any).combates.get(COMBATE_ID);
        const miUnidad = combate?.unidades.get(room.sessionId);
        if (combate && miUnidad && combate.ordenTurnos[combate.turnoActual] === room.sessionId) {
          room.send("combate:mover", { combateId: COMBATE_ID, gx: miUnidad.gx + dir.dx, gy: miUnidad.gy + dir.dy });
        }
      }
    }
    // Cadáveres/caza (docs/GDD_Caza.md, rediseño 2026-08-30 octava pasada):
    // L lootea el cadáver del MUNDO más cercano (da el ítem "cadáver
    // entero"). K desuella / O despieza el cadáver que el jugador lleva
    // ENCIMA — sin UI de targeting: si ya hay un procesado en curso, la
    // misma tecla lo recolecta (si está listo); si no, arranca uno nuevo con
    // el primer cadáver del inventario.
    if (k === "l" && !teclas.has("l")) {
      const cadaverId = cadaverMasCercano();
      if (cadaverId) room.send("cadaver:lootear", { cadaverId });
    }
    if ((k === "k" || k === "o") && !teclas.has(k)) {
      if (procesandoCadaver) room.send("cadaver:procesarRecolectar");
      else {
        const instanciaId = cadaverEnInventario();
        if (instanciaId != null) {
          room.send("cadaver:procesarIniciar", { instanciaId, verbo: k === "k" ? "desollar" : "despiezar" });
          procesandoCadaver = true;
        }
      }
    }
    // Bosques (docs/GDD_Bosques.md): H tala el árbol más cercano (Hacha) —
    // sin targeting, el servidor busca el más cercano él mismo.
    if (k === "h" && !teclas.has("h")) room.send("arbol:talar");
    // Mascotas (docs/GDD_Mascotas.md): G da de comer al animal domesticable
    // más cercano (perro/gato urbano) — sin UI de targeting, el servidor
    // decide si hay algo cerca y si se puede (no-op fuera de una región con
    // fauna urbana). Cinco veces lo convierte en mascota.
    if (k === "g" && !teclas.has("g")) room.send("mascota:darComida");
    // Comercio (docs/GDD_Comercio.md): T propone comerciar con el jugador
    // más cercano — mutuo, el servidor solo abre el trato si el otro
    // también la pulsó apuntándote a ti (ver panelComercio.ts).
    if (k === "t" && !teclas.has("t")) room.send("comercio:solicitar");
    // Pesca (docs/GDD_Pesca.md): U "usa" la caña — lanza si no se está
    // pescando ya, reacciona a la picada si la boya se está agitando (el
    // servidor decide si el estado encaja; en cualquier otro momento no-op).
    if (k === "u" && !teclas.has("u")) {
      if (estadoPesca === "picando") room.send("pesca:interactuar");
      else if (estadoPesca === null) room.send("pesca:lanzar");
    }
    // Monturas (docs/GDD_Monturas.md, pedido 2026-08-30): N pone la silla a
    // la mascota propia más cercana ("siguiendo", ya domesticada, especie
    // montable) — mismo criterio sin targeting que el resto. X monta/
    // desmonta (toggle según `Player.monturaEspecieId`, ANTES en 'm' —
    // liberada para el mapa de mundo, docs/GDD_Mapa_Mundo.md pedido
    // 2026-08-31: "la M es mapa"); sin mascotaId, el servidor auto-apunta
    // a la más cercana con silla puesta. Espacio: salta en la dirección en
    // la que se mueve/mira — solo hace algo si está montado (el servidor
    // lo ignora si no).
    if (k === "n" && !teclas.has("n")) room.send("mascota:ponerMontura", {});
    if (k === "x" && !teclas.has("x")) {
      const yo = room.state.players.get(room.sessionId);
      if (yo?.monturaEspecieId) room.send("mascota:desmontar");
      else room.send("mascota:montar", {});
    }
    if (k === " " && !teclas.has(" ")) {
      const dir = ultimaDireccionEnviada.x || ultimaDireccionEnviada.y ? ultimaDireccionEnviada : ultimaDireccionMirada;
      if (dir.x || dir.y) room.send("montura:saltar", { dx: dir.x, dy: dir.y });
    }
    // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): J coloca un barco del
    // inventario junto al agua más cercana; P sube/baja (toggle según
    // Player.barcoId) — tecla propia, distinta de M/monturas, para no
    // ambigüar cuál de las dos "monturas" (animal o barco) se pretende
    // cuando hay ambas cerca a la vez.
    if (k === "j" && !teclas.has("j")) room.send("barco:colocar", {});
    if (k === "p" && !teclas.has("p")) {
      const yo = room.state.players.get(room.sessionId);
      if (yo?.barcoId) room.send("barco:desmontar");
      else room.send("barco:montar", {});
    }
    // Cofres de mundo de la Test Zone (pedido 2026-08-31): Y abre/pide
    // estado del cofre de prueba fijo — sin UI de targeting todavía.
    if (k === "y" && !teclas.has("y")) room.send("contenedorTest:abrir", { id: ID_COFRE_TEST_PRUEBA });
    // Panel de debug jarl/superadmin de la Test Zone: F9 alterna visibilidad
    // (siempre se crea si hay sesión de admin confirmada, pero puede estorbar
    // en pantalla mientras se juega — igual que I con el inventario).
    if (k === "f9" && !teclas.has("f9")) panelDebugTestZone?.alternar();
    teclas.add(k);
  });
  window.addEventListener("keyup", (e) => teclas.delete(e.key.toLowerCase()));

  let ultimaDireccionEnviada: Direction = { x: 0, y: 0 };
  // Última dirección NO nula (docs/GDD_Monturas.md) — para saltar hacia
  // dónde se estaba mirando aunque en el instante de pulsar Espacio ya se
  // haya soltado la tecla de movimiento.
  let ultimaDireccionMirada: Direction = { x: 0, y: 1 };
  let tAnterior = performance.now();

  function bucle(tAhora: number) {
    const dt = Math.min((tAhora - tAnterior) / 1000, 0.1); // techo: una pestaña en segundo plano no da un salto gigante al volver
    tAnterior = tAhora;

    const x =
      (teclas.has("d") || teclas.has("arrowright") ? 1 : 0) - (teclas.has("a") || teclas.has("arrowleft") ? 1 : 0);
    const y = (teclas.has("s") || teclas.has("arrowdown") ? 1 : 0) - (teclas.has("w") || teclas.has("arrowup") ? 1 : 0);
    const correr = teclas.has("shift");
    if (x || y) ultimaDireccionMirada = { x, y };

    // En una arena el movimiento es EN COMBATE (tecla a tecla, gastando PA
    // real vía combate:mover, cableado en el keydown de más abajo) — el
    // "input" de movimiento libre continuo del mundo abierto no aplica aquí
    // (el servidor ya lo ignora en combate activo, pero ni falta que hace
    // mandarlo). Fuera de una arena, exactamente el mismo comportamiento de
    // siempre.
    if (
      SALA !== "arena" &&
      (x !== ultimaDireccionEnviada.x ||
        y !== ultimaDireccionEnviada.y ||
        correr !== !!ultimaDireccionEnviada.correr)
    ) {
      ultimaDireccionEnviada = { x, y, correr };
      room.send("input", ultimaDireccionEnviada);
    }

    // Interpolación + animación: cada rig persigue su destino de servidor;
    // si se está moviendo de verdad, anima la zancada y encara la dirección.
    const factor = 1 - Math.exp(-12 * dt);
    // Jugadores y NPCs comparten interpolación y animación de marcha: un
    // NPC es "otro que se mueve por patches del servidor", nada más.
    for (const estado of [...jugadores.values(), ...npcsVisual.values(), ...faunaVisual.values(), ...mascotasVisual.values(), ...companerosVisual.values()]) {
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
      // nadando el cuerpo se tumba hacia delante (boca abajo, estilo crol);
      // tumbado en cama, más plano todavía (boca arriba, mismo signo);
      // en tierra vuelve a vertical. Signo invertido (pedido 2026-08-31,
      // "la animacion de nadar esta mal, nada de espaldas mirando al
      // cielo"): con -1.1 el personaje quedaba boca arriba en vez de boca
      // abajo — la inclinación va en el sentido contrario al de este rig.
      const inclinacionObjetivo = estado.nadando ? 1.1 : estado.durmiendo ? 1.5 : 0;
      estado.rig.objeto.rotation.x += (inclinacionObjetivo - estado.rig.objeto.rotation.x) * factor;
      estado.rig.actualizar(dt, marcha, estado.tocandoInstrumento, estado.sentado, estado.sentadoSuelo, estado.durmiendo);
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

    // Enfermedades (docs/GDD_Enfermedades.md, pedido 2026-08-30): burbuja
    // periódica de síntoma sobre CUALQUIER jugador visible (local o remoto)
    // reusando la misma etiqueta de nombre que ya tienen — mismo criterio de
    // desfase por entidad que el pregón de NPCs, para que no coincidan todos
    // a la vez. Solo el síntoma (avisar de que estás enfermo aparte de esto
    // queda para más adelante, pedido explícito del streamer).
    for (const [sessionId, estadoJ] of jugadores) {
      const nombreJ = estadoJ.name ?? "";
      if (!estadoJ.catarro && !estadoJ.gripe) {
        escena.textoEtiqueta(sessionId, nombreJ, false);
        continue;
      }
      const fase = (tSeg + sessionId.length * 1.7) % 10;
      const sintoma = estadoJ.catarro ? "Cough cough..." : "*tiritando*";
      escena.textoEtiqueta(sessionId, fase < 3 ? sintoma : nombreJ, fase < 3);
    }

    // Compañero (docs/GDD_Companeros.md): burbuja de queja por hambre — el
    // servidor ya manda el texto listo en quejaTexto (nunca genera aquí uno
    // propio), solo se alterna con el nombre igual que el resto de burbujas.
    // Itera el mapa LOCAL (companerosVisual, ya espejado vía onAdd/onChange)
    // en vez de `room.state.companeros` directamente — mismo criterio que
    // el resto de bucle() (jugadores/npcsVisual/faunaVisual/...): un Map
    // local siempre existe (vacío hasta el primer patch), evita la ventana
    // de carrera de justo tras unirse a la room en que NINGÚN campo de
    // `room.state` está poblado todavía (confirmado: afecta a TODOS los
    // Maps del estado por igual, no solo a compañeros — ver GDD_Companeros §8).
    for (const [id, estadoC] of companerosVisual) {
      const nombreC = estadoC.name ?? "";
      if (!estadoC.quejaTexto) { escena.textoEtiqueta(`companero_${id}`, nombreC, false); continue; }
      const fase = (tSeg + id.length * 1.7) % 10;
      escena.textoEtiqueta(`companero_${id}`, fase < 3 ? estadoC.quejaTexto : nombreC, fase < 3);
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
