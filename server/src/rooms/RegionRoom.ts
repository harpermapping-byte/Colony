import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";
import { NpcBakeado } from "../mundo/agentes";
import { cargarNpcsFijos, cargarNpcsTutorialesDeMapa } from "../mundo/npcsFijos";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { GestorFauna, FaunaSpawn } from "../mundo/fauna";
import { cargarCatalogoCombateFauna, CatalogoCombateFauna } from "../mundo/catalogoCombateFauna";
import { asegurarAsentamientoBandido, marcarTropaMuertaYVerificarConquista } from "../mundo/economiaAsentamientos";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { cargarParcelasDeReservas } from "../construccion/parcelas";
import { ventaJugadorPermitida, precioInmueble } from "../propiedades/propiedades";
import { STATS_POR_RANGO, FACTOR_POR_NIVEL_EQUIPO, LOOT_POR_RANGO } from "../mundo/guarnicionBandida";
import { crearCadaver } from "../mundo/cadaveres";
import { diaFraccional } from "../mundo/reproduccionFauna";
import { agregarItem } from "../inventario/inventario";
import { generarGritoBandido } from "../ia/cronicaBandida";
import { nombrePoliticoDeterminista } from "../personaje/nombresNpc";

// Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30): "si se les da de comer
// unas 5 veces, podrás convertirlo en tu mascota" — fauna URBANA
// domesticable (perro/gato/caballo/vaca/..., catalogoCombate.domesticable);
// RegionRoom es la única room con fauna urbana viva (GestorFauna). El
// mecanismo compartido (comida diet-aware, progreso, crear mascota) vive en
// RoomExteriorBase.manejarMascotaDarComidaGenerico desde docs/GDD_Monturas.md
// (2026-08-30) — HubRoom tiene su propio equivalente para fauna salvaje.

interface OpcionesRegion {
  name?: string;
  mapaId: string;
  entradaX?: number;
  entradaY?: number;
}

// Placeholder de balance (docs/GDD_Ciudad_Capital.md §3bis no fija un tope
// por parcela reservada) — mismo criterio "número de referencia a afinar,
// no una decisión cerrada" que ya documenta pesoMaximoTransportable en
// inventario.ts. Aplica por igual a parcelas "normal" y "especial" en v1.
const TOPE_PROPS_PARCELA_REGION = 30;

/**
 * Instancia de una región exterior (aldea, POI...) fuera del Hub —
 * docs/GDD_Sistema_Puertas.md. Mismo formato de mapa que el Hub (sectores
 * bakeados, mismo motor de colisión). Construcción-en-regiones (docs/
 * GDD_Ciudad_Capital.md §3bis, pedido 2026-08-29 "la capital es un sitio
 * como las aldeas y POIs... pero con reglas especiales"): si el bake trae
 * `parcelasReservadas` (hoy solo el tier `capital_jarl`), esta MISMA room
 * habilita construcción/parcelas/jarl igual que el Hub — cualquier otra
 * aldea/POI sin esas parcelas se queda exactamente como antes.
 *
 * Una instancia por `mapaId` (filterBy en index.ts): dos jugadores que
 * entran a la MISMA aldea caen en la MISMA room; otra aldea es otra room.
 */
export class RegionRoom extends RoomExteriorBase {
  private mapa!: MapaCargado;
  mapaId!: string;
  // Propiedades comerciales (docs/GDD_Propiedades.md) — inmuebleId → tipo de
  // edificio, SOLO los que el bake reservó para venta/alquiler. Catálogo de
  // "qué existe", no de tenencia — el dueño/precio vive en la BD, se
  // consulta bajo demanda (point-query, nunca cacheado aquí).
  private inmueblesVendibles = new Map<string, { tipoEdificioId: string }>();
  // Fauna doméstica urbana (perro/gato...) y catálogo de combate/domesticable
  // ya resuelto — undefined si el bake de esta región no trae fauna.json.
  private gestorFauna?: GestorFauna;
  private catalogoCombateFauna: CatalogoCombateFauna = {};
  // Patrulla bandida (docs/GDD_Faccion_Bandidos.md §7ter) — slotId de
  // state.npcs (`patrulla:<tropaId>`) -> id de tropas_asentamiento. Vacío en
  // cualquier región que no sea un asentamiento_hostil vivo.
  private patrullaTropaDeEnemigo = new Map<string, string>();
  // Diálogo de bandidos (docs/GDD_Faccion_Bandidos.md §7quinquies) — claves
  // `${slotId}|${jugador}` ya generadas esta vida de la room, para no
  // llamar a la IA dos veces por el mismo encuentro (el grito se cachea en
  // el propio `Npc.grito`, esto solo evita relanzar la llamada async
  // mientras está en curso o después de que ya haya asignado un grito).
  private gritosGenerados = new Set<string>();

  async onCreate(options: OpcionesRegion) {
    if (!options?.mapaId) throw new Error("RegionRoom necesita options.mapaId");
    this.mapaId = options.mapaId;
    const rutaMapa = rutaDeMapaId(options.mapaId);
    this.mapa = cargarMapaColision(rutaMapa);
    this.mundo = this.mapa;
    this.mapaExterior = this.mapa; // habilita "coger" de recolectables del bake (fase 2 de inventario)
    console.log(`Región "${this.mapa.nombre}" (${options.mapaId}): ${this.mapa.ancho}x${this.mapa.alto} casillas`);
    this.iniciarMovimiento();

    // Construcción-en-regiones: SOLO si el bake de esta región reservó
    // hueco para ello (hoy únicamente la ciudad capital, tier capital_jarl)
    // — cualquier aldea/POI normal no tiene parcelasReservadas y este
    // bloque no hace nada, cero cambio de comportamiento para ellas.
    if (this.mapa.parcelasReservadas.length > 0) {
      const parcelas = cargarParcelasDeReservas(
        this.mapa.parcelasReservadas,
        options.mapaId,
        this.mapa.ancho,
        this.mapa.alto,
        TOPE_PROPS_PARCELA_REGION,
      );
      await this.iniciarConstruccion(parcelas, options.mapaId);
    }

    // NPCs con rutina (GDD_Agentes_Moviles.md): si el bake trae población,
    // los agentes nacen recolocados según la hora del reloj de mundo y se
    // simulan a 10 hz (paseo, no combate) SOLO mientras la room viva — la
    // room autodispone al vaciarse, así una aldea sin jugadores cuesta cero.
    // NPCs FIJOS (docs/GDD_Profesiones.md ronda 2/3, pedido 2026-08-30): el
    // admin los coloca a mano en `npcsFijos.json` del mapa, o en vivo desde
    // el juego (tutoriales, persistidos en BD) — mismo GestorAgentes, un
    // tramo único de 24h así que nunca se mueven. A diferencia de los NPCs
    // con rutina, estos cargan SIEMPRE, aunque el mapa no tenga poblacion.json.
    {
      const rutaPoblacion = path.join(rutaMapa, "poblacion.json");
      const npcsConRutina: NpcBakeado[] = fs.existsSync(rutaPoblacion)
        ? (JSON.parse(fs.readFileSync(rutaPoblacion, "utf8")) as { npcs: NpcBakeado[] }).npcs
        : [];
      const npcsTutoriales = await cargarNpcsTutorialesDeMapa(await obtenerBdCompartida(), this.mapaId);
      const todosLosNpcs = [...npcsConRutina, ...cargarNpcsFijos(rutaMapa), ...npcsTutoriales];
      if (todosLosNpcs.length > 0) {
        // obtenerOCrearGestorAgentes (docs/GDD_Produccion.md): mismo gestor
        // que usará un futuro NPC transportista en esta región — un único
        // GestorAgentes por room, un único tick, nunca dos relojes distintos.
        const gestor = this.obtenerOCrearGestorAgentes();
        gestor.iniciar(todosLosNpcs, tiempoMundo().hora);
        console.log(`  ${gestor.cantidad} NPCs en el mapa (${npcsTutoriales.length} tutorial(es))`);
        // Comercio con NPCs (docs/GDD_Economia.md, pedido 2026-08-30): solo
        // hace falta saber CUÁLES son "tendero" — el resto de oficio sigue
        // siendo flavor. slotId ya es la clave real de state.npcs.
        for (const npc of todosLosNpcs) {
          if (npc.oficio) this.oficiosNpc.set(npc.slotId, npc.oficio);
        }
      }
    }

    // Fauna doméstica (GDD_Agentes_Moviles.md v1.3): sin rutina horaria,
    // solo merodeo — se tickea más despacio (5 hz de sobra para un paseo).
    const rutaFauna = path.join(rutaMapa, "fauna.json");
    if (fs.existsSync(rutaFauna)) {
      const datos = JSON.parse(fs.readFileSync(rutaFauna, "utf8")) as { fauna: FaunaSpawn[] };
      this.catalogoCombateFauna = cargarCatalogoCombateFauna(
        path.resolve(__dirname, "..", "..", "..", "baker", "catalogo", "animales.json"),
      );
      this.gestorFauna = new GestorFauna(this.state.fauna, this.mundo, this.catalogoCombateFauna);
      this.gestorFauna.iniciar(datos.fauna);
      this.clock.setInterval(() => this.gestorFauna!.tick(0.2), 200);
      // Agro por distancia (docs/GDD_Combate.md §7bis, pedido 2026-08-30) —
      // mismo mecanismo que HubRoom, por si una región tuviera fauna urbana
      // `peligroso` (hoy no la tiene, pero el mecanismo no debe vivir solo
      // en un tipo de room).
      this.clock.setInterval(() => this.verificarAgroFauna(), 200);
      console.log(`  ${this.gestorFauna.cantidad} animales sueltos en el mapa`);
    }

    // Facción bandida (docs/GDD_Faccion_Bandidos.md §6): una región cuyo
    // indice.json trae tier "asentamiento_hostil" (bakeada por mazmorras/
    // vía ciudades/, ver GDD_Bakeador_Dungeons.md) es una base de la
    // facción — se asegura su fila en SQLite (+ guarnición inicial la
    // primera vez que se descubre) al cargar la región. El tick de
    // economía en sí corre aparte, en index.ts, una sola vez por proceso
    // — no aquí, para no repetirlo una vez por cada región cargada.
    const rutaIndice = path.join(rutaMapa, "indice.json");
    if (fs.existsSync(rutaIndice)) {
      const indice = JSON.parse(fs.readFileSync(rutaIndice, "utf8")) as {
        tier?: string;
        edificios?: { id: string; tipo: string; reservadoJugador?: boolean }[];
        // Polilíneas puerta -> plaza/focal YA calculadas por A* al hornear
        // (ciudades/src/generar.js) — la patrulla bandida (§7ter, abajo) las
        // reusa TAL CUAL para su ida/vuelta, "nunca A* en directo" (§2.3).
        caminos?: [number, number][][];
      };
      if (indice.tier === "asentamiento_hostil") {
        const bd = await obtenerBdCompartida();
        await asegurarAsentamientoBandido(bd, options.mapaId);
        await this.poblarPatrullaBandida(options.mapaId, indice.caminos);
        // Diálogo de bandidos (docs/GDD_Faccion_Bandidos.md §7quinquies,
        // pedido 2026-08-30: "si veo un bandido, la IA le habrá dicho qué
        // frase decir según me vea") — más lento que el agro (no hace
        // falta reaccionar en 200ms a que alguien se acerque a charlar).
        this.clock.setInterval(() => this.verificarDialogoBandidos(), 1000);
      }
      // Zona PvP (docs/GDD_PvP.md, pedido 2026-08-30): "todas menos la
      // ciudad capital y alrededores" — la capital del jarl (`capital_jarl`,
      // única en todo el mapa, docs/GDD_Ciudad_Capital.md) es SIEMPRE zona
      // segura, tenga PvP global activado el jarl o no.
      this.esZonaSeguraPropia = indice.tier === "capital_jarl";

      // Propiedades comerciales (docs/GDD_Propiedades.md, pedido 2026-08-29):
      // edificios ENTEROS comprables/alquilables — solo los que el bake
      // marcó `reservadoJugador` Y cuyo tipo está en el catálogo cerrado
      // (ventaJugador, interiores/catalogo/tipos_edificio.json). Disponible
      // en CUALQUIER aldea/POI con edificios así marcados, no solo la
      // capital — a diferencia de construcción-en-regiones, esto no
      // necesita `parcelasReservadas`.
      for (const ed of indice.edificios ?? []) {
        if (ed.reservadoJugador && ventaJugadorPermitida(ed.tipo)) {
          this.inmueblesVendibles.set(ed.id, { tipoEdificioId: ed.tipo });
        }
      }
      if (this.inmueblesVendibles.size > 0) {
        console.log(`  ${this.inmueblesVendibles.size} inmueble(s) reservados para venta/alquiler a jugadores`);
      }
    }

    // Puertas del asentamiento (docs/GDD_Sistema_Puertas.md): "interior" ->
    // entra al edificio; "exterior" con destino -> otra región/hub; sin
    // destino -> salida propia, vuelve a quien entró aquí.
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
          mapaId: this.mapaId,
          edificio: portal.edificio,
          tipoEdificioId: portal.tipoEdificioId,
          esMazmorra: portal.esMazmorra ?? false,
          x: portal.x,
          y: portal.y,
        });
      } else if (portal.destino) {
        client.send("portal:ir", { tipo: portal.destino.tipo, mapaId: portal.destino.mapaId });
      } else {
        client.send("portal:ir", { tipo: "volver" });
      }
    });

    this.registrarMensajesInmueble(options.mapaId);

    // Mascotas (docs/GDD_Mascotas.md) — "dar de comer" auto-apunta al animal
    // domesticable más cercano dentro de RADIO_INTERACCION, mismo criterio
    // "sin UI de targeting" que "coger"/"portal:usar". No-op si esta región
    // no tiene fauna urbana (this.gestorFauna undefined).
    this.onMessage("mascota:darComida", (client) => this.manejarMascotaDarComida(client));
  }

  private manejarMascotaDarComida(client: Client) {
    if (!this.gestorFauna) return client.send("mascota:error", { motivo: "sin_fauna_aqui" });
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    let faunaId: string | null = null;
    let mejorDist = RADIO_INTERACCION;
    this.state.fauna.forEach((f, id) => {
      if (!this.catalogoCombateFauna[f.especieId]?.domesticable) return;
      const d = Math.hypot(f.x - player.x, f.y - player.y);
      if (d < mejorDist) { mejorDist = d; faunaId = id; }
    });
    const candidato = faunaId
      ? { faunaId, especieId: this.state.fauna.get(faunaId)!.especieId, dieta: this.catalogoCombateFauna[this.state.fauna.get(faunaId)!.especieId]?.dieta }
      : null;
    void this.manejarMascotaDarComidaGenerico(client, candidato, (id) => this.gestorFauna!.quitar(id));
  }

  /** Propiedades comerciales (docs/GDD_Propiedades.md) — inmuebles ENTEROS de esta región. No-op si el bake no reservó ninguno. */
  private registrarMensajesInmueble(mapaId: string) {
    this.onMessage("inmueble:listar", async (client) => {
      const bd = await obtenerBdCompartida();
      const lista = [];
      for (const [id, { tipoEdificioId }] of this.inmueblesVendibles) {
        const prop = await bd.obtenerPropiedad(this.idInmueble(mapaId, id));
        lista.push({
          id, tipoEdificioId,
          dueno: prop?.dueno ?? null,
          modoTenencia: prop?.modoTenencia ?? null,
          precioFarycoins: prop?.precioFarycoins ?? null,
          expiraEn: prop?.expiraEn ?? null,
        });
      }
      client.send("inmueble:lista", lista);
    });

    this.onMessage("inmueble:comprar", (client, msg: { inmuebleId?: string; origenPago?: "gremio" }) => this.manejarInmuebleAdquirir(client, mapaId, msg?.inmuebleId, "compra", msg?.origenPago));
    this.onMessage("inmueble:alquilar", (client, msg: { inmuebleId?: string; origenPago?: "gremio" }) => this.manejarInmuebleAdquirir(client, mapaId, msg?.inmuebleId, "alquiler", msg?.origenPago));

    this.onMessage("inmueble:renovar", async (client, msg: { inmuebleId?: string }) => {
      const nombre = this.nombreDe(client);
      const entrada = msg?.inmuebleId ? this.inmueblesVendibles.get(msg.inmuebleId) : undefined;
      if (!nombre || !entrada) return client.send("inmueble:error", { motivo: "inmueble desconocido" });
      const precio = precioInmueble(entrada.tipoEdificioId, "alquiler");
      if (!precio || precio.periodoHoras == null) return client.send("inmueble:error", { motivo: "este inmueble no se alquila" });
      const bd = await obtenerBdCompartida();
      const r = await bd.renovarTenencia(this.idInmueble(mapaId, msg!.inmuebleId!), nombre, precio.periodoHoras, precio.precio);
      if (!r.ok) return client.send("inmueble:error", { motivo: r.motivo });
      this.broadcast("inmueble:actualizado", { id: msg!.inmuebleId, dueno: nombre, modoTenencia: "alquiler", expiraEn: r.expiraEn });
    });

    this.onMessage("inmueble:revocar", async (client, msg: { inmuebleId?: string }) => {
      if (!this.puedeActuarComoJarl(client)) return client.send("inmueble:error", { motivo: "solo el jarl revoca propiedades" });
      const entrada = msg?.inmuebleId ? this.inmueblesVendibles.get(msg.inmuebleId) : undefined;
      if (!entrada) return client.send("inmueble:error", { motivo: "inmueble desconocido" });
      const bd = await obtenerBdCompartida();
      await bd.revocarPropiedad(this.idInmueble(mapaId, msg!.inmuebleId!));
      this.broadcast("inmueble:actualizado", { id: msg!.inmuebleId, dueno: null, modoTenencia: null, expiraEn: null });
    });
  }

  private idInmueble(mapaId: string, inmuebleId: string): string {
    return `i_${mapaId}:${inmuebleId}`;
  }

  private async manejarInmuebleAdquirir(client: Client, mapaId: string, inmuebleId: string | undefined, modo: "compra" | "alquiler", origenPago?: "gremio") {
    const entrada = inmuebleId ? this.inmueblesVendibles.get(inmuebleId) : undefined;
    if (!entrada) return client.send("inmueble:error", { motivo: "inmueble desconocido" });
    const precio = precioInmueble(entrada.tipoEdificioId, modo);
    if (!precio) return client.send("inmueble:error", { motivo: modo === "compra" ? "este inmueble no está en venta" : "este inmueble no se alquila" });

    const r = await this.comprarOAlquilarPropiedad(client, "inmueble:error", {
      id: this.idInmueble(mapaId, inmuebleId!),
      tipo: "inmueble",
      asentamiento: mapaId,
      modo,
      precioFarycoins: precio.precio,
      periodoHoras: precio.periodoHoras,
      origenPago,
    });
    if (!r) return;
    const nombre = this.nombreDe(client)!;
    this.broadcast("inmueble:actualizado", { id: inmuebleId, dueno: nombre, modoTenencia: modo, expiraEn: r.expiraEn });
  }

  onJoin(client: Client, options: OpcionesRegion) {
    const x = options?.entradaX ?? this.mapa.spawnX;
    const y = options?.entradaY ?? this.mapa.spawnY;
    this.crearJugador(client, options, x, y);
    this.enviarEstadoConstruccion(client); // no-op si esta región no tiene parcelasReservadas
  }

  /** Mismo criterio que HubRoom — sin esto, docs/GDD_Ganaderia.md (animal:domesticar) y cadaver:desollar no encuentran nunca especie aquí. */
  protected estadisticasFaunaDe(especieId: string) {
    return this.catalogoCombateFauna?.[especieId] ?? null;
  }

  /** Ganadería (docs/GDD_Ganaderia.md): domesticar aquí saca al animal del merodeo urbano (GestorFauna), mismo mecanismo que mascota:darComida. */
  protected async onFaunaDomesticada(id: string): Promise<boolean> {
    return this.gestorFauna?.quitar(id) ?? false;
  }

  /**
   * §7ter (docs/GDD_Faccion_Bandidos.md, pedido 2026-08-30: "que patrullen
   * varios ciudadanos en grupo o solitario de 1 a 5, simulando que están
   * gathereando... por caminos ida y vuelta") — los RECLUTAS vivos de la
   * guarnición (los guardia/líder se quedan de guardia fija en el cuartel,
   * InteriorRoom.poblarGuarnicionBandida) salen a patrullar entre la
   * plaza/focal del asentamiento y una de sus puertas, sobre la MISMA
   * polilínea A* que ya calculó el bakeador de ciudades/ una vez (`caminos`
   * en indice.json) — cero A* en directo (§2.3). Cero movimiento nuevo:
   * reusa TAL CUAL `GestorAgentes.agregarAgenteTransportista` (mismo
   * mecanismo de "paradas en bucle" que ya usan los NPC transportistas,
   * docs/GDD_Produccion.md), solo mutando el `Npc` resultante a `hostil:true`
   * con las stats reales de la tropa. Grupos de hasta 5 (un `Npc` por
   * tropa) — "de al lado" en el mismo tramo, así se unen todos si se ataca
   * a uno (cerrarVentanaCombate ya auto-une cualquier Npc `hostil` cercano).
   */
  private async poblarPatrullaBandida(mapaId: string, caminosCrudos: [number, number][][] | undefined) {
    if (!caminosCrudos || caminosCrudos.length === 0) return;
    const bd = await obtenerBdCompartida();
    const asentamiento = await asegurarAsentamientoBandido(bd, mapaId);
    if (asentamiento.bando !== "bandido") return;

    const tropas = await bd.listarTropas(mapaId);
    const reclutas = tropas.filter((t) => t.estado === "vivo" && t.rango === "recluta");
    if (reclutas.length === 0) return;

    const factor = FACTOR_POR_NIVEL_EQUIPO[asentamiento.nivelEquipo] ?? 1;
    const base = STATS_POR_RANGO.recluta;
    const gestor = this.obtenerOCrearGestorAgentes();
    const TAMANO_GRUPO = 5;

    let grupos = 0;
    for (let i = 0; i < reclutas.length; i += TAMANO_GRUPO) {
      const miembros = reclutas.slice(i, i + TAMANO_GRUPO);
      const camino = caminosCrudos[grupos % caminosCrudos.length].map(([x, y]) => ({ x, y }));
      grupos++;
      if (camino.length < 2) continue; // camino inválido/demasiado corto: sin grupo esta vez, no debería pasar con el bake real

      // camino[] va PUERTA -> plaza (el mismo orden que exporta generar.js);
      // "ida" (salir a buscar recursos) es plaza -> puerta, la inversa.
      const plaza = camino[camino.length - 1];
      const puerta = camino[0];
      const caminoIda = [...camino].reverse();
      const caminoVuelta = camino;

      for (const tropa of miembros) {
        const slotId = `patrulla:${tropa.id}`;
        // Nombre de político (pedido 2026-08-30, "los NPC hostiles también
        // tiran de esa lista") — antes "Bandido merodeador" genérico
        // compartido por todo el grupo; ahora cada tropa tiene su propia
        // identidad determinista.
        gestor.agregarAgenteTransportista(slotId, nombrePoliticoDeterminista(slotId), plaza, puerta, caminoIda, caminoVuelta);
        const esquema = this.state.npcs.get(slotId)!;
        esquema.hostil = true;
        esquema.accion = "patrullar";
        esquema.vida = Math.round(base.vida * factor);
        esquema.vidaMax = esquema.vida;
        esquema.ataque = Math.round(base.ataque * factor);
        esquema.defensa = Math.round(base.defensa * factor);
        this.patrullaTropaDeEnemigo.set(slotId, tropa.id);
      }
    }
    console.log(`  Patrulla bandida "${mapaId}": ${reclutas.length} recluta(s) de patrulla en ${grupos} grupo(s) (nivelEquipo=${asentamiento.nivelEquipo}).`);
  }

  /**
   * §7quinquies (pedido 2026-08-30: "si veo un bandido de esa aldea, la IA
   * le habrá dicho qué frase decir según me vea... si perdió una batalla
   * contra un jugador, lo recuerda") — cuando un jugador se acerca lo
   * bastante a una tropa de patrulla viva, le genera UNA frase de burbuja
   * (`Npc.grito`, el mismo campo que ya usan los civiles de poblacion/ — el
   * cliente ya sabe pintarlo rotando con el nombre) referenciando su
   * historial real con ESE jugador si lo tiene. Una sola llamada de IA por
   * (bandido, jugador) en toda la vida de esta room — `gritosGenerados`
   * evita relanzarla mientras la llamada async sigue en curso o ya resuelta.
   */
  private verificarDialogoBandidos() {
    if (this.patrullaTropaDeEnemigo.size === 0) return;
    for (const [slotId] of this.patrullaTropaDeEnemigo) {
      const npc = this.state.npcs.get(slotId);
      if (!npc) continue;
      for (const jugador of this.state.players.values()) {
        const clave = `${slotId}|${jugador.name}`;
        if (this.gritosGenerados.has(clave)) continue;
        if (Math.hypot(npc.x - jugador.x, npc.y - jugador.y) > RADIO_INTERACCION) continue;
        this.gritosGenerados.add(clave);
        void this.generarYAsignarGrito(slotId, jugador.name);
      }
    }
  }

  private async generarYAsignarGrito(slotId: string, jugador: string) {
    const bd = await obtenerBdCompartida();
    const [asentamiento, historial] = await Promise.all([
      bd.obtenerOCrearAsentamiento(this.mapaId),
      bd.historialJugadorEnAsentamiento(this.mapaId, jugador, 5),
    ]);
    const grito = await generarGritoBandido({
      asentamientoId: this.mapaId,
      rango: "recluta",
      nivelEquipo: asentamiento.nivelEquipo,
      jugador,
      historial,
    });
    if (!grito) return; // sin IA configurada (o falló): silencio, mismo criterio que el resto del proyecto
    const npc = this.state.npcs.get(slotId); // puede haber muerto/desaparecido mientras se esperaba la IA
    if (npc) npc.grito = grito;
  }

  /**
   * §7ter — si el `Npc` muerto era una tropa de patrulla: baja permanente
   * en BD (nunca revive), posible conquista si era la última viva, y
   * cadáver looteable (mismo mecanismo que un animal muerto, docs/GDD_Caza.md
   * — y que la guarnición del cuartel, InteriorRoom.finalizarMuerte).
   * Cualquier otro Npc (un civil normal de poblacion/) sigue exactamente
   * igual que siempre — `patrullaTropaDeEnemigo` está vacío para ellos.
   */
  protected async finalizarMuerte(id: string, jugadoresGanadores: string[] = []) {
    const tropaId = this.patrullaTropaDeEnemigo.get(id);
    if (!tropaId) return super.finalizarMuerte(id, jugadoresGanadores);

    const npc = this.state.npcs.get(id);
    // posición se lee ANTES de super.finalizarMuerte(id) — ese borra la
    // entidad del Schema (state.npcs.delete), después ya no existe.
    const x = npc?.x ?? 0;
    const y = npc?.y ?? 0;
    await super.finalizarMuerte(id, jugadoresGanadores);
    this.patrullaTropaDeEnemigo.delete(id);
    this.gestorAgentes?.quitarAgente(id); // sin esto GestorAgentes seguiría moviendo una entidad ya borrada del Schema

    const bd = await obtenerBdCompartida();
    // docs/GDD_Faccion_Bandidos.md §7quinquies — mismo criterio que
    // InteriorRoom: hecho estructurado sin IA, la IA solo redacta la
    // crónica de conquista y el grito de un bandido vivo.
    const dia = tiempoMundo().dia;
    for (const jugador of jugadoresGanadores) {
      await bd.registrarMemoriaLider(
        dia,
        `${jugador} mató a un recluta de "${this.mapaId}".`,
        { tipo: "tropa_muerta", asentamientoId: this.mapaId, jugador },
      );
    }

    const rutaMapa = rutaDeMapaId(this.mapaId);
    const { conquistada } = await marcarTropaMuertaYVerificarConquista(bd, tropaId, this.mapaId, rutaMapa, jugadoresGanadores);
    if (conquistada) console.log(`  ¡Asentamiento bandido "${this.mapaId}" conquistado! Última tropa (${tropaId}) muerta en patrulla.`);

    const cadaver = crearCadaver({
      id: `cadaver:${tropaId}`,
      mapaId: this.mapaId,
      tipoOrigen: "npc",
      especieOrigenId: tropaId,
      x, y,
      ahora: diaFraccional(tiempoMundo().dia, tiempoMundo().hora),
    });
    for (const { itemId, cantidad } of LOOT_POR_RANGO.recluta) agregarItem(cadaver.contenedor, this.catalogoItems, itemId, cantidad);
    this.publicarCadaver(cadaver);
  }
}
