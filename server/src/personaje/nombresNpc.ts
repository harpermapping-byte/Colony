/**
 * Nombres de NPC — políticos españoles (pedido 2026-08-30, "meme de la
 * comunidad del streamer": TODO NPC generado, sea aldeano, tutorial,
 * bandido o contratado, sale del MISMO listado de políticos españoles de
 * cualquier partido desde el inicio de la democracia — nunca los jugadores,
 * solo NPC). Fuente única: `poblacion/catalogo/nombres.json` (mismo
 * catálogo que consume `poblacion/src/generarIdentidad.js` para aldeas) —
 * este módulo es el equivalente en TypeScript para los NPC que el servidor
 * nombra FUERA del pipeline de poblacion/ (bandidos, NPC transportista
 * contratado por un jugador).
 *
 * Mismo mecanismo que generarIdentidad.js: la mayoría de las veces un
 * nombre+apellidos REAL tal cual (la gracia del meme), el resto remezcla
 * nombre de una persona con apellidos de otra — "si se acaban esos
 * nombres, se generan a partir de primer nombre de uno con apellido de
 * otro", pedido literal, así la lista nunca se queda corta.
 */
import * as fs from "fs";
import * as path from "path";

interface PersonaCatalogo {
  nombre: string;
  apellidos: string;
  sexo: "m" | "f";
}
interface CatalogoNombres {
  masculinos: [string, number][];
  femeninos: [string, number][];
  apellidos: [string, number][];
  parejas: PersonaCatalogo[];
}

const RUTA_CATALOGO = path.join(__dirname, "..", "..", "..", "poblacion", "catalogo", "nombres.json");
let catalogoCache: CatalogoNombres | null = null;

function cargarCatalogoNombres(): CatalogoNombres {
  if (!catalogoCache) catalogoCache = JSON.parse(fs.readFileSync(RUTA_CATALOGO, "utf8")) as CatalogoNombres;
  return catalogoCache;
}

/** PRNG determinista pequeño (mulberry32) — MISMA fórmula que interiores/src/azar.js::crearPRNG, portada a TS para no depender de un require de otro paquete. */
function crearPRNG(semillaTexto: string): () => number {
  let h = 1779033703 ^ semillaTexto.length;
  for (let i = 0; i < semillaTexto.length; i++) {
    h = Math.imul(h ^ semillaTexto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function siguiente(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function elegirPonderado(lista: [string, number][], rnd: () => number): string {
  const total = lista.reduce((s, [, peso]) => s + peso, 0);
  let tirada = rnd() * total;
  for (const [valor, peso] of lista) {
    tirada -= peso;
    if (tirada <= 0) return valor;
  }
  return lista[lista.length - 1][0];
}

const PROB_PAREJA_REAL = 0.7;

/**
 * Nombre completo determinista por semilla — "Nombre Apellidos", mismo
 * mecanismo que `generarIdentidad.js` (real la mayoría de las veces,
 * remix el resto). Sin `sexoPreferido`, elige entre ambos géneros con la
 * misma semilla (no hace falta más detalle para un bandido/carretero, que
 * no tiene un campo `sexo` propio hoy).
 */
export function nombrePoliticoDeterminista(semilla: string, sexoPreferido?: "m" | "f"): string {
  const catalogo = cargarCatalogoNombres();
  const rnd = crearPRNG(`${semilla}|nombrePolitico`);
  if (catalogo.parejas.length && rnd() < PROB_PAREJA_REAL) {
    const candidatas = sexoPreferido ? catalogo.parejas.filter((p) => p.sexo === sexoPreferido) : catalogo.parejas;
    if (candidatas.length) {
      const elegida = candidatas[Math.floor(rnd() * candidatas.length)];
      return `${elegida.nombre} ${elegida.apellidos}`;
    }
  }
  const listaNombres = sexoPreferido === "f" ? catalogo.femeninos : sexoPreferido === "m" ? catalogo.masculinos : rnd() < 0.5 ? catalogo.femeninos : catalogo.masculinos;
  const nombre = elegirPonderado(listaNombres, rnd);
  const apellido = elegirPonderado(catalogo.apellidos, rnd);
  return `${nombre} ${apellido}`;
}
