import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION, PA_MAX_COMBATE } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { cargarParcelas } from "../construccion/parcelas";
import { GestorConversacionesNpc } from "../ia/npcChat";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { cargarCatalogoFaunaSalvaje } from "../mundo/catalogoFaunaSalvaje";
import { DependenciasFaunaSalvaje, GestorFaunaSalvaje } from "../mundo/faunaSalvajeViva";
import { ObjetoFaunaBakeado } from "../mundo/faunaSalvajeSector";
import { cadaverDesaparecio } from "../mundo/cadaveres";
import { diaFraccional } from "../mundo/reproduccionFauna";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { DependenciasBosques, GestorBosques } from "../mundo/bosquesVivos";
import { ObjetoArbolBakeado } from "../mundo/bosqueSector";
import { EspecieArbol } from "../mundo/crecimientoBosques";
import { quitarItem, excedePesoMaximo } from "../inventario/inventario";
import { Anatomia, anatomiaInicial } from "../personaje/anatomia";
import { EstadoEnfermedades, enfermedadesInicial } from "../personaje/enfermedades";
import { intentarCoger } from "../inventario/cogerSoltar";
import { sincronizarContenedor } from "../inventario/sincronizarSchema";
import { pesoMaximoTransportable } from "../personaje/bonusAtributos";
import { cargarCatalogoCombateFauna, CatalogoCombateFauna } from "../mundo/catalogoCombateFauna";
import { cargarCatalogoItems } from "../inventario/inventario";
import { aplicarDanio, calcularDanio, estaMuerto } from "../combate/combate";
import { UnidadCombate, calcularIniciativa, simularCombateAutomatico } from "../combate/arenaCombate";
import { TIPO, tipoEn, medioEn, casillaAguaCercana } from "../mundo/colisiones";
import { cooldownNpcHablarMs } from "../personaje/bonusAtributos";
import { cargarNpcsFijos, cargarNpcsTutorialesDeMapa, cargarCatalogoNpcsTutoriales, cargarLoreTexto } from "../mundo/npcsFijos";

// Lee un `sector_XXX_YYY.json` bakeado y devuelve solo sus objetos de
// fauna (t==="a") con coordenadas GLOBALAS de casilla — mismo formato de
// nombre de archivo que usa `mundo/mapaColision.ts`. `[]` si el sector no
// existe (fuera del mapa, o hueco sin bakear).
function leerObjetosFaunaDeSector(rutaMapa: string, tamanoChunk: number, sectorX: number, sectorY: number): ObjetoFaunaBakeado[] {
  const pad3 = (n: number) => String(n).padStart(3, "0");
  const ruta = path.join(rutaMapa, `sector_${pad3(sectorX)}_${pad3(sectorY)}.json`);
  if (!fs.existsSync(ruta)) return [];
  const sector = JSON.parse(fs.readFileSync(ruta, "utf8")) as {
    chunks: Record<string, { objetos: { i: string; t: string; x: number; y: number }[] }>;
  };
  const salida: ObjetoFaunaBakeado[] = [];
  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    const baseX = cx * tamanoChunk;
    const baseY = cy * tamanoChunk;
    for (const obj of chunk.objetos) {
      if (obj.t === "a") salida.push({ i: obj.i, x: baseX + obj.x, y: baseY + obj.y });
    }
  }
  return salida;
}

// Mismo formato que leerObjetosFaunaDeSector, pero para vegetación (t==="v")
// — crecimiento de bosques (docs/GDD_Bosques.md, pedido 2026-08-30). Se
// devuelven TODOS los objetos de vegetación tal cual (no solo árboles): es
// resolverSectorBosque quien filtra por especie-con-crecimiento, mismo
// criterio que la fauna (el lector no sabe de catálogos, solo lee bytes).
function leerObjetosVegetacionDeSector(rutaMapa: string, tamanoChunk: number, sectorX: number, sectorY: number): ObjetoArbolBakeado[] {
  const pad3 = (n: number) => String(n).padStart(3, "0");
  const ruta = path.join(rutaMapa, `sector_${pad3(sectorX)}_${pad3(sectorY)}.json`);
  if (!fs.existsSync(ruta)) return [];
  const sector = JSON.parse(fs.readFileSync(ruta, "utf8")) as {
    chunks: Record<string, { objetos: { i: string; t: string; x: number; y: number }[] }>;
  };
  const salida: ObjetoArbolBakeado[] = [];
  for (const [clave, chunk] of Object.entries(sector.chunks)) {
    const [cx, cy] = clave.split("_").map(Number);
    const baseX = cx * tamanoChunk;
    const baseY = cy * tamanoChunk;
    for (const obj of chunk.objetos) {
      if (obj.t === "v") salida.push({ i: obj.i, x: baseX + obj.x, y: baseY + obj.y });
    }
  }
  return salida;
}

// Catálogo de crecimiento (docs/GDD_Bosques.md): solo las especies de
// vegetacion.json que traen el campo `crecimiento` (árboles maderables) —
// el resto de vegetación (arbustos, flores, frutales sin colisión...) ni
// entra aquí, mismo criterio que cargarCatalogoCombateFauna filtrando por
// campos presentes. Devuelve TAMBIÉN especieId->categoriaRecurso (qué
// madera da cada especie al talarla, docs/GDD_Bosques.md) — mismo archivo,
// una sola lectura.
function cargarCatalogoCrecimientoArboles(rutaVegetacionJson: string): { crecimiento: Record<string, EspecieArbol>; madera: Record<string, string> } {
  const vegetacion = JSON.parse(fs.readFileSync(rutaVegetacionJson, "utf8")) as Record<string, { crecimiento?: EspecieArbol; categoriaRecurso?: string }>;
  const crecimiento: Record<string, EspecieArbol> = {};
  const madera: Record<string, string> = {};
  for (const [id, datos] of Object.entries(vegetacion)) {
    if (id.startsWith("_") || !datos?.crecimiento) continue;
    crecimiento[id] = datos.crecimiento;
    if (datos.categoriaRecurso) madera[id] = datos.categoriaRecurso;
  }
  return { crecimiento, madera };
}

// Talar (docs/GDD_Bosques.md) — mismo orden de magnitud que
// XP_FUERZA_POR_RECOLECTA_PESADA (RoomExteriorBase.ts), constante propia
// porque esa no está exportada.
const XP_FUERZA_TALAR = 2;

// El hub juega sobre el MAPA PRINCIPAL (assets/mapas/principal/) — mismo
// mapa que el cliente carga por streaming. Si no está en disco (repo
// parcial, entorno raro), se cae al demo para no tumbar el servidor; los
// tests unitarios siguen usando el demo a propósito (pequeño y rápido).
export function rutaMapaHub(): string | undefined {
  if (process.env.RUTA_MAPA) return process.env.RUTA_MAPA;
  const principal = path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "principal");
  return fs.existsSync(path.join(principal, "indice.json")) ? principal : undefined;
}

// Habitacion del Hub central: aqui viven todos los avatares del pueblo.
// Optimizada para plan gratuito: la simulacion corre a 30hz (barata en CPU),
// pero el estado solo se manda al cliente 15 veces/seg (patchRate) para
// ahorrar ancho de banda, y el input solo se recibe cuando cambia de
// direccion en vez de en cada frame.
//
// La simulación es AUTORITATIVA contra el mapa bakeado (mundo/mapaColision):
// sólidos con caja simple por casilla, agua como medio (nadar/bucear) y
// empuje suave entre PJ. Las reglas viven en docs/GDD_Mecanicas.md.
export class HubRoom extends RoomExteriorBase {
  private mapa!: MapaCargado;
  // Fauna salvaje en vivo (docs/GDD_Agentes_Moviles.md) — undefined si el
  // mapa no tiene sectores bakeados de verdad o si algo falló al iniciar
  // (ver el try/catch de onCreate). `matarIndividuo` es el punto de
  // enganche para un futuro sistema de combate.
  private gestorFaunaSalvaje?: GestorFaunaSalvaje;
  // Crecimiento de bosques (docs/GDD_Bosques.md) — mismo criterio de
  // opcionalidad y try/catch propio que la fauna salvaje.
  private gestorBosques?: GestorBosques;
  // especieId -> categoriaRecurso (qué madera da cada especie al talarla) — usado por manejarArbolTalar.
  private especieAMadera: Record<string, string> = {};
  // Guardado aparte (además de dentro de deps.catalogoCombate) para que lo
  // use también la autosimulación NPC-vs-fauna (docs/GDD_Combate.md §7).
  private catalogoCombate?: CatalogoCombateFauna;
  private conversacionesNpc = new GestorConversacionesNpc();
  private ultimoMensajeNpc = new Map<string, number>();

  // Colyseus espera (y awaitea) el lifecycle de creación de la room: async
  // aquí es lo correcto, no un apaño — la matchmaker no da la room por lista
  // hasta que esta promesa resuelve, así que abrir la BD (posible red real
  // contra Neon) antes de aceptar jugadores es seguro.
  /**
   * `options.mapaId` (docs/GDD_Barcos.md, pedido 2026-08-30 "Barcos y
   * navegación marítima"): SOLO lo manda el join a "hub_mapa" (server/src/
   * index.ts) al cruzar un borde `mar_abierto` en barco — el "hub" de
   * siempre se sigue uniendo SIN options, exactamente como antes de esta
   * pasada (rutaMapaHub() decide, cero cambio de comportamiento).
   */
  async onCreate(options?: { mapaId?: string }) {
    const rutaMapa = options?.mapaId
      ? path.resolve(__dirname, "..", "..", "..", "assets", "mapas", options.mapaId)
      : rutaMapaHub() ?? path.resolve(__dirname, "..", "..", "..", "assets", "mapas", "demo");
    this.mapa = cargarMapaColision(rutaMapa);
    this.mundo = this.mapa;
    this.mapaExterior = this.mapa; // habilita "coger" de recolectables del bake (fase 2 de inventario)
    this.esZonaSeguraPropia = true; // PvP (docs/GDD_PvP.md): el Hub es el pueblo donde vive todo el mundo, siempre a salvo
    this.mapaIdPropio = path.basename(rutaMapa);
    this.bordesMapa = this.mapa.bordes;
    this.tilesPorSectorExploracion = this.mapa.tilesPorSector; // niebla de guerra (docs/GDD_Mapa_Mundo.md)
    console.log(
      `Hub con mapa "${this.mapa.nombre}" (${this.mapa.ancho}x${this.mapa.alto} casillas), ` +
      `spawn en ${this.mapa.spawnX.toFixed(1)},${this.mapa.spawnY.toFixed(1)}`,
    );
    this.iniciarMovimiento();

    // Parcelas pintadas a mano (parcelas/gui/servidor.js) sobre el mapa
    // principal — construcción-en-regiones (ciudad capital) usa la MISMA
    // lógica compartida (RoomExteriorBase.iniciarConstruccion) pero con
    // parcelas rasterizadas del bake, ver RegionRoom.ts.
    await this.iniciarConstruccion(cargarParcelas(rutaMapa, this.mapa.ancho), path.basename(rutaMapa));

    // NPCs FIJOS (docs/GDD_Profesiones.md ronda 2/3, pedido 2026-08-30): el
    // Hub es LA CAPITAL — donde tiene más sentido un NPC plantado a mano por
    // el admin (el "maestro de oficios", los tutoriales...). A diferencia de
    // RegionRoom, el Hub hoy no carga `poblacion.json` (sin NPCs con
    // rutina) — esto SOLO añade los de `npcsFijos.json` (mapa, hecho a
    // mano) + los tutoriales que un admin ya colocó en vivo (BD, ronda 3);
    // sin ninguno de los dos, sin cambio de comportamiento.
    {
      const npcsFijos = cargarNpcsFijos(rutaMapa);
      const npcsTutoriales = await cargarNpcsTutorialesDeMapa(await obtenerBdCompartida(), this.mapaIdPropio);
      const todosLosFijos = [...npcsFijos, ...npcsTutoriales];
      if (todosLosFijos.length > 0) {
        const gestor = this.obtenerOCrearGestorAgentes();
        gestor.iniciar(todosLosFijos, tiempoMundo().hora);
        for (const npc of todosLosFijos) {
          if (npc.oficio) this.oficiosNpc.set(npc.slotId, npc.oficio);
        }
        console.log(`  ${gestor.cantidad} NPC(s) fijo(s) en el mapa (${npcsTutoriales.length} tutorial(es))`);
      }
      // NPCs trabajadores contratados (docs/GDD_NPCs_Contratables.md, pedido
      // 2026-09-01) — persistidos por dueño, sobreviven un reinicio del
      // servidor igual que los tutoriales de arriba.
      const trabajadores = await (await obtenerBdCompartida()).listarNpcsTrabajadoresDeMapa(this.mapaIdPropio);
      for (const fila of trabajadores) this.registrarTrabajadorEnMemoria(fila);
      if (trabajadores.length > 0) console.log(`  ${trabajadores.length} NPC(s) trabajador(es) contratado(s) en el mapa`);
    }

    // Barcos (docs/GDD_Barcos.md, pedido 2026-08-30): los que ya estaban
    // anclados en ESTE mapa (colocados en una sesión anterior, o que
    // acaban de cruzar aquí desde un mapa vecino) reaparecen tal cual.
    // Fuera de agua no debería pasar nunca en un mapa normal (se colocan
    // sobre agua y solo se mueven por agua) salvo el caso límite de llegar
    // por primera vez a un mapa vecino con coordenadas del mapa de origen
    // (que casi seguro no encajan en esta rejilla) — se reancla al agua
    // más cercana al spawn en vez de dejarlo varado en tierra o fuera del mapa.
    try {
      const bdBarcos = await obtenerBdCompartida();
      for (const fila of await bdBarcos.listarBarcosDe(this.mapaIdPropio)) {
        const medio = medioEn(this.mapa, fila.x, fila.y);
        if (medio !== TIPO.AGUA && medio !== TIPO.AGUA_PROFUNDA) {
          const agua = casillaAguaCercana(this.mapa, this.mapa.spawnX, this.mapa.spawnY, 40);
          if (agua) { fila.x = agua.x; fila.y = agua.y; }
        }
        this.spawnearBarco(fila);
      }
    } catch (e) {
      console.warn("[barcos] no se pudieron cargar los barcos anclados de este mapa:", e);
    }

    // Fauna salvaje EN VIVO (docs/GDD_Agentes_Moviles.md, pedido
    // 2026-08-30): activa/desactiva sectores según se acercan o alejan
    // jugadores — el resto del mapa (miles de sectores) no cuesta nada
    // mientras nadie esté cerca. Reusa el mismo algoritmo de merodeo que
    // la fauna doméstica (mundo/fauna.ts). Envuelto entero en try/catch:
    // esto es una capa nueva sobre un Hub que ya funcionaba — si algo
    // falla (mapa sin indice.json completo, BD no disponible...) se
    // registra y la partida sigue exactamente igual que antes, sin fauna
    // salvaje viva, en vez de tumbar la room para todos los jugadores.
    try {
      const indice = JSON.parse(fs.readFileSync(path.join(rutaMapa, "indice.json"), "utf8")) as {
        tamanoChunk: number;
        tamanoSectorChunks: number;
      };
      if (indice.tamanoSectorChunks) {
        const bd = await obtenerBdCompartida();
        const catalogo = cargarCatalogoFaunaSalvaje(
          path.resolve(__dirname, "..", "..", "..", "baker", "catalogo", "animales.json"),
        );
        const mapaId = path.basename(rutaMapa);
        this.catalogoCombate = cargarCatalogoCombateFauna(
          path.resolve(__dirname, "..", "..", "..", "baker", "catalogo", "animales.json"),
        );
        const deps: DependenciasFaunaSalvaje = {
          mapaId,
          catalogo,
          mundo: this.mapa,
          ahora: () => {
            const t = tiempoMundo();
            return diaFraccional(t.dia, t.hora);
          },
          cargarBakeSector: (s) => leerObjetosFaunaDeSector(rutaMapa, indice.tamanoChunk, s.sectorX, s.sectorY),
          cargarPersistido: async (s) => ({
            filas: await bd.listarFaunaSector(mapaId, s.sectorX, s.sectorY),
            huevos: await bd.listarHuevosSector(mapaId, s.sectorX, s.sectorY),
            ultimaResolucion: await bd.obtenerUltimaResolucionSector(mapaId, s.sectorX, s.sectorY),
          }),
          guardarIndividuo: (f) => bd.guardarFaunaIndividuo(f),
          guardarHuevo: (h) => bd.guardarHuevo(h),
          marcarSectorResuelto: (s, momento) => bd.marcarSectorResuelto(mapaId, s.sectorX, s.sectorY, momento),
          crearCadaver: (c) => bd.crearCadaverBd(c),
          catalogoCombate: this.catalogoCombate,
          catalogoItems: cargarCatalogoItems(),
        };
        // Guardado como campo (no variable local): `onFaunaMuerta` (docs/
        // GDD_Combate.md) llama a matarIndividuo() al cerrar un combate real.
        this.gestorFaunaSalvaje = new GestorFaunaSalvaje(this.state.fauna, deps);

        // Cadáveres de sesiones anteriores que todavía no han expirado
        // (docs/GDD_Caza.md) — sin esto, un reinicio del servidor los deja
        // persistidos en BD pero invisibles hasta el próximo `matarIndividuo`.
        const ahoraCadaveres = () => {
          const t = tiempoMundo();
          return diaFraccional(t.dia, t.hora);
        };
        for (const fila of await bd.listarCadaveresMapa(mapaId)) {
          if (cadaverDesaparecio(fila, ahoraCadaveres())) {
            void bd.borrarCadaver(fila.id);
            continue;
          }
          this.publicarCadaver(fila);
        }
        this.clock.setInterval(
          () => void this.limpiarCadaveresExpirados(ahoraCadaveres()),
          60_000,
        );
        // Merodeo a 5hz (igual que la fauna doméstica); activar/desactivar
        // sectores es mucho más caro (E/S a BD) así que va aparte y más
        // despacio — de sobra para notar que un jugador cambió de sector.
        this.clock.setInterval(() => this.gestorFaunaSalvaje!.tick(0.2), 200);
        // Agro por distancia (docs/GDD_Combate.md §7bis, pedido 2026-08-30) —
        // MISMO intervalo que el merodeo, cubre tanto depredadores de tierra
        // como orca/tiburón (agua): un jugador dentro del radioAgro de
        // cualquier fauna `peligroso` entra en combate solo.
        this.clock.setInterval(() => this.verificarAgroFauna(), 200);
        this.clock.setInterval(() => {
          const posiciones = [...this.state.players.values()].map((p) => ({ x: p.x, y: p.y }));
          this.gestorFaunaSalvaje!
            .actualizarPorJugadores(posiciones, indice.tamanoChunk, indice.tamanoSectorChunks, 1)
            .catch((err) => console.error("Fauna salvaje: fallo actualizando sectores activos:", err));
          // Bosques (docs/GDD_Bosques.md): MISMO intervalo de 8s que la
          // fauna salvaje, sin uno nuevo — reusa las mismas posiciones ya
          // calculadas arriba.
          this.gestorBosques
            ?.actualizarPorJugadores(posiciones, 1)
            .catch((err) => console.error("Bosques: fallo actualizando sectores activos:", err));
        }, 8000);
        // Autosimulación de encuentros NPC-vs-fauna peligrosa (docs/GDD_Combate.md
        // §7, confirmado 2026-08-30: "en combates de NPC contra animales... se
        // autosimule"). Baja frecuencia — es un rastreo O(npcs*fauna_activa),
        // barato porque solo hay fauna activa cerca de jugadores (mismo criterio
        // de "cálculo perezoso" que el resto del proyecto).
        this.clock.setInterval(
          () => this.comprobarEncuentrosAutomaticos().catch((err) => console.error("Autosimulación NPC-vs-fauna: fallo:", err)),
          5000,
        );
        console.log("  Fauna salvaje en vivo activada (sectores bajo demanda)");

        // Crecimiento de bosques EN VIVO (docs/GDD_Bosques.md, pedido
        // 2026-08-30) — mismo patrón sector-activado que la fauna salvaje,
        // pero sin tick propio (los árboles no se mueven). Try/catch propio:
        // si algo falla aquí (catálogo raro, indice sin datos) el Hub sigue
        // exactamente igual, con fauna viva pero sin bosques creciendo, en
        // vez de tumbar la fauna que sí acaba de arrancar bien.
        try {
          const { crecimiento: catalogoArboles, madera: especieAMadera } = cargarCatalogoCrecimientoArboles(
            path.resolve(__dirname, "..", "..", "..", "baker", "catalogo", "vegetacion.json"),
          );
          this.especieAMadera = especieAMadera;
          const depsBosques: DependenciasBosques = {
            mapaId,
            catalogo: catalogoArboles,
            mundo: this.mapa,
            tamanoChunk: indice.tamanoChunk,
            tamanoSectorChunks: indice.tamanoSectorChunks,
            ahora: () => tiempoMundo().dia,
            cargarBakeSector: (s) => leerObjetosVegetacionDeSector(rutaMapa, indice.tamanoChunk, s.sectorX, s.sectorY),
            cargarPersistido: async (s) => ({
              bakeTalados: (await bd.listarArbolesVivosSector(mapaId, s.sectorX, s.sectorY)).filter((f) => f.origen === "bake"),
              crecidos: (await bd.listarArbolesVivosSector(mapaId, s.sectorX, s.sectorY)).filter((f) => f.origen !== "bake"),
            }),
            guardarArbolVivo: (a) => bd.guardarArbolVivo(a),
            marcarSectorResuelto: (s, momento) => bd.marcarSectorBosqueResuelto(mapaId, s.sectorX, s.sectorY, momento),
          };
          this.gestorBosques = new GestorBosques(this.state.arbolesVivos, depsBosques);
          console.log(`  Bosques en vivo activados (${Object.keys(catalogoArboles).length} especies con crecimiento)`);
        } catch (err) {
          console.error("Bosques: no se pudo iniciar, el Hub sigue sin crecimiento de árboles:", err);
        }
      }
    } catch (err) {
      console.error("Fauna salvaje: no se pudo iniciar, el Hub sigue sin ella:", err);
    }

    // Puertas del Hub (docs/GDD_Sistema_Puertas.md): al ser la raíz, sus
    // portales "exterior" DEBEN traer `destino` (a una región) — no hay
    // "volver" desde aquí. Los "interior" entran al edificio bakeado (si
    // el Hub llegara a tener alguno propio; hoy los del mapa principal no).
    this.onMessage("portal:usar", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const portal = this.mapa.portales.find(
        (p) => Math.hypot(p.x + 0.5 - player.x, p.y + 0.5 - player.y) < RADIO_INTERACCION,
      );
      if (!portal) return client.send("portal:error", { motivo: "no hay puerta cerca" });

      if (portal.tipo === "interior") {
        client.send("portal:ir", {
          tipo: "interior",
          mapaId: path.basename(rutaMapa),
          edificio: portal.edificio,
          tipoEdificioId: portal.tipoEdificioId,
          esMazmorra: portal.esMazmorra ?? false,
          x: portal.x,
          y: portal.y,
        });
      } else if (portal.destino) {
        client.send("portal:ir", { tipo: portal.destino.tipo, mapaId: portal.destino.mapaId });
      } else {
        client.send("portal:error", { motivo: "puerta sin destino configurado" });
      }
    });

    // Diálogo con NPCs (docs/GDD_IA_NPCs.md): respuesta va SOLO al que
    // preguntó (conversación privada), nunca en broadcast.
    this.onMessage("npc:hablar", async (client, msg: { npcId?: string; mensaje?: string }) => {
      const nombre = this.nombreDe(client);
      if (!nombre || !msg?.npcId || !msg?.mensaje) return;
      // rate-limit por jugador (GDD_Mecanicas §5.12, "rate-limit por
      // mensaje" pendiente): sin esto un cliente puede spamear el handler y
      // agotar la cuota gratuita de Gemini/Groq para todos los jugadores.
      // NPC tutorial/lore (docs/GDD_Profesiones.md ronda 3/4, pedido
      // 2026-08-30/31): "texto predefinido" — para tutoriales el texto EN
      // SÍ todavía no está escrito ("ahora no se hace ese texto", pedido
      // explícito), así que responde con un placeholder que nombra la
      // mecánica en vez de gastar cuota de Gemini/Groq en una IA que no
      // pinta nada aquí. Para lore (categoria:"lore"), el texto real vive
      // en poblacion/catalogo/loreTexto.json — "cuando termine el juego
      // haré el lore y se pondrá ahí", pedido literal: se lee EN CALIENTE
      // (sin caché) para que rellenar esa clave más adelante funcione sin
      // reiniciar el servidor; sin entrada todavía, mismo placeholder que un tutorial.
      const npcTutorial = this.state.npcs.get(msg.npcId);
      if (npcTutorial?.tipoTutorial) {
        const arquetipo = cargarCatalogoNpcsTutoriales().get(npcTutorial.tipoTutorial);
        const esLore = arquetipo?.categoria === "lore";
        const loreEscrito = esLore ? cargarLoreTexto()[npcTutorial.tipoTutorial] : undefined;
        client.send("npc:respuesta", {
          npcId: msg.npcId,
          texto: loreEscrito ?? `[${esLore ? "Lore" : "Tutorial"} pendiente de escribir: ${arquetipo?.mecanica ?? npcTutorial.tipoTutorial}]`,
        });
        return;
      }
      const ahora = Date.now();
      const anterior = this.ultimoMensajeNpc.get(client.sessionId) ?? 0;
      // Carisma (docs/GDD_Personaje.md §3.3): "más interacciones o
      // conversaciones" — más nivel de carisma acorta este cooldown, nunca
      // por debajo de 1000ms (la cuota de Gemini/Groq sigue mandando).
      const nivelCarisma = this.state.players.get(client.sessionId)?.atributos.carisma ?? 1;
      const COOLDOWN_MS = cooldownNpcHablarMs(nivelCarisma);
      if (ahora - anterior < COOLDOWN_MS) {
        client.send("npc:error", { npcId: msg.npcId, motivo: "espera un momento antes de volver a hablar" });
        return;
      }
      this.ultimoMensajeNpc.set(client.sessionId, ahora);
      try {
        const texto = await this.conversacionesNpc.hablar(msg.npcId, nombre, msg.mensaje.slice(0, 300));
        client.send("npc:respuesta", { npcId: msg.npcId, texto });
        // Carisma (docs/GDD_Personaje.md): hablar con un NPC ya está
        // limitado por el cooldown de arriba (3s), así que reusarlo también
        // acota la ganancia de XP sin necesidad de un límite propio.
        const player = this.state.players.get(client.sessionId);
        if (player) {
          const bd = await obtenerBdCompartida();
          const jugador = await bd.obtenerOCrearJugador(nombre);
          await this.otorgarXpAtributo(bd, jugador.id, "carisma", player, 5, client.sessionId);
        }
      } catch (err) {
        client.send("npc:error", { npcId: msg.npcId, motivo: (err as Error).message });
      }
    });


    // Combate (docs/GDD_Mecanicas.md §5.4, pedido 2026-08-30): un jugador
    // ataca a un animal salvaje activo o a otro jugador dentro de
    // RADIO_INTERACCION. Los animales NO tienen defensa (calcularDanio
    // recibe 0); un jugador SÍ, según su `defensa` de red (Player.defensa
    // — base 0, sin cálculo de equipo todavía: ese enganche queda para
    // cuando se decida qué sistema de combate lo conecta, ver la nota de
    // coordinación con docs/GDD_Combate.md en el GDD de mecánicas).
    // Servidor autoritativo: el cliente solo pide, nunca decide vida.
    this.onMessage("combate:atacar", async (client, msg: { objetivoTipo?: "fauna" | "jugador"; objetivoId?: string }) => {
      const atacante = this.state.players.get(client.sessionId);
      if (!atacante || !msg?.objetivoTipo || !msg?.objetivoId) return;
      if (this.brazoInutilizadoDe(client.sessionId)) {
        return client.send("combate:error", { motivo: "brazo roto o amputado, no puedes atacar" });
      }

      if (msg.objetivoTipo === "fauna") {
        if (!this.gestorFaunaSalvaje) return client.send("combate:error", { motivo: "sin fauna salvaje en este mapa" });
        const animal = this.state.fauna.get(msg.objetivoId);
        if (!animal) return client.send("combate:error", { motivo: "objetivo no encontrado" });
        if (Math.hypot(animal.x - atacante.x, animal.y - atacante.y) > RADIO_INTERACCION) {
          return client.send("combate:error", { motivo: "demasiado lejos" });
        }
        const danio = calcularDanio(atacante.ataque, 0); // los animales no tienen defensa
        const resultado = await this.gestorFaunaSalvaje.recibirDanio(msg.objetivoId, danio);
        if (!resultado) return client.send("combate:error", { motivo: "objetivo ya no está activo" });
        this.broadcast("combate:golpe", {
          objetivoTipo: "fauna", objetivoId: msg.objetivoId, danio,
          vida: resultado.vida, vidaMax: resultado.vidaMax, muerto: resultado.muerto,
        });
        return;
      }

      // objetivoTipo === "jugador" (PvP)
      const objetivo = this.state.players.get(msg.objetivoId);
      if (!objetivo || msg.objetivoId === client.sessionId) return client.send("combate:error", { motivo: "objetivo no válido" });
      if (Math.hypot(objetivo.x - atacante.x, objetivo.y - atacante.y) > RADIO_INTERACCION) {
        return client.send("combate:error", { motivo: "demasiado lejos" });
      }
      const danio = calcularDanio(atacante.ataque, objetivo.defensa);
      const stats = aplicarDanio(
        { vida: objetivo.vida, vidaMax: objetivo.vidaMax, ataque: objetivo.ataque, defensa: objetivo.defensa },
        danio,
      );
      const muerto = estaMuerto(stats);
      // Sin diseño de muerte/respawn todavía (fuera de esta pasada): por
      // ahora, morir simplemente rellena la vida al máximo en el sitio —
      // mejor que un jugador "muerto" andante, sin inventar penalización.
      objetivo.vida = muerto ? objetivo.vidaMax : stats.vida;
      if (objetivo.name) {
        const bd = await obtenerBdCompartida();
        const jugador = await bd.obtenerOCrearJugador(objetivo.name);
        await bd.actualizarVidaJugador(jugador.id, objetivo.vida, objetivo.vidaMax);
      }
      // Anatomía (docs/GDD_Anatomia.md): solo si el objetivo sigue en pie —
      // si murió, ya se le rellenó la vida arriba, la herida no aporta nada.
      if (!muerto) void this.aplicarEfectoAnatomicoSiCorresponde(client.sessionId, msg.objetivoId);
      this.broadcast("combate:golpe", {
        objetivoTipo: "jugador", objetivoId: msg.objetivoId, danio,
        vida: objetivo.vida, vidaMax: objetivo.vidaMax, muerto,
      });
    });

    // Crecimiento de bosques (docs/GDD_Bosques.md, pedido 2026-08-30) —
    // talar/plantar solo tienen sentido donde hay gestorBosques (el Hub,
    // ver "límite conocido" del GDD: no disponible en RegionRoom todavía).
    this.onMessage("arbol:consultar", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !this.gestorBosques) return;
      const cercano = this.gestorBosques.buscarArbolCercano(player.x, player.y, RADIO_INTERACCION);
      client.send("arbol:info", cercano ? { especieId: cercano.especieId, etapa: cercano.etapa } : null);
    });

    this.onMessage("arbol:talar", async (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!this.gestorBosques) return client.send("arbol:error", { motivo: "sin bosques en este mapa" });
      const contenedor = this.inventarios.get(client.sessionId);
      if (!contenedor) return;
      if (!contenedor.items.some((it) => it.itemId === "hacha_talar")) {
        return client.send("arbol:error", { motivo: "necesitas un hacha de talar" });
      }
      const cercano = this.gestorBosques.buscarArbolCercano(player.x, player.y, RADIO_INTERACCION);
      if (!cercano) return client.send("arbol:error", { motivo: "no hay ningún árbol cerca" });

      const resultado = await this.gestorBosques.talar(cercano.ref);
      if (!resultado) return client.send("arbol:error", { motivo: "ese árbol ya no está" });

      // Un árbol de origen bake nunca vive en el Schema (docs/GDD_Bosques.md
      // §7) — sin este broadcast, cualquiera mirando el sector en ese
      // instante seguiría viendo el modelo en pie. Los "crecidos" no lo
      // necesitan: su remove del Schema ya lo hace todo.
      if (cercano.ref.tipo === "bake") {
        this.broadcast("arbol:baketalado", { x: cercano.x, y: cercano.y });
      }

      // Recompensa (docs/GDD_Bosques.md): madera siempre (más si es adulto
      // que si es un brote joven), semilla de la misma especie solo de un
      // adulto y con 50% — un brote joven todavía no da semilla propia.
      const pesoMaximo = pesoMaximoTransportable(player.atributos.fuerza);
      const entregar = (itemId: string, cantidad: number) => {
        if (excedePesoMaximo(contenedor, this.catalogoItems, itemId, cantidad, pesoMaximo)) return false;
        return intentarCoger(contenedor, this.catalogoItems, { itemId, cantidad }).ok;
      };
      const entregados: string[] = [];
      const itemMadera = this.especieAMadera[resultado.especieId];
      if (itemMadera) {
        const cantidadMadera = resultado.etapa === "adulto" ? 3 + Math.floor(Math.random() * 3) : 1;
        if (entregar(itemMadera, cantidadMadera)) entregados.push(itemMadera);
      }
      if (resultado.etapa === "adulto" && Math.random() < 0.5) {
        const semillaId = `semilla_${resultado.especieId}`;
        if (this.catalogoItems[semillaId] && entregar(semillaId, 1)) entregados.push(semillaId);
      }

      sincronizarContenedor(player.inventario.cuerpo, contenedor);
      void this.otorgarXpAtributoPorSesion(client, "fuerza", XP_FUERZA_TALAR);
      client.send("arbol:talado", { especieId: resultado.especieId, etapa: resultado.etapa, entregados });
    });

    this.onMessage("arbol:plantar", async (client, msg: { instanciaId?: number; x?: number; y?: number }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (!this.gestorBosques) return client.send("arbol:error", { motivo: "sin bosques en este mapa" });
      if (typeof msg?.instanciaId !== "number") return;
      const contenedor = this.inventarios.get(client.sessionId);
      const semilla = contenedor?.items.find((it) => it.id === msg.instanciaId);
      if (!contenedor || !semilla) return client.send("arbol:error", { motivo: "esa semilla ya no está en tu inventario" });
      const especieId = this.catalogoItems[semilla.itemId]?.crecimientoArbol?.especieArbolId;
      if (!especieId) return client.send("arbol:error", { motivo: "eso no es una semilla de árbol" });

      const x = typeof msg.x === "number" ? msg.x : player.x;
      const y = typeof msg.y === "number" ? msg.y : player.y;
      if (Math.hypot(x - player.x, y - player.y) > RADIO_INTERACCION) {
        return client.send("arbol:error", { motivo: "demasiado lejos" });
      }

      const fila = await this.gestorBosques.plantar(especieId, x, y);
      if (!fila) return client.send("arbol:error", { motivo: "aquí no se puede plantar" });

      quitarItem(contenedor, semilla.id, 1);
      sincronizarContenedor(player.inventario.cuerpo, contenedor);
      client.send("arbol:plantado", { especieId, x: fila.x, y: fila.y });
    });

    // Mascotas/Monturas (docs/GDD_Monturas.md, pedido 2026-08-30): "que los
    // que ya aparecen en aldeas también aparezcan en exteriores... fauna
    // salvaje que puedas alimentar para montar" — mismo auto-apuntado y
    // mismo mecanismo compartido (RoomExteriorBase.manejarMascotaDarComidaGenerico)
    // que RegionRoom, pero contra la fauna SALVAJE viva del Hub. Al llegar
    // a las 5 veces se quita del gestor con `domesticar` (nunca
    // `matarIndividuo`: domesticar no debe dejar cadáver) — el mismo método
    // que usa docs/GDD_Ganaderia.md para convertir fauna salvaje en
    // animales de granja.
    this.onMessage("mascota:darComida", (client) => {
      if (!this.gestorFaunaSalvaje) return client.send("mascota:error", { motivo: "sin_fauna_aqui" });
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      let faunaId: string | null = null;
      let mejorDist = RADIO_INTERACCION;
      this.state.fauna.forEach((f, id) => {
        if (!this.catalogoCombate?.[f.especieId]?.domesticable) return;
        const d = Math.hypot(f.x - player.x, f.y - player.y);
        if (d < mejorDist) { mejorDist = d; faunaId = id; }
      });
      const candidato = faunaId
        ? { faunaId, especieId: this.state.fauna.get(faunaId)!.especieId, dieta: this.catalogoCombate?.[this.state.fauna.get(faunaId)!.especieId]?.dieta }
        : null;
      void this.manejarMascotaDarComidaGenerico(client, candidato, (id) => this.gestorFaunaSalvaje!.domesticar(id).then((r) => r !== null));
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    this.crearJugador(client, options, this.mapa.spawnX, this.mapa.spawnY);

    // Vida persistida (docs/GDD_Mecanicas.md §5.4): carga best-effort, no
    // bloquea el join — mismo criterio que el resto de datos "oportunistas"
    // (gremio, etc.) que no viajan síncronos en onJoin. Si falla, el
    // jugador se queda con la base 100/100 del Schema — no rompe nada.
    const nombre = this.nombreDe(client);
    if (nombre) {
      obtenerBdCompartida()
        .then((bd) => bd.obtenerOCrearJugador(nombre))
        .then((jugador) => {
          const player = this.state.players.get(client.sessionId);
          if (player) {
            player.vida = jugador.vida;
            player.vidaMax = jugador.vidaMax;
            // Oficio persistido — ronda 2 (docs/GDD_Profesiones.md, pedido
            // 2026-08-30): mismo criterio best-effort que vida/anatomía.
            player.oficio1 = jugador.oficio1;
            player.oficio2 = jugador.oficio2;
          }
          // Anatomía persistida (docs/GDD_Anatomia.md) — mismo criterio
          // best-effort que la vida: si falla, arranca en anatomiaInicial().
          const anatomia: Anatomia = jugador.anatomia ? JSON.parse(jugador.anatomia) : anatomiaInicial();
          this.anatomiaPorSesion.set(client.sessionId, anatomia);
          if (player) this.mirrorAnatomiaASchema(player.anatomia, anatomia);
          // Enfermedades persistidas (docs/GDD_Enfermedades.md) — mismo
          // criterio best-effort que anatomía: si falla, arranca sano.
          const enfermedades: EstadoEnfermedades = jugador.enfermedades ? JSON.parse(jugador.enfermedades) : enfermedadesInicial();
          this.enfermedadesPorSesion.set(client.sessionId, enfermedades);
          if (player) this.mirrorEnfermedadesASchema(player.enfermedades, enfermedades);
          // Niebla de guerra (docs/GDD_Mapa_Mundo.md, pedido 2026-08-31) —
          // mismo criterio best-effort: si falla, arranca sin nada revelado
          // (peor UX momentánea, nunca rompe el join).
          void obtenerBdCompartida()
            .then((bd) => bd.obtenerExploracion(jugador.id, this.mapaIdPropio))
            .then((sectores) => {
              this.exploracionPorSesion.set(client.sessionId, { jugadorId: jugador.id, revelados: new Set(sectores) });
              // Revela ya el punto de aparición — sin esto, un jugador que
              // no se mueva nunca vería "niebla" bajo sus propios pies.
              const p = this.state.players.get(client.sessionId);
              if (p) this.revelarExploracionSiHaceFalta(client.sessionId, p.x, p.y);
            })
            .catch((err) => console.error("No se pudo cargar la exploración persistida del jugador:", err));
        })
        .catch((err) => console.error("No se pudo cargar la vida persistida del jugador:", err));
    }

    // estado de construcción al entrar (GDD §4); el interior de los
    // edificios de CONSTRUCCIÓN (player-placed) no viaja aquí — solo los
    // de ciudades/ se entran por portal (docs/GDD_Sistema_Puertas.md)
    this.enviarEstadoConstruccion(client);
  }

  async onLeave(client: Client) {
    await super.onLeave(client);
    this.ultimoMensajeNpc.delete(client.sessionId);
  }

  // Combate táctico (docs/GDD_Combate.md): una fauna salvaje muerta en
  // combate pasa por matarIndividuo (persiste, quita del estado Y crea su
  // cadáver — cierra el círculo con el sistema de cadáveres) en vez del
  // borrado genérico de RoomExteriorBase.finalizarMuerte.
  protected async onFaunaMuerta(id: string): Promise<boolean> {
    if (!this.gestorFaunaSalvaje) return false;
    const cadaver = await this.gestorFaunaSalvaje.matarIndividuo(id);
    if (cadaver) this.publicarCadaver(cadaver); // docs/GDD_Caza.md — visible/lootable para cualquier jugador
    return cadaver !== null;
  }

  /** Ganadería (docs/GDD_Ganaderia.md): domesticar aquí saca al individuo de su sector activo (GestorFaunaSalvaje), sin cadáver ni loot. */
  protected async onFaunaDomesticada(id: string): Promise<boolean> {
    if (!this.gestorFaunaSalvaje) return false;
    return (await this.gestorFaunaSalvaje.domesticar(id)) !== null;
  }

  /** docs/GDD_Bosques.md §7 — árboles de origen bake talados en un sector, para que el cliente los excluya al construir su render (mismo `arbolesTaladosEnSector` de RoomExteriorBase, solo el Hub tiene GestorBosques). */
  protected async arbolesTaladosEnSector(sectorX: number, sectorY: number): Promise<{ x: number; y: number }[]> {
    if (!this.gestorBosques) return [];
    const bd = await obtenerBdCompartida();
    const mapaId = path.basename(this.mapa.rutaMapa);
    const filas = await bd.listarArbolesVivosSector(mapaId, sectorX, sectorY);
    return filas.filter((f) => f.origen === "bake" && f.estado === "talado").map((f) => ({ x: f.x, y: f.y }));
  }

  /** docs/GDD_Caza.md — solo el Hub conoce categoriaVida/categoriaRecursoCarne/Piel por especie (catalogoCombate real). */
  protected estadisticasFaunaDe(especieId: string) {
    return this.catalogoCombate?.[especieId] ?? null;
  }

  /** docs/GDD_Combate.md §9.1 — solo el Hub sabe qué fauna es peligrosa (catalogoCombate real), así que solo aquí auto-se-une a una ventana de combate cercana. */
  protected faunaEsPeligrosa(especieId: string): boolean {
    return this.catalogoCombate?.[especieId]?.peligroso ?? false;
  }

  /**
   * Disparador real de autosimulación (docs/GDD_Combate.md §7): un NPC
   * cerca de fauna `peligroso` combate contra ella de una sentada, sin
   * turnos interactivos ni UI (nadie la está mirando). Un solo encuentro
   * por pasada — es un guarda-raíl simple, no una simulación masiva; si
   * hay varios candidatos a la vez, los siguientes se resuelven en la
   * próxima pasada (5s después).
   */
  private async comprobarEncuentrosAutomaticos() {
    if (!this.catalogoCombate) return;
    const RADIO_ENCUENTRO = 4;
    for (const [npcId, npc] of this.state.npcs.entries()) {
      for (const [faunaId, fauna] of this.state.fauna.entries()) {
        const datos = this.catalogoCombate[fauna.especieId];
        if (!datos?.peligroso) continue;
        if (Math.hypot(npc.x - fauna.x, npc.y - fauna.y) > RADIO_ENCUENTRO) continue;

        const lado = 8;
        const cx = Math.floor((npc.x + fauna.x) / 2);
        const cy = Math.floor((npc.y + fauna.y) / 2);
        let gx0 = Math.round(cx - lado / 2);
        let gy0 = Math.round(cy - lado / 2);
        gx0 = Math.max(0, Math.min(gx0, this.mapa.ancho - lado));
        gy0 = Math.max(0, Math.min(gy0, this.mapa.alto - lado));
        const obstaculos = new Uint8Array(lado * lado);
        for (let gy = 0; gy < lado; gy++) {
          for (let gx = 0; gx < lado; gx++) {
            if (tipoEn(this.mapa, gx0 + gx, gy0 + gy) === TIPO.SOLIDO) obstaculos[gy * lado + gx] = 1;
          }
        }

        const uNpc: UnidadCombate = {
          id: npcId, esJugador: false, bando: "A",
          gx: Math.round(npc.x - gx0), gy: Math.round(npc.y - gy0),
          hp: npc.vida, hpMax: npc.vidaMax, pa: PA_MAX_COMBATE, paMax: PA_MAX_COMBATE,
          iniciativa: calcularIniciativa(10, Math.random), estado: "activo",
          ataqueFisico: npc.ataque, defensaFisica: npc.defensa, alcance: 1,
        };
        const uFauna: UnidadCombate = {
          id: faunaId, esJugador: false, bando: "B",
          gx: Math.round(fauna.x - gx0), gy: Math.round(fauna.y - gy0),
          hp: fauna.vida, hpMax: fauna.vidaMax, pa: PA_MAX_COMBATE, paMax: PA_MAX_COMBATE,
          iniciativa: calcularIniciativa(10, Math.random), estado: "activo",
          ataqueFisico: fauna.ataque, defensaFisica: 0, alcance: 1,
        };

        const resultado = simularCombateAutomatico([uNpc], [uFauna], { ancho: lado, alto: lado, obstaculos }, Math.random);
        for (const u of resultado.unidades) {
          if (u.id === npcId) {
            if (u.estado === "caido") this.state.npcs.delete(npcId);
            else npc.vida = u.hp;
          } else if (u.id === faunaId) {
            if (u.estado === "caido") await this.onFaunaMuerta(faunaId);
            else fauna.vida = u.hp;
          }
        }
        return; // un encuentro por pasada — de sobra para un mecanismo recién estrenado
      }
    }
  }
}
