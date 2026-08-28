/**
 * Render placeholder de un interior de edificio (docs/GDD_Sistema_Puertas.md)
 * — cajas de color por sala/mueble/pared, mismo criterio "todo el arte es
 * placeholder" que el resto del proyecto (colorDebug del catálogo). v2:
 * la planta a pintar la elige `nivel` (por defecto planta baja); paredes
 * SIEMPRE visibles (sin oclusión dinámica estilo Project Zomboid todavía
 * — pendiente, ver GDD), con hueco en cada puerta de conexión real entre
 * salas de la MISMA planta, y un marcador propio (distinto de un mueble)
 * en cada escalera/trampilla que suba o baje de planta.
 */
import * as THREE from "three";
import { cargarInstanciaEntidad } from "./entityLoader";
import { obtenerTextura } from "./texturaLoader";

interface ElementoColocado {
  id: string;
  x: number;
  y: number;
  ancho: number;
  largo: number;
  colorDebug?: string;
  capa?: string;
  rotacion?: number;
}

// Objeto en el plano PARED (interiores/catalogo/elementos.json,
// colocacion:"colgadoEnPared" — cuadros, tapices, candelabros de pared...).
// Sin huella propia: siempre ocupa 1 casilla del borde de la sala, `lado`
// dice a qué muro se pega (interiores/src/colocarElementos.js:intentarColgarEnPared).
interface ElementoColgado {
  id: string;
  x: number;
  y: number;
  lado: "norte" | "sur" | "este" | "oeste";
  colorDebug?: string;
  capa?: string;
}

// Objeto en el plano TECHO (lámparas de araña, faroles colgantes) — sin
// posición propia dentro de la sala, se cuelga del centro.
interface ElementoTecho {
  id: string;
  colorDebug?: string;
  capa?: string;
}

interface PuertaConexion {
  x: number;
  y: number;
}

interface SalaInterior {
  tipoSalaId: string;
  offsetX: number;
  offsetY: number;
  resultado: {
    ancho: number;
    largo: number;
    colocados: ElementoColocado[];
    // id de interiores/catalogo/materiales.json (madera/piedra/adobe...) que
    // ya decide colocarElementos.js — docs/GDD_Bakeador_Texturas.md engancha
    // aquí la textura real cuando exista; sin ella sigue el color plano.
    materialSuelo?: string;
    materialPared?: string;
    colgados?: ElementoColgado[];
    techo?: ElementoTecho[];
  };
}

interface ConectorVertical {
  tipoConectorId: string;
  entreNiveles: [number, number];
  posicionAbajo: { x: number; y: number };
  posicionArriba: { x: number; y: number };
  huella: [number, number];
}

export interface InteriorBakeado {
  id: string;
  tipoEdificioId: string;
  plantas: { nivel: number; rol: string; salas: SalaInterior[]; puertasConexion?: PuertaConexion[] }[];
  conectoresVerticales?: ConectorVertical[];
}

const ALTO_MUEBLE = 0.6;
const ALTO_PARED = 2.4;
const GROSOR_PARED = 0.12;
const COLOR_PARED = "#b0a48c";
const ALTO_CONECTOR = 0.9;
const COLOR_CONECTOR = "#c9a227"; // distinto de cualquier mueble: es un portal, no decoración
const COLOR_PASILLO = "#9c8f74"; // suelo del hueco de 1 casilla entre puertas — sin esto se veía un agujero sin suelo

// Antorchas/candelabros (capa "iluminacion" de interiores/catalogo/elementos.json)
// ya se colocaban en el bake, pero se pintaban como un mueble más — sin luz
// de verdad, un interior quedaba a oscuras de noche (el ciclo día/noche solo
// mueve la luz ambiente/sol exterior, que no llega dentro de un edificio con
// paredes). Siempre encendidas (una antorcha no se apaga de día): cada pieza
// de esta capa suma además un THREE.PointLight cálido sobre su posición.
// Intensidad BASE — el parpadeo de llama real (mismo criterio que la
// antorcha del guardia en game.ts) lo anima quien llame a esta función,
// usando la lista `luces` que se devuelve junto al grupo.
const ALTO_LUZ = 1.6;
const ALTO_LUZ_TECHO = 2.2;
const COLOR_LUZ = 0xffb066;
export const INTENSIDAD_LUZ = 1.3;
const ALCANCE_LUZ = 6;
const ALTO_COLGADO = 1.68; // ALTO_PARED * 0.7 (interiores/gui/vista3d.js, mismo criterio de altura)
const BORDE_PARED = 0.08; // separación del muro para que no se confunda con él (mismo valor que vista3d.js)

/** Una luz de interior con su desfase de parpadeo propio (para que no titilen todas a la vez). */
export interface LuzInterior {
  luz: THREE.PointLight;
  fase: number;
}

// Desfase determinista por id de instancia (no aleatorio: mismo bake, mismo
// parpadeo, aunque no importa demasiado — es solo para desincronizar).
function faseDe(clave: string): number {
  let h = 0;
  for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export function crearInteriorVisual(interior: InteriorBakeado, nivel = 0): { grupo: THREE.Group; luces: LuzInterior[] } {
  const grupo = new THREE.Group();
  const luces: LuzInterior[] = [];
  // plantas[0] NO es siempre la planta baja (edificios con bodega) — mismo
  // bug que se corrigió en el servidor, mismo criterio aquí. `nivel` decide
  // qué planta se pinta (0 = planta baja si no se especifica otra).
  const planta = interior.plantas.find((p) => p.nivel === nivel) ?? interior.plantas.find((p) => p.rol === "planta_baja") ?? interior.plantas[0];
  const salas = planta?.salas ?? [];
  const puertas = planta?.puertasConexion ?? [];
  const esPuerta = (x: number, y: number) => puertas.some((p) => p.x === x && p.y === y);

  const geoParedH = new THREE.BoxGeometry(1, ALTO_PARED, GROSOR_PARED);
  const geoParedV = new THREE.BoxGeometry(GROSOR_PARED, ALTO_PARED, 1);
  // Un material de pared por id de interiores/catalogo/materiales.json (no
  // uno global): antes TODA pared del edificio compartía el mismo color
  // plano sin mirar qué material había decidido colocarElementos.js para
  // esa sala en concreto. Cacheado por id — varias salas con el mismo
  // material (típico: la mayoría de "madera") comparten instancia.
  const matParedPorMaterial = new Map<string, THREE.MeshStandardMaterial>();
  function materialParedDe(materialId: string | undefined): THREE.MeshStandardMaterial {
    const clave = materialId ?? "_defecto";
    let mat = matParedPorMaterial.get(clave);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: COLOR_PARED, roughness: 0.95, metalness: 0 });
      matParedPorMaterial.set(clave, mat);
      if (materialId) aplicarTexturaCuandoExista("materiales", materialId, mat, 1, ALTO_PARED);
    }
    return mat;
  }

  for (const sala of salas) {
    const { offsetX, offsetY, resultado } = sala;
    const matSuelo = new THREE.MeshStandardMaterial({ color: colorDeSala(sala.tipoSalaId), roughness: 0.95, metalness: 0 });
    if (resultado.materialSuelo) aplicarTexturaCuandoExista("materiales", resultado.materialSuelo, matSuelo, resultado.ancho, resultado.largo);
    const suelo = new THREE.Mesh(new THREE.BoxGeometry(resultado.ancho, 0.1, resultado.largo), matSuelo);
    suelo.position.set(offsetX + resultado.ancho / 2, -0.05, offsetY + resultado.largo / 2);
    grupo.add(suelo);

    const matPared = materialParedDe(resultado.materialPared);
    // Paredes casilla a casilla, con hueco donde haya una puerta de
    // conexión real (interiores/src/edificio.js) — norte nunca la tiene
    // (las salas de una fila se alinean por el muro sur, GDD_Sistema_Puertas).
    for (let x = offsetX; x < offsetX + resultado.ancho; x++) {
      añadirSiNoEsPuerta(grupo, geoParedH, matPared, x + 0.5, offsetY, esPuerta(x, offsetY - 1));
      añadirSiNoEsPuerta(grupo, geoParedH, matPared, x + 0.5, offsetY + resultado.largo, esPuerta(x, offsetY + resultado.largo));
    }
    for (let y = offsetY; y < offsetY + resultado.largo; y++) {
      añadirSiNoEsPuerta(grupo, geoParedV, matPared, offsetX, y + 0.5, esPuerta(offsetX - 1, y));
      añadirSiNoEsPuerta(grupo, geoParedV, matPared, offsetX + resultado.ancho, y + 0.5, esPuerta(offsetX + resultado.ancho, y));
    }

    for (const item of resultado.colocados) {
      const cx = offsetX + item.x + item.ancho / 2;
      const cz = offsetY + item.y + item.largo / 2;

      // item.ancho/item.largo son la huella YA ROTADA (colocarElementos.js
      // las calcula con rotarHuella antes de reservar hueco) — cx/cz de
      // arriba está bien porque usa esa huella rotada tal cual. Pero el
      // placeholder de abajo aplica DESPUÉS `rotation.y = item.rotacion`:
      // si le diéramos las dimensiones ya rotadas, quedaría rotado dos
      // veces y la caja sobresaldría del hueco reservado (bug reportado,
      // visible en mobiliario no cuadrado pegado a un muro este/oeste con
      // 90°/270°). rotarHuella es su propia inversa en 90/270, así que
      // basta con deshacer el intercambio antes de construir la caja.
      const rot = item.rotacion || 0;
      const anchoBase = rot === 90 || rot === 270 ? item.largo : item.ancho;
      const largoBase = rot === 90 || rot === 270 ? item.ancho : item.largo;

      // .glb real del mueble (assets/interiores/<id>_01.glb, taller-vox/
      // generar_modelos.js) si ya existe, si no el cubo de color de
      // siempre — cargarInstanciaEntidad ya resuelve esa caída sola. Un
      // .glb real no usa `dimensiones` (trae su propia geometría ya
      // orientada en base), así que esto solo corrige el placeholder.
      // `grupo` ya está en la escena cuando esto resuelve (crearInteriorVisual
      // devuelve el grupo síncrono, mismo patrón que sectorVisual.ts): el
      // mueble aparece un frame más tarde, no bloquea la carga del interior.
      cargarInstanciaEntidad({
        categoria: "interiores",
        id: item.id,
        variante: { tipo: "numerada", indice: 0 },
        colorPlaceholder: item.colorDebug ?? "#8a6a4a",
        dimensiones: { ancho: anchoBase, alto: ALTO_MUEBLE, profundo: largoBase },
      }).then((instancia) => {
        instancia.position.set(cx, 0, cz);
        instancia.rotation.y = THREE.MathUtils.degToRad(item.rotacion || 0);
        grupo.add(instancia);
      });

      if (item.capa === "iluminacion") {
        const luz = new THREE.PointLight(COLOR_LUZ, INTENSIDAD_LUZ, ALCANCE_LUZ, 2);
        luz.position.set(cx, ALTO_LUZ, cz);
        grupo.add(luz);
        luces.push({ luz, fase: faseDe(`${item.id}_${cx}_${cz}`) });
      }
    }

    // Colgados en pared (cuadros, tapices, candelabros/antorchas de pared,
    // faroles...) — hasta ahora `colocarSala()` ya los bakeaba en
    // `resultado.colgados`, pero este render nunca los leía: la sala
    // quedaba con las paredes desnudas aunque el editor de interiores/ sí
    // los mostrara. Misma fórmula de posición por `lado` que el visor de
    // interiores/gui/vista3d.js, para que el juego en vivo pinte lo mismo
    // que ya se ve al editar.
    for (const c of resultado.colgados ?? []) {
      let cx: number, cz: number, rotY: number;
      if (c.lado === "sur") { cx = offsetX + c.x + 0.5; cz = offsetY + resultado.largo - BORDE_PARED; rotY = Math.PI; }
      else if (c.lado === "norte") { cx = offsetX + c.x + 0.5; cz = offsetY + BORDE_PARED; rotY = 0; }
      else if (c.lado === "este") { cx = offsetX + resultado.ancho - BORDE_PARED; cz = offsetY + c.y + 0.5; rotY = Math.PI / 2; }
      else { cx = offsetX + BORDE_PARED; cz = offsetY + c.y + 0.5; rotY = -Math.PI / 2; }

      cargarInstanciaEntidad({
        categoria: "interiores",
        id: c.id,
        variante: { tipo: "numerada", indice: 0 },
        colorPlaceholder: c.colorDebug ?? "#c9b48a",
        dimensiones: { ancho: 0.6, alto: 0.6, profundo: 0.12 },
      }).then((instancia) => {
        instancia.position.set(cx, ALTO_COLGADO, cz);
        instancia.rotation.y = rotY;
        grupo.add(instancia);
      });

      if (c.capa === "iluminacion") {
        const luz = new THREE.PointLight(COLOR_LUZ, INTENSIDAD_LUZ, ALCANCE_LUZ, 2);
        luz.position.set(cx, ALTO_COLGADO, cz);
        grupo.add(luz);
        luces.push({ luz, fase: faseDe(`${c.id}_${cx}_${cz}`) });
      }
    }

    // Colgados de techo (lámparas de araña, faroles) — sin posición propia
    // en el bake (`colocacion:"techo"` no reserva casilla, GDD): uno por
    // sala, centrado.
    for (const t of resultado.techo ?? []) {
      const cx = offsetX + resultado.ancho / 2;
      const cz = offsetY + resultado.largo / 2;
      cargarInstanciaEntidad({
        categoria: "interiores",
        id: t.id,
        variante: { tipo: "numerada", indice: 0 },
        colorPlaceholder: t.colorDebug ?? "#c9b48a",
        dimensiones: { ancho: 0.6, alto: 0.6, profundo: 0.6 },
      }).then((instancia) => {
        instancia.position.set(cx, ALTO_LUZ_TECHO, cz);
        grupo.add(instancia);
      });

      if (t.capa === "iluminacion") {
        const luz = new THREE.PointLight(COLOR_LUZ, INTENSIDAD_LUZ, ALCANCE_LUZ, 2);
        luz.position.set(cx, ALTO_LUZ_TECHO, cz);
        grupo.add(luz);
        luces.push({ luz, fase: faseDe(`${t.id}_${cx}_${cz}`) });
      }
    }
  }

  // Suelo de cada puerta de conexión: el hueco entre dos salas (o entre una
  // sala y el pasillo) es de 1 casilla — colocarSala.puerta cae justo AHÍ,
  // fuera del rectángulo de cualquier sala, así que ningún `suelo` de la
  // sala lo pintaba: se veía un agujero sin piso entre las dos habitaciones
  // en vez de un pasillito real (bug visual reportado). La colisión del
  // servidor ya despejaba esa casilla y sus 4 vecinas (interiorColision.ts)
  // — aquí solo falta el plano que se ve.
  const matPasillo = new THREE.MeshStandardMaterial({ color: COLOR_PASILLO, roughness: 0.95, metalness: 0 });
  for (const puerta of puertas) {
    const suelo = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), matPasillo);
    suelo.position.set(puerta.x + 0.5, -0.05, puerta.y + 0.5);
    grupo.add(suelo);
  }

  // Escaleras/trampillas que tocan esta planta — mismo cálculo de "a qué
  // lado del conector le toca esta planta" que interiorColision.ts en el
  // servidor: color/altura propios para que se note que es un TP, no
  // decoración normal.
  const matConector = new THREE.MeshStandardMaterial({ color: COLOR_CONECTOR, roughness: 0.7, metalness: 0.1 });
  for (const c of interior.conectoresVerticales ?? []) {
    const [nivelAbajo, nivelArriba] = c.entreNiveles;
    const posicion = nivelAbajo === nivel ? c.posicionAbajo : nivelArriba === nivel ? c.posicionArriba : null;
    if (!posicion) continue;
    const [hw, hl] = c.huella;
    const caja = new THREE.Mesh(new THREE.BoxGeometry(hw, ALTO_CONECTOR, hl), matConector);
    caja.position.set(posicion.x + hw / 2, ALTO_CONECTOR / 2, posicion.y + hl / 2);
    grupo.add(caja);
  }

  return { grupo, luces };
}

// Píxeles de patrón por casilla de mundo (docs/GDD_Bakeador_Texturas.md,
// resolución 128 por defecto) — determina cuántas veces se repite la
// textura a lo ancho/alto de la superficie real, para que no salga
// estirada ni demasiado apretada.
const REPETICIONES_POR_CASILLA = 1;

// Si assets/materiales/<id>_01.png existe, lo cuelga como `map` del
// material YA CREADO (mutación in-place: el material puede llevar rato
// pintado con su color plano de siempre, esto solo lo mejora cuando
// resuelve) — nunca bloquea ni sustituye el fallback si el .png no existe
// todavía (obtenerTextura ya cae a null sola). Clona SIEMPRE la textura
// cacheada antes de tocar `repeat`: es la plantilla compartida de
// texturaLoader, tocarla directamente rompería el repeat de cualquier
// otra superficie que la esté usando con otro tamaño.
function aplicarTexturaCuandoExista(
  categoria: "materiales" | "terrenos",
  id: string,
  material: THREE.MeshStandardMaterial,
  anchoMundo: number,
  altoMundo: number,
) {
  obtenerTextura(categoria, id, { tipo: "numerada", indice: 0 }).then((textura) => {
    if (!textura) return;
    const propia = textura.clone();
    propia.needsUpdate = true;
    propia.repeat.set(anchoMundo * REPETICIONES_POR_CASILLA, altoMundo * REPETICIONES_POR_CASILLA);
    material.map = propia;
    material.needsUpdate = true;
  });
}

function añadirSiNoEsPuerta(
  grupo: THREE.Group,
  geometria: THREE.BoxGeometry,
  material: THREE.Material,
  x: number,
  z: number,
  esHueco: boolean,
) {
  if (esHueco) return;
  const caja = new THREE.Mesh(geometria, material);
  caja.position.set(x, ALTO_PARED / 2, z);
  grupo.add(caja);
}

// Color de suelo estable por tipo de sala (hash simple → tono), para
// distinguir salas a simple vista sin un catálogo de materiales todavía.
function colorDeSala(tipoSalaId: string): number {
  let h = 0;
  for (let i = 0; i < tipoSalaId.length; i++) h = (h * 31 + tipoSalaId.charCodeAt(i)) >>> 0;
  const color = new THREE.Color();
  color.setHSL((h % 360) / 360, 0.25, 0.55);
  return color.getHex();
}
