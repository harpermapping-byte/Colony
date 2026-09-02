/**
 * Siembra automática de la Test Zone plana (`assets/mapas/testflat/`,
 * docs/GDD_TestZone.md, pedido 2026-08-31: "un cuadrado pequeño de solo
 * hierba... coloca a mano todo lo que puedas para probar las mecánicas").
 * MISMO patrón que `admin/seedAdmin.ts`: se ejecuta una sola vez al
 * arrancar el servidor, y solo hace algo si la BD está vacía para lo que
 * siembra — nunca pisa nada que el streamer ya haya tocado a mano.
 *
 * Arregla la limitación real encontrada probando `testzone` (ver
 * docs/GDD_TestZone.md §4): ahí las mesas de crafteo eran mobiliario
 * BAKEADO del editor de interiores, nunca entraban en `ctx.vivas`
 * (construcciones reales trackeadas en BD) — `crafteo:iniciar` las
 * rechazaba con "mesa inexistente". Aquí, en cambio, las mesas se insertan
 * DIRECTAMENTE como filas reales de `construcciones` (misma tabla/función
 * que usa el jugador colocando con la tecla B) — funcionan de verdad desde
 * el primer arranque, en cualquier servidor nuevo, sin que el admin tenga
 * que colocarlas a mano.
 */
import { IAlmacenDatos } from "../datos/bd";
import { cargarCatalogoNpcsTutoriales } from "./npcsFijos";

export const MAPA_ID_TESTFLAT = "testflat";
const PARCELA_TESTFLAT = "tf_0001";

// Las 11 mesas cubren los 10 oficios de jugador (carpintero tiene 2, ver
// docs/GDD_TestZone.md) — MISMO catálogo/niveles que ya se usó en
// `testzone` (interiores/catalogo/elementos.json), aquí como construcción
// real en vez de mobiliario bakeado. Más 4 muebles con interacción propia
// (cama, 2 instrumentos, mesa de comedor) para poder probar esas mecánicas
// sueltas sin depender de crafteo.
// Al NORTE del spawn (32,32), ~12-20 casillas de distancia (pedido
// 2026-08-31: "ponlo todo alrededor del spawn, en puntos separados a X
// distancia" — cada mecánica en una dirección distinta, ver también NPCs
// al sur / cofres al este / nodos al oeste / dummies al noreste más abajo).
const MUEBLES_A_SEMBRAR: { objeto: string; x: number; y: number }[] = [
  { objeto: "mesa_despiece", x: 28, y: 12 }, // curtidor, nivel 1
  { objeto: "mesa_mampuesto", x: 30, y: 12 }, // picapedrero, nivel 4
  { objeto: "mesa_talla_fina", x: 32, y: 12 }, // carpintero, nivel 6
  { objeto: "mesa_ensamblaje", x: 34, y: 12 }, // carpintero, nivel 8 (huella 1x2)
  { objeto: "mesa_delineante", x: 28, y: 14 }, // ingeniero, nivel 1
  { objeto: "mesa_tajado_limpieza", x: 30, y: 14 }, // molinero, nivel 1
  { objeto: "estacion_despiece_caza", x: 32, y: 14 }, // cazador, nivel 1
  { objeto: "fogon_campamento", x: 34, y: 14 }, // cocinero, nivel 1
  { objeto: "forja_campo", x: 28, y: 16 }, // herrero, nivel 1
  { objeto: "mesa_diagnostico", x: 30, y: 16 }, // curandero, nivel 4
  { objeto: "mesa_engarce", x: 32, y: 16 }, // joyero, nivel 6
  { objeto: "cama_individual", x: 34, y: 16 }, // esCama (huella 1x2)
  { objeto: "laud", x: 28, y: 18 }, // instrumento "laud"
  { objeto: "tambor_guerra", x: 30, y: 18 }, // instrumento "tambor"
  { objeto: "silla", x: 32, y: 18 }, // esSilla
  { objeto: "mesa_comedor", x: 34, y: 18 }, // huella 2x3
  { objeto: "banco", x: 28, y: 20 }, // esSilla (huella 2x1)
  { objeto: "sofa", x: 30, y: 20 }, // esSilla (huella 2x1)
  { objeto: "arcon", x: 32, y: 20 }, // esContenedor
];

/** Categoría real de cada mueble de arriba en el catálogo construible — evita cargar el catálogo entero solo para esto. Todos son "mueble" (interiores/catalogo/elementos.json vía cargarCatalogoConstruible). */
const CATEGORIA_MUEBLE = "mueble";

export async function sembrarMueblesTestZone(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarConstrucciones();
  if (existentes.some((c) => c.propiedad === PARCELA_TESTFLAT)) return; // ya sembrado, o el streamer ya tocó esta parcela

  for (const m of MUEBLES_A_SEMBRAR) {
    await bd.insertarConstruccion({
      propiedad: PARCELA_TESTFLAT,
      objeto: m.objeto,
      categoria: CATEGORIA_MUEBLE,
      x: m.x,
      y: m.y,
      rot: 0,
      variante: 0,
      extra: null,
    });
  }

  console.log(`[testzone] ${MUEBLES_A_SEMBRAR.length} muebles sembrados como construcciones reales en "${MAPA_ID_TESTFLAT}" (parcela ${PARCELA_TESTFLAT}).`);
}

// --- NPCs tutorial/lore (docs/GDD_Profesiones.md ronda 3/4) ---
// Mismo catálogo de 17 arquetipos que ya usa el admin para colocar a mano
// (poblacion/catalogo/npcsTutoriales.json) — aquí se insertan TODOS de
// golpe en npcs_tutoriales, así el mapa plano nace ya con "NPCs que
// hablan" sin que el streamer tenga que colocarlos uno a uno con el panel.
// Al SUR del spawn (32,32), ~12-20 casillas de distancia — mismo criterio
// de "una dirección por mecánica" que MUEBLES_A_SEMBRAR.
const POSICIONES_NPCS_TUTORIAL: { tipoTutorial: string; x: number; y: number }[] = [
  { tipoTutorial: "tutorial_oficios", x: 24, y: 44 },
  { tipoTutorial: "tutorial_construccion", x: 26, y: 44 },
  { tipoTutorial: "tutorial_crafteo", x: 28, y: 44 },
  { tipoTutorial: "tutorial_inventario", x: 30, y: 44 },
  { tipoTutorial: "tutorial_comercio", x: 32, y: 44 },
  { tipoTutorial: "tutorial_combate", x: 34, y: 44 },
  { tipoTutorial: "tutorial_anatomia", x: 36, y: 44 },
  { tipoTutorial: "tutorial_agricultura", x: 38, y: 44 },
  { tipoTutorial: "tutorial_pesca", x: 40, y: 44 },
  { tipoTutorial: "tutorial_caza", x: 24, y: 48 },
  { tipoTutorial: "tutorial_mascotas", x: 26, y: 48 },
  { tipoTutorial: "tutorial_gremios", x: 28, y: 48 },
  { tipoTutorial: "lore_fundacion", x: 30, y: 48 },
  { tipoTutorial: "lore_bandidos", x: 32, y: 48 },
  { tipoTutorial: "lore_dioses", x: 34, y: 48 },
  { tipoTutorial: "lore_guerra", x: 36, y: 48 },
  { tipoTutorial: "lore_magia", x: 38, y: 48 },
];

export async function sembrarNpcsTutorialTestZone(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarNpcsTutorialesDeMapa(MAPA_ID_TESTFLAT);
  if (existentes.length > 0) return; // ya sembrado, o el streamer ya colocó/quitó a mano

  // npcTutorialAAgente() usa el `nombre` de la FILA de BD tal cual (no el
  // del catálogo) para la etiqueta en pantalla — hay que pasar el nombre
  // real (político) aquí, igual que hace admin:npcTutorial:colocar.
  const catalogo = cargarCatalogoNpcsTutoriales();
  for (const p of POSICIONES_NPCS_TUTORIAL) {
    const arquetipo = catalogo.get(p.tipoTutorial);
    if (!arquetipo) continue; // catálogo desactualizado, no revienta el arranque
    await bd.colocarNpcTutorial({
      mapaId: MAPA_ID_TESTFLAT,
      tipoTutorial: p.tipoTutorial,
      nombre: arquetipo.nombre,
      x: p.x,
      y: p.y,
      colocadoPor: "seed-testflat",
    });
  }

  console.log(`[testzone] ${POSICIONES_NPCS_TUTORIAL.length} NPCs tutorial/lore sembrados en "${MAPA_ID_TESTFLAT}".`);
}

// --- Zona de clima experimental (Noroeste lejano, ~80 casillas del spawn) ---
// NPC que actúa como "controlador de clima" para probar sistemas de clima
const NPCS_CLIMA: { tipoTutorial: string; x: number; y: number }[] = [
  { tipoTutorial: "tutorial_agricultura", x: 80, y: 80 }, // reutilizado como "maestro de clima"
];

export async function sembrarNpcsClima(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarNpcsTutorialesDeMapa(MAPA_ID_TESTFLAT);
  if (existentes.length > 4) return; // ya sembrados

  const catalogo = cargarCatalogoNpcsTutoriales();
  for (const p of NPCS_CLIMA) {
    const arquetipo = catalogo.get(p.tipoTutorial);
    if (!arquetipo) continue;
    await bd.colocarNpcTutorial({
      mapaId: MAPA_ID_TESTFLAT,
      tipoTutorial: p.tipoTutorial,
      nombre: "Maestro del Clima (Experimental)",
      x: p.x,
      y: p.y,
      colocadoPor: "seed-testflat",
    });
  }

  console.log(`[testzone] NPCs de clima experimental sembrados en "${MAPA_ID_TESTFLAT}".`);
}

// --- Construcciones nuevas: cocina, sastrería, cultivos, zona de animales ---

// Cocina (nueva zona SUR-ESTE, ~24 casillas del spawn mejorado a 96,96)
// Construcción con horno, mesas de trabajo
const COCINA_A_SEMBRAR: { objeto: string; x: number; y: number }[] = [
  { objeto: "horno_piedra", x: 120, y: 140 }, // cocinero
  { objeto: "mesa_desollar_carne", x: 122, y: 140 }, // cocinero
  { objeto: "alacena", x: 120, y: 142 }, // almacenaje
  { objeto: "mesa_comedor", x: 122, y: 142 }, // para probar comer/descanso
];

// Sastrería/tejado (nueva zona SUR-OESTE, ~24 casillas del spawn)
// Aunque "sastre" no es un oficio jugable oficial, dejamos herramientas/mobiliario de confección
const SASTRE_A_SEMBRAR: { objeto: string; x: number; y: number }[] = [
  { objeto: "telar_lino", x: 72, y: 140 }, // confección
  { objeto: "banco_costura", x: 74, y: 140 }, // costura
];

// Cultivos (zona ESTE, ~32 casillas del spawn, espacio dedicado para semillas/plantas)
// Notar: no son construcciones sino herramientas + espacio abierto para plantar directamente
const HERRAMIENTAS_CULTIVO_SEMBRAR: { objeto: string; x: number; y: number }[] = [
  { objeto: "almacigo_madera", x: 150, y: 100 }, // semillero (contiene semillas)
  { objeto: "almacigo_madera", x: 152, y: 100 }, // otro semillero
  { objeto: "compostador", x: 150, y: 102 }, // abono
];

// Zona de animales domesticados (NORESTE, ~32 casillas)
// No son construcciones sino colocación de fauna "amigable" para probar domesticar/montar
// Esto se hace directamente en fauna (GDD_Mundo.ts) al cargar la región, usando "domesticado"
// Por ahora dejamos comentado (ver cómo hace fauna el animal bakeado)

export async function sembrarCocina(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarConstrucciones();
  // Verificar si ya existe la cocina con una construcción marcada
  const yaExiste = existentes.some((c) => c.propiedad === "tf_cocina");
  if (yaExiste) return;

  for (const m of COCINA_A_SEMBRAR) {
    await bd.insertarConstruccion({
      propiedad: "tf_cocina", // parcela nueva
      objeto: m.objeto,
      categoria: CATEGORIA_MUEBLE,
      x: m.x,
      y: m.y,
      rot: 0,
      variante: 0,
      extra: null,
    });
  }

  console.log(`[testzone] ${COCINA_A_SEMBRAR.length} muebles de cocina sembrados en "${MAPA_ID_TESTFLAT}".`);
}

export async function sembrarSasteria(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarConstrucciones();
  const yaExiste = existentes.some((c) => c.propiedad === "tf_sasteria");
  if (yaExiste) return;

  for (const m of SASTRE_A_SEMBRAR) {
    await bd.insertarConstruccion({
      propiedad: "tf_sasteria",
      objeto: m.objeto,
      categoria: CATEGORIA_MUEBLE,
      x: m.x,
      y: m.y,
      rot: 0,
      variante: 0,
      extra: null,
    });
  }

  console.log(`[testzone] ${SASTRE_A_SEMBRAR.length} muebles de sastrería sembrados en "${MAPA_ID_TESTFLAT}".`);
}

export async function sembrarCultivos(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarConstrucciones();
  const yaExiste = existentes.some((c) => c.propiedad === "tf_cultivos");
  if (yaExiste) return;

  for (const m of HERRAMIENTAS_CULTIVO_SEMBRAR) {
    await bd.insertarConstruccion({
      propiedad: "tf_cultivos",
      objeto: m.objeto,
      categoria: CATEGORIA_MUEBLE,
      x: m.x,
      y: m.y,
      rot: 0,
      variante: 0,
      extra: null,
    });
  }

  console.log(`[testzone] ${HERRAMIENTAS_CULTIVO_SEMBRAR.length} herramientas de cultivo sembradas en "${MAPA_ID_TESTFLAT}".`);
}
