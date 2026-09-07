/**
 * Fauna doméstica urbana (GDD_Agentes_Moviles.md v1.3, pedido del streamer
 * 2026-08-28): gallinas, alguna vaca suelta, perros, gatos, algún gallo —
 * cerebro de MERODEO simple (el que quedó pendiente en el diseño
 * original): sin rutina horaria, sin censo, sin caminos bakeados. Cada
 * animal alterna QUIETO (comer/sentarse/jugar/dormir, una pausa al azar) y
 * CAMINANDO en línea recta a un punto al azar dentro de su radio de
 * merodeo — si la línea no es transitable se prueba otro punto; nunca A*.
 *
 * A diferencia de los NPC, esto es comportamiento AMBIENTAL en vivo, no
 * datos bakeados: usa Math.random() a propósito (no hay nada que
 * determinismo por semilla deba reproducir aquí — solo dónde APARECE cada
 * animal es determinista, eso lo decide ciudades/src/fauna.js al hornear).
 *
 * Hambre/sed + reproducción "más fácil" (2026-09-08, pedido streamer,
 * mismo GDD "Domésticos: pendiente"): SOLO para especies presentes en
 * `catalogoReproduccion` (inyectado, opcional) — reusa las mismas reglas
 * puras de `reproduccionFauna.ts` que ya usa la fauna salvaje (beber 1
 * vez/día, comer según dieta, gestación/maduración por tamaño), con una
 * única diferencia real a propósito: `PROBABILIDAD_APAREAMIENTO_DOMESTICO`
 * más alta que el 0.5 salvaje — están acotados en la ciudad, sin
 * depredadores ni competencia por el territorio, así que críar es más
 * fácil (mismo razonamiento ya documentado para la ganadería real). Sin
 * `catalogoReproduccion` (llamada antigua), o para una especie ausente de
 * él, el comportamiento es EXACTAMENTE el de antes — cero regresión.
 *
 * Alcance real, a propósito: SIN PERSISTENCIA todavía (se pierde al
 * reiniciar el servidor, igual que el resto de esta fauna urbana hasta
 * hoy) — la fauna salvaje sí persiste porque su volumen y su papel en la
 * economía de caza lo justifican; esta es decoración ambiental de ciudad,
 * mucho más barata de dejar en memoria. Persistirla de verdad (tabla BD +
 * wiring) queda como posible ampliación futura si hace falta de verdad.
 */
import { MapSchema } from "@colyseus/schema";
import { Fauna } from "../rooms/schema/HubState";
import { MundoColision, TIPO } from "./colisiones";
import { CatalogoCombateFauna, estadisticasCombatePorDefecto } from "./catalogoCombateFauna";
import { CatalogoEspecies } from "./faunaSalvajeSector";
import { SexoFauna } from "../datos/bd";
import {
  AnimalReproductor,
  Huevo,
  buscarPareja,
  huevoEclosiona,
  intentarAparearse,
  necesitaAgua,
  necesitaComida,
  resolverParto,
  tocaDarALuz,
  tocaMadurar,
} from "./reproduccionFauna";

export interface FaunaSpawn {
  id: string;
  especieId: string;
  x: number;
  y: number;
  radio: number;
}

const VEL_FAUNA = 1.1; // más lenta que un NPC — los animales pasean, no van a ningún sitio
const ACCIONES_IDLE = ["comer", "sentarse", "jugar", "dormir"];
const RADIO_BUSQUEDA_AGUA = 15; // casillas — mismo valor que faunaSalvajeViva.ts, misma lógica de anillos crecientes
const RADIO_APAREAMIENTO_DOMESTICO = 8; // una ciudad pequeña cabe entera en este radio — no hace falta más
// "Más fácil" que la fauna salvaje (0.5, reproduccionFauna.ts) — acotados,
// sin depredadores, sin competir por territorio (pedido streamer 2026-09-08).
const PROBABILIDAD_APAREAMIENTO_DOMESTICO = 0.85;
const RADIO_MERODEO_CRIA_NUEVA = 4; // una cría nacida en el sistema no tiene spawn/radio propio del bake — valor por defecto razonable

interface EstadoFauna {
  id: string;
  spawn: { x: number; y: number };
  radio: number;
  esquema: Fauna;
  destino: { x: number; y: number } | null;
  /** por qué va hacia `destino`: "agua" = al llegar bebe. Mismo patrón que faunaSalvajeViva.ts. */
  objetivoDestino: "agua" | null;
  pausaRestante: number;
  /** null = especie sin datos de reproducción (catalogoReproduccion no la cubre) — comportamiento decorativo puro, sin cambio. */
  reproductor: AnimalReproductor | null;
}

function transitable(mundo: MundoColision, x: number, y: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= mundo.ancho || yi >= mundo.alto) return false;
  return mundo.casillas[yi * mundo.ancho + xi] !== TIPO.SOLIDO;
}

function accionIdleAlAzar(): string {
  return ACCIONES_IDLE[Math.floor(Math.random() * ACCIONES_IDLE.length)];
}

let contadorIdsNuevos = 0;

export class GestorFauna {
  private animales: EstadoFauna[] = [];
  private huevos: Huevo[] = [];

  constructor(
    private salida: MapSchema<Fauna>,
    private mundo: MundoColision,
    // Vida/ataque (docs/GDD_Mecanicas.md §5.4) — opcional, con relleno
    // seguro si no se pasa (no rompe a quien instanciaba esto antes de
    // que existiera combate).
    private catalogoCombate: CatalogoCombateFauna = {},
    // Hambre/sed + reproducción (ver cabecera) — opcional, especie por
    // especie: una especie ausente de este catálogo se queda con el
    // comportamiento decorativo de siempre, sin romper nada.
    private catalogoReproduccion: CatalogoEspecies = {},
    // Día de mundo fraccional — inyectado (no Date.now() aquí) para poder
    // testear con un reloj fijo, mismo criterio que faunaSalvajeViva.ts.
    private ahora: () => number = () => 0,
    // Solo para el sexo/apareamiento (reproducción) — el resto del módulo
    // sigue usando Math.random() a propósito (ver cabecera: el MERODEO no
    // necesita ser determinista, solo la reproducción para poder testearla).
    private rnd: () => number = Math.random,
  ) {}

  iniciar(spawns: FaunaSpawn[]) {
    const ahora = this.ahora();
    for (const s of spawns) {
      // el spawn cayó en un sólido tras rebakear el asentamiento: se
      // descarta en vez de aparecer dentro de una pared — no rompe nada
      if (!transitable(this.mundo, s.x, s.y)) continue;
      const esquema = new Fauna();
      esquema.x = s.x + 0.5;
      esquema.y = s.y + 0.5;
      esquema.especieId = s.especieId;
      esquema.accion = accionIdleAlAzar();
      const combate = this.catalogoCombate[s.especieId] ?? estadisticasCombatePorDefecto();
      esquema.vida = combate.vidaMaxima;
      esquema.vidaMax = combate.vidaMaxima;
      esquema.ataque = combate.ataque;
      this.salida.set(s.id, esquema);
      const especie = this.catalogoReproduccion[s.especieId];
      const reproductor: AnimalReproductor | null = especie
        ? {
            id: s.id,
            especieId: s.especieId,
            sexo: (this.rnd() < 0.5 ? "macho" : "hembra") as SexoFauna,
            etapa: "adulto",
            vivo: true,
            x: s.x,
            y: s.y,
            ultimaComida: ahora,
            ultimaBebida: ahora,
            gestandoDesde: null,
            gestacionDuracionDias: null,
            nacioEn: null,
          }
        : null;
      this.animales.push({
        id: s.id,
        spawn: { x: s.x, y: s.y },
        radio: s.radio,
        esquema,
        destino: null,
        objetivoDestino: null,
        pausaRestante: 1 + Math.random() * 3,
        reproductor,
      });
    }
  }

  /**
   * Saca un individuo del merodeo (docs/GDD_Mascotas.md — domesticado tras
   * 5x "dar de comer"): deja de tickearse Y desaparece del Schema, quien
   * llama es responsable de darle su nueva vida (mascota siguiendo al
   * jugador, otro Schema aparte). `false` si el id no existe (ya se quitó,
   * o nunca fue un spawn de esta room).
   */
  quitar(id: string): boolean {
    const idx = this.animales.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    this.animales.splice(idx, 1);
    this.salida.delete(id);
    return true;
  }

  tick(dt: number) {
    const ahora = this.ahora();
    for (const a of this.animales) {
      // Hambre/sed (solo especies con datos de reproducción, ver
      // cabecera) — MISMA prioridad y comportamiento que faunaSalvajeViva.ts:
      // sed siempre manda (busca agua y bebe al llegar), comida de
      // herbívoro/omnívoro se resuelve donde está (los carnívoros no
      // tienen comportamiento activo, igual que en la fauna salvaje).
      if (a.reproductor && a.reproductor.etapa === "adulto" && !a.destino) {
        const especie = this.catalogoReproduccion[a.reproductor.especieId];
        if (especie && necesitaAgua(a.reproductor, ahora)) {
          const destinoAgua = this.buscarAguaCercana(a.esquema.x, a.esquema.y);
          if (destinoAgua) {
            a.destino = destinoAgua;
            a.objetivoDestino = "agua";
            a.esquema.accion = "caminar";
            continue;
          }
        } else if (especie && especie.dieta !== "carnivoro" && necesitaComida(a.reproductor, especie, ahora)) {
          a.reproductor.ultimaComida = ahora;
          a.esquema.accion = "comer";
          a.pausaRestante = 2 + Math.random() * 2;
          continue;
        }
      }

      if (a.destino) {
        this.avanzarHaciaDestino(a, dt, ahora);
        continue;
      }
      a.pausaRestante -= dt;
      if (a.pausaRestante > 0) continue;
      const destino = this.elegirDestino(a);
      if (destino) {
        a.destino = destino;
        a.objetivoDestino = null;
        a.esquema.accion = "caminar";
      } else {
        // 6 intentos sin encontrar un punto transitable (radio muy
        // pequeño/atascado): otra pausa idle en vez de insistir cada frame
        a.pausaRestante = 2;
        a.esquema.accion = accionIdleAlAzar();
      }
    }
  }

  /**
   * Resuelve reproducción (huevos que eclosionan, partos, maduración de
   * crías, nuevos apareamientos) — llamar a baja frecuencia (segundos
   * reales, NUNCA cada tick de merodeo): mismo criterio anti-explosión que
   * `faunaSalvajeSector.ts::resolverSector` — una tirada por pareja
   * elegible cada vez que se llama, nunca una por unidad de tiempo
   * transcurrida. No hace nada con especies fuera de `catalogoReproduccion`.
   */
  resolverReproduccion() {
    if (Object.keys(this.catalogoReproduccion).length === 0) return;
    const ahora = this.ahora();

    // 1) Huevos que ya deberían haber eclosionado.
    const huevosRestantes: Huevo[] = [];
    for (const h of this.huevos) {
      if (huevoEclosiona(h, ahora)) {
        const especie = this.catalogoReproduccion[h.especieMadreId];
        if (especie) this.nacerCrias(resolverParto(h.especieMadreId, especie).criasEspecieId, h.x, h.y, ahora);
      } else {
        huevosRestantes.push(h);
      }
    }
    this.huevos = huevosRestantes;

    // 2) Gestaciones ya cumplidas.
    for (const a of this.animales) {
      if (!a.reproductor || !tocaDarALuz(a.reproductor, ahora)) continue;
      const especie = this.catalogoReproduccion[a.reproductor.especieId];
      if (especie) this.nacerCrias(resolverParto(a.reproductor.especieId, especie).criasEspecieId, a.esquema.x, a.esquema.y, ahora);
      a.reproductor.gestandoDesde = null;
      a.reproductor.gestacionDuracionDias = null;
    }

    // 3) Crías que ya maduraron.
    for (const a of this.animales) {
      if (!a.reproductor || a.reproductor.etapa !== "cria") continue;
      const especie = this.catalogoReproduccion[a.reproductor.especieId];
      if (especie && tocaMadurar(a.reproductor, especie.tamanoReproduccion, ahora)) {
        a.reproductor.etapa = "adulto";
        a.reproductor.ultimaComida = ahora;
        a.reproductor.ultimaBebida = ahora;
      }
    }

    // 4) Nuevos apareamientos — una tirada por macho elegible, pareja más
    // cercana dentro de RADIO_APAREAMIENTO_DOMESTICO.
    const reproductoresVivos = this.animales.filter((a) => a.reproductor?.vivo).map((a) => a.reproductor!);
    const yaIntentado = new Set<string>();
    for (const a of reproductoresVivos) {
      if (a.sexo !== "macho" || a.etapa !== "adulto" || yaIntentado.has(a.id)) continue;
      const especie = this.catalogoReproduccion[a.especieId];
      if (!especie) continue;
      const candidatas = reproductoresVivos.filter((c) => c.id !== a.id && !yaIntentado.has(c.id));
      const pareja = buscarPareja(a, especie, candidatas, RADIO_APAREAMIENTO_DOMESTICO, ahora);
      if (!pareja) continue;
      yaIntentado.add(a.id);
      yaIntentado.add(pareja.id);
      const resultado = intentarAparearse(a, pareja, especie, ahora, this.rnd, PROBABILIDAD_APAREAMIENTO_DOMESTICO);
      if (resultado.exito && resultado.huevo) this.huevos.push(resultado.huevo);
    }
  }

  private nacerCrias(especiesId: string[], x: number, y: number, ahora: number) {
    for (const especieCriaId of especiesId) {
      const especieCria = this.catalogoReproduccion[especieCriaId];
      const combate = this.catalogoCombate[especieCriaId] ?? estadisticasCombatePorDefecto();
      const id = `domestica:cria:${ahora}:${contadorIdsNuevos++}`;
      const esquema = new Fauna();
      esquema.x = x + 0.5;
      esquema.y = y + 0.5;
      esquema.especieId = especieCriaId;
      esquema.accion = accionIdleAlAzar();
      esquema.vida = combate.vidaMaxima;
      esquema.vidaMax = combate.vidaMaxima;
      esquema.ataque = combate.ataque;
      this.salida.set(id, esquema);
      const reproductor: AnimalReproductor | null = especieCria
        ? {
            id,
            especieId: especieCriaId,
            sexo: (this.rnd() < 0.5 ? "macho" : "hembra") as SexoFauna,
            etapa: "cria",
            vivo: true,
            x,
            y,
            ultimaComida: ahora,
            ultimaBebida: ahora,
            gestandoDesde: null,
            gestacionDuracionDias: null,
            nacioEn: ahora,
          }
        : null;
      this.animales.push({
        id,
        spawn: { x, y },
        radio: RADIO_MERODEO_CRIA_NUEVA,
        esquema,
        destino: null,
        objetivoDestino: null,
        pausaRestante: 1 + Math.random() * 3,
        reproductor,
      });
    }
  }

  /** Mismo algoritmo de anillos crecientes que `faunaSalvajeViva.ts::buscarAguaCercana` — duplicado a propósito, mismo criterio de módulos independientes que ya documenta la cabecera del fichero (esta fauna urbana no depende de la salvaje). */
  private buscarAguaCercana(cx: number, cy: number): { x: number; y: number } | null {
    const m = this.mundo;
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    for (let r = 1; r <= RADIO_BUSQUEDA_AGUA; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = x0 + dx;
          const y = y0 + dy;
          if (x < 0 || y < 0 || x >= m.ancho || y >= m.alto) continue;
          const t = m.casillas[y * m.ancho + x];
          if (t === TIPO.AGUA || t === TIPO.AGUA_PROFUNDA) return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return null;
  }

  private elegirDestino(a: EstadoFauna): { x: number; y: number } | null {
    for (let intento = 0; intento < 6; intento++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * a.radio;
      const cx = a.spawn.x + Math.cos(ang) * dist;
      const cy = a.spawn.y + Math.sin(ang) * dist;
      if (transitable(this.mundo, cx, cy)) return { x: cx + 0.5, y: cy + 0.5 };
    }
    return null;
  }

  private avanzarHaciaDestino(a: EstadoFauna, dt: number, ahora: number) {
    const dx = a.destino!.x - a.esquema.x;
    const dy = a.destino!.y - a.esquema.y;
    const dist = Math.hypot(dx, dy);
    const paso = VEL_FAUNA * dt;
    if (dist <= paso) {
      a.esquema.x = a.destino!.x;
      a.esquema.y = a.destino!.y;
      if (a.objetivoDestino === "agua" && a.reproductor) a.reproductor.ultimaBebida = ahora;
      if (a.reproductor) { a.reproductor.x = a.esquema.x; a.reproductor.y = a.esquema.y; }
      a.destino = null;
      a.objetivoDestino = null;
      a.pausaRestante = 2 + Math.random() * 4;
      a.esquema.accion = accionIdleAlAzar();
    } else {
      a.esquema.x += (dx / dist) * paso;
      a.esquema.y += (dy / dist) * paso;
      if (a.reproductor) { a.reproductor.x = a.esquema.x; a.reproductor.y = a.esquema.y; }
    }
  }

  get cantidad() {
    return this.animales.length;
  }

  /** Estado reproductivo de un individuo por id — `null` si no existe o su especie está fuera de `catalogoReproduccion`. Solo para tests/depuración (mismo criterio que `cantidad`/`sectoresCargados` en GestorFaunaSalvaje). */
  estadoReproductivo(id: string): AnimalReproductor | null {
    return this.animales.find((a) => a.id === id)?.reproductor ?? null;
  }
}
