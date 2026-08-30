/**
 * Cría de descendencia en ganadería (docs/GDD_Ganaderia.md, ampliación
 * 2026-08-30, pedido del streamer) — PURO (sin fs/BD/Colyseus), reusa
 * `reproduccionFauna.ts` TAL CUAL sobre los `AnimalGranjaFila` YA
 * domesticados/comprados de una propiedad (ver `server/src/mundo/ganaderia.ts`
 * para vallado/escape y `RoomExteriorBase.ts` para el resto del protocolo
 * `animal:*`): mayor probabilidad de apareamiento que la fauna salvaje
 * ("más fácil al tenerlos acotados y bien alimentados", pedido explícito),
 * y puesta de huevos FÍSICA en el mundo (1 en el suelo sin nido, 1 a 3 si
 * hay un `nido` en la propiedad) para las aves con un macho adulto cerca.
 */
import * as fs from "fs";
import {
  EspecieReproductiva,
  Sexo,
  Etapa,
  AnimalReproductor,
  elegibleParaAparearse,
  intentarAparearse,
  tocaDarALuz,
  tocaMadurar,
  resolverParto,
} from "./reproduccionFauna";

export interface AnimalGranjaMinimo {
  id: string;
  especieId: string;
  x: number;
  y: number;
  extra: Record<string, unknown>;
}

/**
 * Catálogo reducido a lo que hace falta para reproducción, leído del MISMO
 * `baker/catalogo/animales.json` que la fauna salvaje — pero SIN el
 * atajo de `poblacionInfinita` de `catalogoFaunaSalvaje.ts` (ese es un
 * concepto de spawn EXTERIOR que no aplica a un animal individual ya
 * domesticado y guardado en BD, como `gallina_salvaje`).
 */
export function cargarCatalogoReproduccionGranja(rutaAnimalesJson: string): Record<string, EspecieReproductiva> {
  const raw = JSON.parse(fs.readFileSync(rutaAnimalesJson, "utf8")) as Record<string, { tamanoReproduccion?: EspecieReproductiva["tamanoReproduccion"]; poneHuevos?: boolean; dieta?: EspecieReproductiva["dieta"]; criaId?: string; criasPorCamada?: number }>;
  const catalogo: Record<string, EspecieReproductiva> = {};
  for (const [id, datos] of Object.entries(raw)) {
    if (id.startsWith("_") || !datos || typeof datos !== "object" || !datos.tamanoReproduccion) continue;
    catalogo[id] = { tamanoReproduccion: datos.tamanoReproduccion, poneHuevos: !!datos.poneHuevos, dieta: datos.dieta ?? "omnivoro", criaId: datos.criaId, criasPorCamada: datos.criasPorCamada };
  }
  return catalogo;
}

export const PROBABILIDAD_EXITO_GRANJA = 0.85;
const VENTANA_PUESTA_DIAS = 1;
export const HUEVOS_SIN_NIDO = 1;
export const HUEVOS_MIN_CON_NIDO = 1;
export const HUEVOS_MAX_CON_NIDO = 3;

export interface ParejaGranja {
  machoId: string;
  hembraId: string;
}

/** Pareja macho/hembra por CLAVE (id de la hembra, salvo aves que reusan "gallina_salvaje"/"oca" ya domesticables del catálogo salvaje). */
export const PAREJAS_GRANJA: Record<string, ParejaGranja> = {
  vaca: { machoId: "toro", hembraId: "vaca" },
  oveja: { machoId: "carnero", hembraId: "oveja" },
  cabra: { machoId: "macho_cabrio", hembraId: "cabra" },
  cerda: { machoId: "cerdo", hembraId: "cerda" },
  coneja: { machoId: "conejo", hembraId: "coneja" },
  gallina: { machoId: "gallo", hembraId: "gallina_salvaje" },
  oca: { machoId: "ganso_domestico", hembraId: "oca" },
};

export function parejaDe(especieId: string): { clave: string; pareja: ParejaGranja } | null {
  for (const [clave, pareja] of Object.entries(PAREJAS_GRANJA)) {
    if (pareja.machoId === especieId || pareja.hembraId === especieId) return { clave, pareja };
  }
  return null;
}

function sexoDe(especieId: string, pareja: ParejaGranja): Sexo | null {
  if (especieId === pareja.machoId) return "macho";
  if (especieId === pareja.hembraId) return "hembra";
  return null;
}

/** Una cría (categoría "cria", sin `tamanoReproduccion` propio en el catálogo) apunta a su pareja de origen por el `criaId` compartido macho/hembra. */
function origenDeCria(criaEspecieId: string, catalogo: Record<string, EspecieReproductiva>): { tamano: EspecieReproductiva["tamanoReproduccion"]; pareja: ParejaGranja } | null {
  for (const pareja of Object.values(PAREJAS_GRANJA)) {
    const hembra = catalogo[pareja.hembraId];
    if (hembra?.criaId === criaEspecieId) return { tamano: hembra.tamanoReproduccion, pareja };
  }
  return null;
}

interface ExtraReproduccion {
  gestandoDesde: number | null;
  gestacionDuracionDias: number | null;
  nacioEn: number | null;
  ultimoHuevoEn: number | null;
}

function extraDe(fila: AnimalGranjaMinimo): ExtraReproduccion {
  const e = (fila.extra as { reproduccion?: Partial<ExtraReproduccion> } | null)?.reproduccion;
  return { gestandoDesde: e?.gestandoDesde ?? null, gestacionDuracionDias: e?.gestacionDuracionDias ?? null, nacioEn: e?.nacioEn ?? null, ultimoHuevoEn: e?.ultimoHuevoEn ?? null };
}

/** `alimentado` viene de `tieneComidaYAguaHoy(propiedadId)` (comedero+bebedero compartidos) — mismo gate que la producción de leche/lana/huevos, aplicado por igual a fertilidad. */
function comoReproductor(fila: AnimalGranjaMinimo, sexo: Sexo, etapa: Etapa, alimentado: boolean, ahora: number): AnimalReproductor {
  const r = extraDe(fila);
  return {
    id: fila.id,
    especieId: fila.especieId,
    sexo,
    etapa,
    vivo: true,
    x: fila.x,
    y: fila.y,
    ultimaComida: alimentado ? ahora : ahora - 999,
    ultimaBebida: alimentado ? ahora : ahora - 999,
    gestandoDesde: r.gestandoDesde,
    gestacionDuracionDias: r.gestacionDuracionDias,
    nacioEn: r.nacioEn,
  };
}

export interface NuevoAnimalGranja {
  especieId: string;
  x: number;
  y: number;
}

export interface HuevoPuesto {
  especieMadreId: string;
  x: number;
  y: number;
  cantidad: number;
}

export interface MaduracionGranja {
  viejoId: string;
  nuevoEspecieId: string;
  x: number;
  y: number;
}

export interface ResultadoReproduccionGranja {
  /** solo los animales cuyo `extra.reproduccion` cambió — mismo criterio de "solo lo que cambia se persiste" que el resto del proyecto. */
  extraPorId: Map<string, Record<string, unknown>>;
  nuevos: NuevoAnimalGranja[];
  maduraciones: MaduracionGranja[];
  huevos: HuevoPuesto[];
}

/**
 * Resuelve TODO perezosamente para una propiedad entera de una vez —
 * a diferencia del escape (por individuo), esto necesita ver a todos los
 * animales a la vez para emparejar. Orden: 1) maduran las crías que ya
 * tocan (pasan a adulto, sexo 50/50 — `resolverParto`/convención del
 * catálogo ya usan `criaId` compartido), 2) partos pendientes de hembras
 * gestando, 3) un intento de apareamiento por cada macho adulto elegible
 * con una hembra elegible de su misma pareja, 4) puesta de huevos de las
 * aves con un macho adulto en la propiedad, una vez por día de mundo.
 */
export function resolverReproduccionPropiedad(
  animales: AnimalGranjaMinimo[],
  catalogo: Record<string, EspecieReproductiva>,
  alimentado: boolean,
  tieneNido: boolean,
  ahora: number,
  rnd: () => number = Math.random,
): ResultadoReproduccionGranja {
  const extraPorId = new Map<string, Record<string, unknown>>();
  const nuevos: NuevoAnimalGranja[] = [];
  const maduraciones: MaduracionGranja[] = [];
  const huevos: HuevoPuesto[] = [];

  // 1) Maduración de crías — reemplazan su especieId (no hay "sexo" hasta llegar a adulto, convención del catálogo).
  for (const fila of animales) {
    if (catalogo[fila.especieId]) continue; // ya es una especie adulta conocida
    const origen = origenDeCria(fila.especieId, catalogo);
    if (!origen) continue;
    const r = extraDe(fila);
    if (r.nacioEn == null) continue;
    const comoCria = comoReproductor(fila, "macho", "cria", true, ahora); // sexo irrelevante para tocaMadurar
    if (!tocaMadurar(comoCria, origen.tamano, ahora)) continue;
    const nuevoEspecieId = rnd() < 0.5 ? origen.pareja.machoId : origen.pareja.hembraId;
    maduraciones.push({ viejoId: fila.id, nuevoEspecieId, x: fila.x, y: fila.y });
  }
  const maduradosIds = new Set(maduraciones.map((m) => m.viejoId));
  const vivos = animales.filter((a) => !maduradosIds.has(a.id));

  // 2) Partos pendientes (mamíferos — las aves no gestan, ver 4).
  for (const fila of vivos) {
    const info = parejaDe(fila.especieId);
    if (!info || sexoDe(fila.especieId, info.pareja) !== "hembra") continue;
    const especie = catalogo[fila.especieId];
    if (!especie || especie.poneHuevos) continue;
    const reproductor = comoReproductor(fila, "hembra", "adulto", alimentado, ahora);
    if (!tocaDarALuz(reproductor, ahora)) continue;
    const resultado = resolverParto(fila.especieId, especie);
    for (const criaEspecieId of resultado.criasEspecieId) nuevos.push({ especieId: criaEspecieId, x: fila.x, y: fila.y });
    const r = extraDe(fila);
    extraPorId.set(fila.id, { ...(fila.extra ?? {}), reproduccion: { gestandoDesde: null, gestacionDuracionDias: null, nacioEn: r.nacioEn, ultimoHuevoEn: r.ultimoHuevoEn } });
  }

  // 3) Apareamiento.
  for (const machoFila of vivos) {
    const info = parejaDe(machoFila.especieId);
    if (!info || sexoDe(machoFila.especieId, info.pareja) !== "macho") continue;
    const especie = catalogo[machoFila.especieId];
    if (!especie || especie.poneHuevos) continue;
    const machoR = comoReproductor(machoFila, "macho", "adulto", alimentado, ahora);
    if (!elegibleParaAparearse(machoR, especie, ahora)) continue;

    let hembraFila: AnimalGranjaMinimo | null = null;
    for (const candidata of vivos) {
      if (parejaDe(candidata.especieId)?.clave !== info.clave || sexoDe(candidata.especieId, info.pareja) !== "hembra") continue;
      if (extraPorId.has(candidata.id)) continue; // ya resuelta este mismo pase (acaba de parir)
      const hembraR = comoReproductor(candidata, "hembra", "adulto", alimentado, ahora);
      if (elegibleParaAparearse(hembraR, especie, ahora)) { hembraFila = candidata; break; }
    }
    if (!hembraFila) continue;

    const hembraR = comoReproductor(hembraFila, "hembra", "adulto", alimentado, ahora);
    const resultado = intentarAparearse(machoR, hembraR, especie, ahora, rnd, PROBABILIDAD_EXITO_GRANJA);
    if (resultado.exito) {
      const r = extraDe(hembraFila);
      extraPorId.set(hembraFila.id, { ...(hembraFila.extra ?? {}), reproduccion: { gestandoDesde: hembraR.gestandoDesde, gestacionDuracionDias: hembraR.gestacionDuracionDias, nacioEn: r.nacioEn, ultimoHuevoEn: r.ultimoHuevoEn } });
    }
  }

  // 4) Puesta de huevos — requiere macho adulto en la propiedad, una vez al día de mundo, gatea igual que la producción (comida+agua hoy).
  for (const hembraFila of vivos) {
    const info = parejaDe(hembraFila.especieId);
    if (!info || sexoDe(hembraFila.especieId, info.pareja) !== "hembra") continue;
    const especie = catalogo[hembraFila.especieId];
    if (!especie?.poneHuevos || !alimentado) continue;
    const r = extraDe(hembraFila);
    if (r.ultimoHuevoEn != null && ahora - r.ultimoHuevoEn < VENTANA_PUESTA_DIAS) continue;
    const hayMachoAdulto = vivos.some((m) => m.especieId === info.pareja.machoId);
    if (!hayMachoAdulto) continue;
    const cantidad = tieneNido ? HUEVOS_MIN_CON_NIDO + Math.floor(rnd() * (HUEVOS_MAX_CON_NIDO - HUEVOS_MIN_CON_NIDO + 1)) : HUEVOS_SIN_NIDO;
    huevos.push({ especieMadreId: hembraFila.especieId, x: hembraFila.x, y: hembraFila.y, cantidad });
    extraPorId.set(hembraFila.id, { ...(hembraFila.extra ?? {}), reproduccion: { ...r, ultimoHuevoEn: ahora } });
  }

  return { extraPorId, nuevos, maduraciones, huevos };
}
