/**
 * Cofres de MUNDO de la Test Zone (pedido 2026-08-31, "montando una Test
 * Zone para probar mecánicas con 2+ jugadores"): hoy NO existe ningún
 * contenedor de mundo compartido (solo inventario personal y mochilas) —
 * esto es SOLO para pruebas, no un sistema general de cofres del juego.
 *
 * Mismo patrón que `npcsFijos.ts`: catálogo hecho a mano por mapa
 * (`assets/mapas/<mapaId>/contenedoresTest.json`, ausente = sin cofres en
 * ese mapa, nunca rompe nada) + estado en memoria del proceso (sin BD, es
 * contenido de test — un reinicio del servidor resetea los cofres, igual
 * que recolectables.ts). "Infinito": `contenedorTest:tomar` reusa
 * `agregarItem` para meterlo en el inventario del jugador pero NUNCA
 * descuenta del cofre — el mismo cofre sirve para pegarle mil veces.
 */
import * as fs from "fs";
import * as path from "path";

export interface ItemContenedorTest {
  itemId: string;
  cantidad: number;
}

export interface ContenedorTest {
  id: string;
  x: number;
  y: number;
  items: ItemContenedorTest[];
}

interface CatalogoContenedoresTest {
  contenedores: ContenedorTest[];
}

/** Lee `contenedoresTest.json` del mapa si existe; [] si no hay ninguno — nunca lanza (mismo criterio que cargarNpcsFijos). */
export function cargarContenedoresTest(rutaMapa: string): ContenedorTest[] {
  const ruta = path.join(rutaMapa, "contenedoresTest.json");
  if (!fs.existsSync(ruta)) return [];
  const datos = JSON.parse(fs.readFileSync(ruta, "utf8")) as CatalogoContenedoresTest;
  return datos.contenedores ?? [];
}

/** Vive y muere con el proceso — igual que `cachePorMapa` de recolectables.ts, un mapa sin jugadores no lo pierde mientras la room siga viva. */
const cachePorMapa = new Map<string, Map<string, ContenedorTest>>();

/** Devuelve el Map id->cofre de este mapa, cargándolo la primera vez que se pide. */
export function contenedoresTestDeMapa(rutaMapa: string): Map<string, ContenedorTest> {
  let mapa = cachePorMapa.get(rutaMapa);
  if (!mapa) {
    mapa = new Map();
    for (const c of cargarContenedoresTest(rutaMapa)) mapa.set(c.id, c);
    cachePorMapa.set(rutaMapa, mapa);
  }
  return mapa;
}
