import { InteriorRoom, OpcionesInterior } from "./InteriorRoom";
import { Enemigo } from "./schema/HubState";
import { IAlmacenDatos } from "../datos/bd";
import { obtenerBdCompartida } from "../datos/bdCompartida";
import { elegirEnemigoDeTema, VARIANTES_POR_ENEMIGO } from "../mundo/catalogoEnemigos";
import { generarLootBoss, generarLootNormal } from "../mundo/lootProcedural";
import { GestorEnemigosMazmorra } from "../mundo/enemigosMazmorra";
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
  private gestorEnemigos: GestorEnemigosMazmorra | null = null;

  async onCreate(options: OpcionesInterior) {
    await super.onCreate(options);
    this.bd = await obtenerBdCompartida();
    await this.poblarEnemigos();

    // Movimiento + agro real (docs/GDD_Combate.md §4bis, pedido streamer
    // 2026-09-07: "moverse correr pelearse morir") — mismo tick de baja
    // frecuencia (200ms) que ya usan Hub/Region para fauna/patrullas
    // bandidas; sin enemigos poblados (mazmorra en cooldown), el gestor
    // simplemente no tiene nada que tickear.
    this.gestorEnemigos = new GestorEnemigosMazmorra(this.state.enemigos, this.interior);
    this.gestorEnemigos.registrarExistentes();
    this.clock.setInterval(() => this.gestorEnemigos!.tick(0.2), 200);
    this.clock.setInterval(() => this.verificarAgroFauna(), 200);
  }

  /** Misma clave que usa `mazmorras_estado` (cooldown de limpieza, §4.2/§7 del GDD) — un único sitio para no arriesgar que las dos fórmulas se desincronicen. */
  private claveMazmorra(): string {
    return `${this.opciones.mapaId}:${this.opciones.edificio}:${this.interior.nivel}`;
  }

  // `this.opciones`/`this.interior` (ya poblados por super.onCreate) traen
  // todo lo necesario — el parámetro `options` que recibía antes nunca se
  // leía en el cuerpo (dead param, tsc --noUnusedParameters lo confirma).
  private async poblarEnemigos() {
    const clave = this.claveMazmorra();
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
   * Loot procedural de cadáver — TODO enemigo de mazmorra ya deja cadáver
   * looteable (2026-09-07, cierra el gap "solo boss humanoide tenía loot",
   * ver docs/GDD_Combate.md §4bis): jefes (humanoides o animales, ya no
   * distingue) usan el pool grande de `catalogoLootBoss.json`
   * (`generarLootBoss`, 2-4 piezas de equipo real), enemigos normales usan
   * el pool pequeño de `catalogoLootNormal.json` (`generarLootNormal`,
   * 0-1 material común) — con hasta 30 normales por visita
   * (LIMITE_ENEMIGOS_NORMALES), darles el mismo pool que un boss inundaría
   * la economía de armas/armaduras.
   */
  protected async finalizarMuerte(id: string, jugadoresGanadores: string[] = []) {
    const enemigo = this.state.enemigos.get(id);
    const eraEnemigo = !!enemigo; // capturar ANTES de que super.finalizarMuerte borre la entidad del Schema
    if (!enemigo) {
      await super.finalizarMuerte(id, jugadoresGanadores);
      return;
    }

    // Leer posición/id ANTES de super.finalizarMuerte(id) — borra la entidad del Schema (state.enemigos.delete).
    const x = enemigo.x;
    const y = enemigo.y;
    const enemigoId = enemigo.enemigoId;
    const variante = enemigo.variante;
    const esBoss = enemigo.esBoss;
    await super.finalizarMuerte(id, jugadoresGanadores);
    this.gestorEnemigos?.quitar(id); // deja de tickear/merodear un enemigo ya muerto
    if (eraEnemigo) await this.comprobarMazmorraLimpiada();

    const cadaver = crearCadaver({
      id: `cadaver:${this.opciones.mapaId}:${this.opciones.edificio}:${id}`,
      mapaId: this.opciones.mapaId,
      tipoOrigen: "npc",
      especieOrigenId: enemigoId,
      x, y,
      ahora: diaFraccional(tiempoMundo().dia, tiempoMundo().hora),
      // Mismo pool que renderiza al enemigo VIVO (docs/GDD_Bakeador_Dungeons.md
      // §4, client `poolEnemigos[enemigoId][variante]`) — el cadáver sale
      // con la MISMA figura, no un rig plano genérico.
      datosVisual: { enemigoId, variante },
    });
    const loot = esBoss ? generarLootBoss() : generarLootNormal();
    for (const { itemId, cantidad } of loot) agregarItem(cadaver.contenedor, this.catalogoItems, itemId, cantidad);
    this.publicarCadaver(cadaver);
  }

  /**
   * Trigger real de "mazmorra limpiada" (docs/GDD_Combate.md, docs/GDD_Bakeador_Dungeons.md
   * §4.2/§7, pedido 2026-09-01) — se llama tras CADA muerte de `Enemigo` de
   * esta mazmorra (nunca de jugador/fauna/npc, ver `eraEnemigo` arriba). Si
   * `state.enemigos` se queda vacío, arranca el cooldown de 1h que
   * `poblarEnemigos` ya comprobaba desde el principio (antes de esta
   * pasada, nada lo activaba nunca de verdad). Idempotente: si dos muertes
   * llegasen a resolverse "a la vez" (no debería, `finalizarMuerte` es
   * secuencial), `marcarMazmorraLimpiada` hace UPDATE-o-INSERT, nunca
   * duplica fila.
   */
  private async comprobarMazmorraLimpiada(): Promise<void> {
    if (this.state.enemigos.size > 0) return;
    await this.bd.marcarMazmorraLimpiada(this.claveMazmorra());
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
