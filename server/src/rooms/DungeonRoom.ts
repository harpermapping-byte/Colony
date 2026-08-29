import { InteriorRoom, OpcionesInterior } from "./InteriorRoom";
import { Enemigo } from "./schema/HubState";
import { IAlmacenDatos } from "../datos/bd";
import { obtenerBdCompartida } from "../datos/bdCompartida";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const enemigos: Record<string, { temasEnemigo: string[]; pesoSpawn?: number; esBoss?: boolean }> = require("../../../personajes/catalogo/enemigos.json");

// Debe coincidir con el nº de variantes con el que se corrió
// personajes/src/exportar_enemigos.js al generar assets/enemigos/pool.json
// (el aspecto se generó offline, una vez — el servidor solo elige el índice).
const VARIANTES_POR_ENEMIGO = 3;

// Techo de enemigos activos a la vez (pedido explícito del streamer: "se
// generan el límite de 30 enemigos 2 boses aleatoriamente") — el bake puede
// traer muchos más puntos candidatos que esto; es intencional, así cada
// visita puebla zonas distintas de las mismas ~200 posibles.
const LIMITE_ENEMIGOS_NORMALES = 30;
const LIMITE_BOSSES = 2;
const COOLDOWN_MS = 60 * 60 * 1000; // 1h tras limpiarla (§4.2 del GDD)

function elegirEnemigoDeTema(temas: string[], soloBosses: boolean): string | null {
  const candidatos = Object.entries(enemigos).filter(
    ([, def]) => !!def.esBoss === soloBosses && (def.temasEnemigo || []).some((t) => temas.includes(t)),
  );
  if (candidatos.length === 0) return null;
  const pesoTotal = candidatos.reduce((s, [, def]) => s + (def.pesoSpawn ?? 10), 0);
  let r = Math.random() * pesoTotal;
  for (const [id, def] of candidatos) {
    r -= def.pesoSpawn ?? 10;
    if (r <= 0) return id;
  }
  return candidatos[candidatos.length - 1][0];
}

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
      this.state.enemigos.set(`e_${n++}`, e);
    }
    console.log(`  Mazmorra "${clave}": ${n} enemigo(s) activo(s) (de ${this.interior.spawnsEnemigos.length} puntos candidatos).`);
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
