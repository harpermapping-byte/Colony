import { InteriorRoom, OpcionesInterior } from "./InteriorRoom";
import { Enemigo } from "./schema/HubState";
import { IAlmacenDatos } from "../datos/bd";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { elegirEnemigoDeTema, VARIANTES_POR_ENEMIGO, esEnemigoHumanoide } from "../mundo/catalogoEnemigos";
import { generarLootBoss } from "../mundo/lootProcedural";
import { crearCadaver } from "../mundo/cadaveres";
import { agregarItem } from "../inventario/inventario";
import { tiempoMundo } from "../mundo/tiempoMundo";
import { diaFraccional } from "../mundo/reproduccionFauna";

// Techo de enemigos activos a la vez (pedido explícito del streamer: "se
// generan el límite de 30 enemigos 2 boses aleatoriamente") — el bake puede
// traer muchos más puntos candidatos que esto; es intencional, así cada
// visita puebla zonas distintas de las mismas ~200 posibles.
const LIMITE_ENEMIGOS_NORMALES = 30;
const LIMITE_BOSSES = 2;

// Vida/ataque/defensa por defecto (docs/GDD_Mecanicas.md §5.4, docs/GDD_Combate.md)
// — placeholder de balance, mismo criterio que otros números de referencia del
// proyecto (pesoMaximoTransportable, etc.): sin catálogo de stats por
// enemigoId todavía, un boss simplemente vale mucho más que uno normal.
const VIDA_ENEMIGO_NORMAL = 40;
const ATAQUE_ENEMIGO_NORMAL = 8;
const DEFENSA_ENEMIGO_NORMAL = 4;
const VIDA_ENEMIGO_BOSS = 150;
const ATAQUE_ENEMIGO_BOSS = 20;
const DEFENSA_ENEMIGO_BOSS = 10;
const COOLDOWN_MS = 60 * 60 * 1000; // 1h tras limpiarla (§4.2 del GDD)

/**
 * Interior de mazmorra — docs/GDD_Bakeador_Dungeons.md. Hereda TAL CUAL de
 * InteriorRoom (carga por nivel, escaleras=TP, salida solo desde planta
 * baja: una mazmorra usa el MISMO sistema de instancia/portales que
 * cualquier edificio, "seguir esas mismas reglas" pedido explícito) y
 * añade la población de enemigos: el bake coloca muchos puntos CANDIDATOS
 * (`interior.spawnsEnemigos`), aquí se elige en RUNTIME un subconjunto
 * acotado — así cada visita repuebla zonas distintas de la mazmorra, no
 * siempre las mismas. Compartida entre jugadores como cualquier otra room
 * (filterBy mapaId+edificio+nivel, igual que InteriorRoom) — quien entra
 * ve la mazmorra como esté, limpia o en cooldown.
 */
export class DungeonRoom extends InteriorRoom {
  private bd!: IAlmacenDatos;

  async onCreate(options: OpcionesInterior) {
    await super.onCreate(options);
    this.bd = await obtenerBdCompartida();
    await this.poblarEnemigos(options);
  }

  private async poblarEnemigos(options: OpcionesInterior) {
    const clave = `${options.mapaId}:${options.edificio}:${this.interior.nivel}`;
    const limpiadaEn = await this.bd.obtenerLimpiezaMazmorra(clave);
    if (limpiadaEn && Date.now() - new Date(limpiadaEn).getTime() < COOLDOWN_MS) {
      console.log(`  Mazmorra "${clave}" en cooldown tras limpiarla — sin enemigos esta visita.`);
      return;
    }

    const candidatosNormales = this.interior.spawnsEnemigos.filter((s) => !s.esBossSlot);
    const candidatosBoss = this.interior.spawnsEnemigos.filter((s) => s.esBossSlot);
    const elegidosNormales = barajarYCortar(candidatosNormales, LIMITE_ENEMIGOS_NORMALES);
    const elegidosBoss = barajarYCortar(candidatosBoss, LIMITE_BOSSES);

    let n = 0;
    for (const spawn of [...elegidosNormales, ...elegidosBoss]) {
      const enemigoId = elegirEnemigoDeTema(spawn.temasEnemigo, spawn.esBossSlot);
      if (!enemigoId) continue;
      const e = new Enemigo();
      e.x = spawn.x + 0.5;
      e.y = spawn.y + 0.5;
      e.enemigoId = enemigoId;
      e.variante = Math.floor(Math.random() * VARIANTES_POR_ENEMIGO);
      e.esBoss = spawn.esBossSlot;
      e.vida = e.esBoss ? VIDA_ENEMIGO_BOSS : VIDA_ENEMIGO_NORMAL;
      e.vidaMax = e.vida;
      e.ataque = e.esBoss ? ATAQUE_ENEMIGO_BOSS : ATAQUE_ENEMIGO_NORMAL;
      e.defensa = e.esBoss ? DEFENSA_ENEMIGO_BOSS : DEFENSA_ENEMIGO_NORMAL;
      this.state.enemigos.set(`e_${n++}`, e);
    }
    console.log(`  Mazmorra "${clave}": ${n} enemigo(s) activo(s) (de ${this.interior.spawnsEnemigos.length} puntos candidatos).`);
  }

  /**
   * Loot procedural de cadáver — SOLO jefes humanoides (pedido 2026-08-31:
   * "solo enemigos humanoide bosses no animales"). Cualquier otro enemigo
   * de mazmorra (normal, o boss animal como reina_arana/lobo_alfa) sigue
   * igual que siempre: cae directo a `super.finalizarMuerte` sin cadáver.
   */
  protected async finalizarMuerte(id: string, jugadoresGanadores: string[] = []) {
    const enemigo = this.state.enemigos.get(id);
    const esJefeHumanoide = !!enemigo?.esBoss && esEnemigoHumanoide(enemigo.enemigoId);
    if (!esJefeHumanoide) return super.finalizarMuerte(id, jugadoresGanadores);

    // Leer posición/id ANTES de super.finalizarMuerte(id) — borra la entidad del Schema (state.enemigos.delete).
    const x = enemigo!.x;
    const y = enemigo!.y;
    const enemigoId = enemigo!.enemigoId;
    await super.finalizarMuerte(id, jugadoresGanadores);

    const cadaver = crearCadaver({
      id: `cadaver:${this.opciones.mapaId}:${this.opciones.edificio}:${id}`,
      mapaId: this.opciones.mapaId,
      tipoOrigen: "npc",
      especieOrigenId: enemigoId,
      x, y,
      ahora: diaFraccional(tiempoMundo().dia, tiempoMundo().hora),
    });
    for (const { itemId, cantidad } of generarLootBoss()) agregarItem(cadaver.contenedor, this.catalogoItems, itemId, cantidad);
    this.publicarCadaver(cadaver);
  }
}

function barajarYCortar<T>(lista: T[], limite: number): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, limite);
}
