import { Client } from "@colyseus/core";
import * as fs from "fs";
import * as path from "path";
import { RoomExteriorBase, RADIO_INTERACCION } from "./base/RoomExteriorBase";
import { cargarMapaColision, MapaCargado } from "../mundo/mapaColision";
import { rutaDeMapaId } from "../mundo/resolverMapa";
import { NpcBakeado } from "../mundo/agentes";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { GestorFauna, FaunaSpawn } from "../mundo/fauna";
import { cargarCatalogoCombateFauna, CatalogoCombateFauna } from "../mundo/catalogoCombateFauna";
import { asegurarAsentamientoBandido } from "../mundo/economiaAsentamientos";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { cargarParcelasDeReservas } from "../construccion/parcelas";
import { esJarlGlobal } from "../construccion/construccion";
import { ventaJugadorPermitida, precioInmueble } from "../propiedades/propiedades";
import { quitarItem } from "../inventario/inventario";
import { sincronizarContenedor } from "../inventario/sincronizarSchema";

// Mascotas (docs/GDD_Mascotas.md, pedido 2026-08-30): "si se les da de comer
// unas 5 veces, podrás convertirlo en tu mascota" — SOLO fauna urbana
// domesticable (perro/gato, catalogoCombate.domesticable), y solo aquí:
// RegionRoom es la única room con fauna urbana viva (GestorFauna).
const VECES_COMIDA_PARA_DOMESTICAR = 5;

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
  // Progreso de domesticación (docs/GDD_Mascotas.md) — EN MEMORIA, vive y
  // muere con la room (mismo criterio que craftesEnCurso/inputs): si se
  // reinicia el servidor a medias, se pierde el progreso, aceptable en v1.
  // Solo cuenta quien esté alimentando ACTUALMENTE: si otro jugador le da de
  // comer al mismo animal, el progreso se reinicia a su nombre (evita que
  // dos desconocidos se "repartan" la misma mascota sin querer).
  private progresoDomesticar = new Map<string, { sessionId: string; veces: number }>();

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
    const rutaPoblacion = path.join(rutaMapa, "poblacion.json");
    if (fs.existsSync(rutaPoblacion)) {
      const poblacion = JSON.parse(fs.readFileSync(rutaPoblacion, "utf8")) as { npcs: NpcBakeado[] };
      // obtenerOCrearGestorAgentes (docs/GDD_Produccion.md): mismo gestor
      // que usará un futuro NPC transportista en esta región — un único
      // GestorAgentes por room, un único tick, nunca dos relojes distintos.
      const gestor = this.obtenerOCrearGestorAgentes();
      gestor.iniciar(poblacion.npcs, tiempoMundo().hora);
      console.log(`  ${gestor.cantidad} NPCs con rutina en el mapa`);
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
      };
      if (indice.tier === "asentamiento_hostil") {
        const bd = await obtenerBdCompartida();
        await asegurarAsentamientoBandido(bd, options.mapaId);
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
    const contenedor = this.inventarios.get(client.sessionId);
    if (!player || !contenedor) return;

    let faunaId: string | null = null;
    let mejorDist = RADIO_INTERACCION;
    this.state.fauna.forEach((f, id) => {
      if (!this.catalogoCombateFauna[f.especieId]?.domesticable) return;
      const d = Math.hypot(f.x - player.x, f.y - player.y);
      if (d < mejorDist) { mejorDist = d; faunaId = id; }
    });
    if (!faunaId) return client.send("mascota:error", { motivo: "nada_cerca" });

    const it = contenedor.items.find((i) => this.catalogoItems[i.itemId]?.comidaMascota === true);
    if (!it) return client.send("mascota:error", { motivo: "sin_comida" });
    const resultado = quitarItem(contenedor, it.id, 1);
    if (!resultado.ok) return client.send("mascota:error", { motivo: resultado.motivo ?? "sin_comida" });
    sincronizarContenedor(player.inventario.cuerpo, contenedor);

    let progreso = this.progresoDomesticar.get(faunaId);
    if (!progreso || progreso.sessionId !== client.sessionId) progreso = { sessionId: client.sessionId, veces: 0 };
    progreso.veces++;

    if (progreso.veces >= VECES_COMIDA_PARA_DOMESTICAR) {
      this.progresoDomesticar.delete(faunaId);
      const especieId = this.state.fauna.get(faunaId)!.especieId;
      this.gestorFauna.quitar(faunaId);
      void this.crearMascota(client, especieId).then((mascota) => {
        client.send("mascota:domesticada", { mascotaId: mascota.id, especieId });
      });
    } else {
      this.progresoDomesticar.set(faunaId, progreso);
      client.send("mascota:progreso", { faunaId, veces: progreso.veces, faltan: VECES_COMIDA_PARA_DOMESTICAR - progreso.veces });
    }
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

    this.onMessage("inmueble:comprar", (client, msg: { inmuebleId?: string }) => this.manejarInmuebleAdquirir(client, mapaId, msg?.inmuebleId, "compra"));
    this.onMessage("inmueble:alquilar", (client, msg: { inmuebleId?: string }) => this.manejarInmuebleAdquirir(client, mapaId, msg?.inmuebleId, "alquiler"));

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
      const nombre = this.nombreDe(client);
      if (!nombre || !esJarlGlobal(nombre)) return client.send("inmueble:error", { motivo: "solo el jarl revoca propiedades" });
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

  private async manejarInmuebleAdquirir(client: Client, mapaId: string, inmuebleId: string | undefined, modo: "compra" | "alquiler") {
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
}
