"use strict";

// Vincula el bakeador de mapa exterior con ciudades/ e interiores/: al
// hornear un mapa, cada POI colocado por pois.js (baker/catalogo/pois.json,
// campo `categoria`) genera AHORA su instancia real —
//   - "asentamiento" -> una región ciudades/ completa, anidada en
//     `<carpetaSalida>/pois/<slug>/`, enlazada por un portal "exterior" con
//     `destino` (mismo formato que ya consume RegionRoom/HubRoom). Su caja
//     3D (la ciudad entera) + una PUERTA real más pequeña pegada al borde
//     sur (2026-09-09, bug real: el portal vivía en el centro geométrico,
//     dentro de su propio `solar_edificio` — inalcanzable a pie) marcan el
//     asentamiento en el mapa padre; el portal cae justo delante de la
//     puerta, terreno normal.
//   - "edificio" -> UN edificio suelto (interiores/generarEdificio) directo
//     sobre el mapa padre: su interior va a `<carpetaSalida>/interiores/`
//     (misma carpeta/convención que usa ciudades/), su caja 3D es un objeto
//     más del sector (mismo `t:"e"` que ya pinta sectorVisual.ts, cero
//     cambios de cliente) y su puerta es un portal "interior" normal.
//   - "mazmorra" -> docs/GDD_Bakeador_Dungeons.md. `dungeonTipoId` (en
//     mazmorras/catalogo/tipos_dungeon.json) decide el `estiloExterior`:
//     "asentamiento" reusa el camino de arriba (ciudades/, con el tier
//     hostil del tipo — sin enemigos dentro de las casas todavía, pendiente
//     real); "edificio"/"cueva" generan el interior con
//     mazmorras/src/generarMazmorra.js (salas grandes, spawns de enemigos)
//     en vez de interiores/generarEdificio, con portal `esMazmorra:true`
//     para que el cliente/servidor lo abran como DungeonRoom, no InteriorRoom.
//   - "decorativo" (o sin categoria) -> sin cambios: el marcador de
//     siempre, sin instancia.
// "Generar una vez, nunca en directo" (CLAUDE.md): esto corre en el mismo
// proceso de horneado offline que el resto del pipeline, nunca en el
// servidor en vivo.

const fs = require("fs");
const path = require("path");
const { crearPRNG, semillaDesdeTexto } = require("./ruido");

function slugPOI(poi) {
  return `${poi.id}_${poi.x}_${poi.y}`;
}

// taller-vox/generar_edificio.js "todo" exporta 4 variantes por
// tipoEdificioId (assets/edificios/<tipo>_01..04.glb) — misma cuenta aquí
// para elegir una determinista por instancia (enganche rápido de arte,
// decisión explícita del streamer: sin pasar por revisión pieza a pieza).
const VARIANTES_EDIFICIO = 4;

// Boca de cueva (docs/GDD_Bakeador_Dungeons.md): a diferencia de "edificio"
// (caja 3D real) o "asentamiento" (ciudades/ entera), una mazmorra
// estiloExterior:"cueva" no tenía NINGÚN rastro visual en el exterior — ni
// siquiera la decoración normal del bioma, que generar.js despeja en un
// radio alrededor de todo POI (`poisCercanos`, para dejar hueco a su caja).
// El resultado era un claro de hierba vacío sin ninguna pista de que ahí
// hay una entrada — "cualquier POI mazmorra, al final, tiene que tener un
// bakeo exterior [visible]". Sin arte nuevo: reutiliza el catálogo de rocas
// del propio bioma (mismas piezas placeholder que ya decoran el mapa) en un
// arco cerrado alrededor del portal, con el hueco de la puerta despejado —
// mismo espíritu que "solar_edificio" (bloquea el resto, la puerta es la
// única entrada real), pero con forma orgánica en vez de una caja.
function generarBocaCueva(poi, semillaPOI, catalogoRocas) {
  const idsBioma = Object.entries(catalogoRocas)
    .filter(([id, datos]) => !id.startsWith("_") && (datos.biomas || []).includes(poi.bioma))
    .map(([id]) => id);
  const ids = idsBioma.length ? idsBioma : Object.keys(catalogoRocas).filter((id) => !id.startsWith("_"));
  if (!ids.length) return [];

  const rnd = crearPRNG(semillaDesdeTexto(`${semillaPOI}:boca_cueva`));
  const radio = (poi.radio || 3) + 1;
  const cantidad = Math.max(8, Math.round(radio * 2.5));
  // Arco de ~260° dejando libre el sur (por donde cae la puerta, ver más
  // abajo `puertaY = poi.y + radio`): de 200° a 340° pasando por el norte.
  const anguloIni = (200 * Math.PI) / 180;
  const anguloFin = (340 * Math.PI) / 180;
  const rocas = [];
  for (let i = 0; i < cantidad; i++) {
    const t = cantidad === 1 ? 0.5 : i / (cantidad - 1);
    const angulo = anguloIni + (anguloFin - anguloIni) * t + (rnd() - 0.5) * 0.25;
    const r = radio + rnd() * 1.5;
    const x = Math.round(poi.x + Math.cos(angulo) * r);
    const y = Math.round(poi.y + Math.sin(angulo) * r);
    const id = ids[Math.floor(rnd() * ids.length)];
    const datos = catalogoRocas[id] || {};
    rocas.push({
      x,
      y,
      objeto: {
        i: id,
        t: "r",
        va: Math.floor(rnd() * (datos.variantes || 1)),
        ro: Math.floor(rnd() * 360),
        es: Math.round((1.1 + rnd() * 0.5) * 100) / 100, // más grandes que la decoración normal: marcan la entrada
      },
    });
  }
  return rocas;
}

// Busca la plantilla de catálogo (con categoria/tier/tipoEdificioId) que le
// tocó a un POI ya colocado — colocarPOIs() solo devuelve id/tipo/bioma/x/y
// (ver pois.js), así que hay que volver a mirar el catálogo por bioma +
// "_cualquiera", igual que hizo la colocación original.
function buscarDefinicion(poi, catalogoPOIs) {
  const pools = [catalogoPOIs[poi.bioma] || [], catalogoPOIs._cualquiera || []];
  for (const pool of pools) {
    const def = pool.find((p) => p.id === poi.id);
    if (def) return def;
  }
  return null;
}

/**
 * @param {object} opciones
 * @param {Array} opciones.pois - salida de colocarPOIs() (pois.js)
 * @param {string} opciones.carpetaSalida - carpeta de salida del mapa padre (misma que crearExportador)
 * @param {string} opciones.semillaMundo - semilla del mapa padre, para derivar sub-semillas deterministas
 * @param {object} opciones.catalogoPOIs - catálogo pois.json ya cargado
 * @param {object} [opciones.catalogoRocas] - catálogo rocas.json ya cargado (boca de cueva de mazmorras estiloExterior:"cueva")
 * @param {(msg:string)=>void} [opciones.onProgreso]
 * @returns {{ portales: Array, objetosPorPOI: Map<string,{x:number,y:number,objeto:object,huella:[number,number]}>, decoracionPorPOI: Map<string,Array<{x:number,y:number,objeto:object}>> }}
 */
async function generarInstanciasPOI({ pois, carpetaSalida, semillaMundo, catalogoPOIs, catalogoRocas = {}, onProgreso = () => {} }) {
  // Requires perezosos: ciudades/interiores son módulos "pesados" (cargan
  // catálogos propios) que la mayoría de bakes de mapa exterior ni tocan
  // (mapas de prueba sin POIs de asentamiento/edificio) — cargarlos solo
  // si de verdad hace falta alguno.
  let generarEdificio = null;
  let catalogosInteriores = null;
  let hornearCiudad = null;
  function catalogosInterioresPerezosos() {
    if (!catalogosInteriores) {
      ({ generarEdificio } = require("../../interiores/src/edificio"));
      catalogosInteriores = require("../../interiores/src/catalogo").cargarCatalogos();
    }
    return catalogosInteriores;
  }
  function hornearCiudadPerezoso() {
    if (!hornearCiudad) ({ hornearCiudad } = require("../../ciudades/src/index"));
    return hornearCiudad;
  }
  // Población automática de asentamientos (docs/GDD_Poblacion_NPCs.md,
  // pedido streamer 2026-09-08: "todas incluida capital deben tener
  // generador automático de población") — antes había que correr
  // `poblacion/src/exportarAsentamiento.js` A MANO por cada asentamiento
  // que saliera del bake exterior; ahora se dispara solo, aquí mismo, justo
  // después de hornear la ciudad, con el MISMO tier+semilla (determinismo
  // por semilla: da la ciudad idéntica que `generarCiudad` recalcula
  // internamente para asignar vivienda/trabajo — no hace falta pasarle la
  // `ciudad` ya horneada). Un fallo puntual (p.ej. red caída si hay
  // GEMINI_API_KEY puesta) NUNCA debe tirar el bake del mapa entero — se
  // avisa y se sigue sin población en ESE asentamiento, mismo criterio que
  // "catálogo mal referenciado: mejor omitir el POI que romper el bake
  // entero" ya usado más abajo en este archivo.
  let exportarAsentamiento = null;
  let escribirPoblacionDeMapa = null;
  async function poblarAsentamiento(tier, semillaPOI, carpetaPOI, onProgreso) {
    if (!exportarAsentamiento) {
      ({ exportarAsentamiento, escribirPoblacionDeMapa } = require("../../poblacion/src/exportarAsentamiento"));
    }
    try {
      const resultado = await exportarAsentamiento(tier, semillaPOI);
      const { ruta, npcs } = escribirPoblacionDeMapa(resultado, carpetaPOI);
      onProgreso(`    población: ${npcs} NPC(s) con rutina -> ${ruta}`);
    } catch (err) {
      onProgreso(`    ⚠ población: falló para este asentamiento (${err.message}) — sigue sin poblacion.json`);
    }
  }
  let generarMazmorra = null;
  let catalogosMazmorra = null;
  function mazmorraPerezosa() {
    if (!generarMazmorra) {
      ({ generarMazmorra } = require("../../mazmorras/src/generarMazmorra"));
      catalogosMazmorra = { tiposDungeon: require("../../mazmorras/catalogo/tipos_dungeon.json") };
    }
    return { generarMazmorra, catalogosMazmorra };
  }

  // Silueta 3D real del asentamiento (bug real 2026-09-09, "se sigue
  // viendo... cuadrado morado" — taller-vox/generarSiluetaCiudad.js):
  // ÚNICA por instancia (cada ciudad tiene su propio polígono de muralla
  // real), así que se genera y exporta AQUÍ MISMO, en el proceso de
  // bakeo, con un id que incluye el slug entero — nunca comparte `.glb`
  // con otro asentamiento del mismo tier. `assets/edificios/` vive fuera
  // de `carpetaSalida` (que es la salida DE ESTE MAPA, `output/<nombre>/`
  // o `assets/mapas/<nombre>/` si ya está en su sitio) — es la carpeta de
  // ARTE compartida de todo el repo, la misma que ya usa taller-vox.
  let generarSiluetaCiudad = null;
  let exportarModeloGlb = null;
  const carpetaAssetsEdificios = path.join(__dirname, "..", "..", "assets", "edificios");
  function generarYExportarSilueta(ciudad, semillaPOI, slug) {
    if (!generarSiluetaCiudad) ({ generarSiluetaCiudad } = require("../../taller-vox/generarSiluetaCiudad"));
    if (!exportarModeloGlb) ({ exportarModelo: exportarModeloGlb } = require("../../taller-vox/exportar_glb"));
    const id = `ciudad_${slug}`;
    const rnd = crearPRNG(semillaDesdeTexto(`${semillaPOI}:silueta`));
    const modelo = generarSiluetaCiudad(ciudad, rnd);
    fs.mkdirSync(carpetaAssetsEdificios, { recursive: true });
    // centrarXZ:true — bug real encontrado 2026-09-09 verificando en vivo la
    // silueta recién promocionada: `generarSiluetaCiudad`/`generar_edificio.js`
    // (TODO taller-vox de edificios, no solo esta pieza) autoran sus cajas en
    // coordenadas de rejilla LOCAL [0,ancho]x[0,alto] — con `centrarXZ:false`
    // (por defecto, "ancla por la esquina") el origen local (0,0,0) del `.glb`
    // exportado queda en la ESQUINA de esa rejilla, no en su centro — pero
    // `colocarSiluetaYPuertaDeAsentamiento` (y, de hecho, TODO objeto "e" de
    // esta pila de POIs) coloca `x/y` como el CENTRO real del asentamiento
    // (confirmado con la fórmula de la puerta, `poi.y + alto/2`, que solo
    // tiene sentido si poi.y es el centro). Con esquina-anclado + centro
    // asumido, la silueta entera (184x184 casillas en capital_regional)
    // salía desplazada ~medio footprint (¡92 casillas!) de donde debía — por
    // eso no se veía nada reconocible cerca de la puerta al verificar en
    // vivo. `centrarXZ:true` desplaza los vértices por `grid/2` (mitad de la
    // rejilla nominal), que para esta silueta coincide con el centro real
    // del contenido con un margen pequeño y aceptable (la muralla real no
    // siempre cae perfectamente centrada en su propia caja delimitadora) —
    // mismo mecanismo ya usado para los muebles de interiores desde
    // 2026-09-06 (`exportar_glb.js`), aquí aplicado por primera vez a un
    // "edificio". NO se toca el resto de `taller-vox/generar_edificio.js`
    // (edificios normales de POI/ciudad) en esta pasada — mismo bug
    // probablemente real ahí también (confirmado empíricamente comparando
    // bounding boxes de `.glb` reales), pero de blast radius mucho mayor
    // (cientos de edificios ya bakeados en varios mapas) — fuera de alcance
    // de "arreglar el cuadrado morado", documentado como pendiente real en
    // docs/GDD_Motor_3D_Props.md.
    exportarModeloGlb(modelo, id, path.join(carpetaAssetsEdificios, `${id}_01.glb`), 0.1, true);
    return id;
  }

  const portales = [];
  const objetosPorPOI = new Map();
  const decoracionPorPOI = new Map();

  /**
   * Silueta 3D + puerta funcional de CUALQUIER asentamiento (civil u
   * hostil, comparten exactamente el mismo `ciudad` real de `ciudades/`)
   * — factorizado de la rama "asentamiento" tras confirmar que la rama
   * "mazmorra" con `estiloExterior:"asentamiento"` (campamentos hostiles)
   * tenía el MISMO bug de origen y encima NUNCA dejaba ni caja ni footprint
   * sólido (bug real encontrado 2026-09-09 auditando esta función para el
   * fix de la silueta: un campamento hostil no reservaba `objetosPorPOI`
   * en absoluto, así que su terreno se quedaba sin marcar "solar_edificio"
   * — vegetación normal podía superponerse a sus edificios, y su portal
   * seguía en el centro exacto, igual de inalcanzable que la capital antes
   * del fix de esta misma noche).
   */
  function colocarSiluetaYPuertaDeAsentamiento(ciudad, poi, slug, semillaPOI) {
    const tipoEdificioIdCiudad = generarYExportarSilueta(ciudad, semillaPOI, slug);
    objetosPorPOI.set(slug, {
      x: poi.x,
      y: poi.y,
      huella: [ciudad.ancho, ciudad.alto],
      objeto: {
        i: tipoEdificioIdCiudad,
        t: "e",
        va: 0, // única variante real por instancia — nunca un pool compartido
        ro: 0,
        es: 1,
        w: ciudad.ancho,
        h: ciudad.alto,
        dx: 0,
        dy: 0,
      },
    });

    // Puerta real (bug real cerrado 2026-09-09, pedido streamer jugando:
    // "la capital sigue viéndose por fuera un placeholder, debería verse
    // una aldea con puerta y poder entrar por ella"): el portal vivía en
    // el CENTRO GEOMÉTRICO del asentamiento — el mismo punto que el
    // bloque de arriba reserva entero como `solar_edificio` (terreno
    // bloqueado) — así que NINGÚN jugador podía llegar nunca a
    // `RADIO_INTERACCION` de él: inalcanzable a pie, no solo feo. Se añade
    // una estructura de puerta real y pequeña (huella fija [6,2],
    // `taller-vox/generar_puerta_asentamiento.js`, mismo tipoEdificioId
    // sintético -> mismo camino `t:"e"` que la silueta, cero cambio de
    // cliente) pegada al borde SUR de la silueta, y el portal se mueve
    // justo delante de ELLA (mismo convenio "+1 fila fuera de la huella"
    // que ya usa el POI "edificio" suelto) — terreno normal, caminable,
    // fuera de cualquier huella sólida.
    const anchoPuerta = 6, altoPuerta = 2;
    const bordeSurCiudad = poi.y + ciudad.alto / 2;
    const centroPuertaY = bordeSurCiudad + altoPuerta / 2;
    objetosPorPOI.set(`${slug}_puerta`, {
      x: poi.x,
      y: centroPuertaY,
      huella: [anchoPuerta, altoPuerta],
      objeto: {
        i: "puerta_asentamiento",
        t: "e",
        va: semillaDesdeTexto(`${semillaPOI}:puerta`) % VARIANTES_EDIFICIO,
        ro: 0,
        es: 1,
        w: anchoPuerta,
        h: altoPuerta,
        dx: 0,
        dy: 0,
      },
    });
    const puertaX = Math.round(poi.x);
    const puertaY = Math.round(bordeSurCiudad + altoPuerta) + 1;
    portales.push({
      tipo: "exterior",
      x: puertaX,
      y: puertaY,
      // RELATIVO a propósito (bug real 2026-09-09, "la puerta de la
      // capital da ENOENT al cruzarla"): antes se horneaba
      // `${mapaId}/pois/${slug}` con el `mapaId` de ESTE bake (derivado
      // del nombre de la carpeta de SALIDA, `carpetaSalidaResuelta` en
      // generar.js) — pero el mapa se PROMOCIONA después a una carpeta
      // con OTRO nombre (`output/vetrheim` -> `assets/mapas/principal/`),
      // así que la ruta absoluta horneada quedaba apuntando a una
      // carpeta que no existe en producción. Guardar solo la parte
      // relativa y dejar que HubRoom/RegionRoom la resuelvan con SU
      // propio `mapaIdPropio` (que sí refleja la carpeta real de
      // despliegue, `path.basename(RUTA_MAPA)`) sobrevive a cualquier
      // renombrado futuro sin tocar el bake.
      destino: { tipo: "region", mapaId: `pois/${slug}` },
    });
  }

  for (const poi of pois) {
    const def = buscarDefinicion(poi, catalogoPOIs);
    const categoria = def?.categoria || "decorativo";
    if (categoria === "decorativo") continue;

    const slug = slugPOI(poi);
    const semillaPOI = `${semillaMundo}:poi:${slug}`;

    if (categoria === "asentamiento") {
      if (!def.tier) continue;
      const carpetaPOI = path.join(carpetaSalida, "pois", slug);
      onProgreso(`  POI "${poi.id}" (asentamiento, ${def.tier}) en (${poi.x},${poi.y})...`);
      const ciudad = hornearCiudadPerezoso()(def.tier, semillaPOI, carpetaPOI);
      await poblarAsentamiento(def.tier, semillaPOI, carpetaPOI, onProgreso);
      colocarSiluetaYPuertaDeAsentamiento(ciudad, poi, slug, semillaPOI);
      continue;
    }

    if (categoria === "edificio") {
      const catalogos = catalogosInterioresPerezosos();
      const defEd = catalogos.tiposEdificio[def.tipoEdificioId];
      if (!defEd) continue; // catálogo mal referenciado: mejor omitir el POI que romper el bake entero
      onProgreso(`  POI "${poi.id}" (edificio, ${def.tipoEdificioId}) en (${poi.x},${poi.y})...`);

      const edificio = generarEdificio({ tipoEdificioId: def.tipoEdificioId, catalogos, semilla: semillaPOI });
      const carpetaInteriores = path.join(carpetaSalida, "interiores");
      fs.mkdirSync(carpetaInteriores, { recursive: true });
      fs.writeFileSync(path.join(carpetaInteriores, `${edificio.id}.json`), JSON.stringify(edificio));

      const [hw, hl] = defEd.huellaExterior || [7, 6];
      // Sin rotación: a diferencia de ciudades/ (edificios en fila mirando
      // a una calle), un POI suelto no tiene calle a la que orientarse —
      // puerta siempre en +Y, una fila justo debajo de la huella, mismo
      // criterio que ciudades/src/generar.js usa para SU puerta propia.
      const puertaX = Math.round(poi.x);
      const puertaY = Math.round(poi.y) + Math.ceil(hl / 2) + 1;

      objetosPorPOI.set(slug, {
        x: poi.x,
        y: poi.y,
        huella: [hw, hl],
        objeto: { i: def.tipoEdificioId, t: "e", va: semillaDesdeTexto(semillaPOI) % VARIANTES_EDIFICIO, ro: 0, es: 1, w: hw, h: hl, dx: 0, dy: 0 },
      });
      portales.push({
        tipo: "interior",
        x: puertaX,
        y: puertaY,
        edificio: edificio.id,
        tipoEdificioId: def.tipoEdificioId,
      });
      continue;
    }

    if (categoria === "mazmorra") {
      const { generarMazmorra, catalogosMazmorra } = mazmorraPerezosa();
      const dungeonDef = catalogosMazmorra.tiposDungeon[def.dungeonTipoId];
      if (!dungeonDef) continue; // catálogo mal referenciado: se omite el POI, no rompe el bake

      if (dungeonDef.estiloExterior === "asentamiento") {
        // Idéntico al camino "asentamiento" de arriba, pero con el tier
        // hostil del tipo de mazmorra — sin enemigos dentro de las casas
        // todavía (pendiente real, ver docs/GDD_Bakeador_Dungeons.md). A
        // PROPÓSITO sin `poblarAsentamiento()`: esto es un campamento
        // hostil (bandidos/facción), no un asentamiento civil — poblarlo
        // con `poblacion/` metería vecinos con rutina de tienda/taberna
        // donde debería haber tropas hostiles (docs/GDD_Faccion_Bandidos.md),
        // un mecanismo aparte que sigue sin construir.
        if (!dungeonDef.tierAsentamiento) continue;
        const carpetaPOI = path.join(carpetaSalida, "pois", slug);
        onProgreso(`  POI "${poi.id}" (mazmorra-asentamiento, ${dungeonDef.tierAsentamiento}) en (${poi.x},${poi.y})...`);
        // Bug real cerrado 2026-09-09 (mismo bug de raíz que la rama
        // "asentamiento" civil, encontrado auditando esta función para su
        // fix): el `ciudad` que ya devolvía `hornearCiudad` se descartaba
        // sin usar — un campamento hostil se quedaba sin NINGÚN footprint
        // sólido (vegetación normal podía superponerse a sus edificios) ni
        // rastro visual, y su portal seguía en el centro exacto, tan
        // inalcanzable como la capital antes de esta misma noche.
        const ciudadHostil = hornearCiudadPerezoso()(dungeonDef.tierAsentamiento, semillaPOI, carpetaPOI);
        colocarSiluetaYPuertaDeAsentamiento(ciudadHostil, poi, slug, semillaPOI);
        continue;
      }

      // "edificio" o "cueva": interior generado por mazmorras/, no interiores/.
      const catalogos = catalogosInterioresPerezosos();
      onProgreso(`  POI "${poi.id}" (mazmorra-${dungeonDef.estiloExterior}, ${def.dungeonTipoId}) en (${poi.x},${poi.y})...`);
      const mazmorra = generarMazmorra({
        tipoDungeonId: def.dungeonTipoId, catalogosMazmorra, catalogosInteriores: catalogos, semilla: semillaPOI,
      });
      const carpetaInteriores = path.join(carpetaSalida, "interiores");
      fs.mkdirSync(carpetaInteriores, { recursive: true });
      fs.writeFileSync(path.join(carpetaInteriores, `${mazmorra.id}.json`), JSON.stringify(mazmorra));

      let puertaX = Math.round(poi.x), puertaY = Math.round(poi.y);
      if (dungeonDef.estiloExterior === "edificio") {
        const defEd = catalogos.tiposEdificio[dungeonDef.tipoEdificioIdExterior];
        const [hw, hl] = defEd?.huellaExterior || [7, 6];
        puertaY = Math.round(poi.y) + Math.ceil(hl / 2) + 1;
        objetosPorPOI.set(slug, {
          x: poi.x, y: poi.y, huella: [hw, hl],
          objeto: { i: dungeonDef.tipoEdificioIdExterior, t: "e", va: semillaDesdeTexto(semillaPOI) % VARIANTES_EDIFICIO, ro: 0, es: 1, w: hw, h: hl, dx: 0, dy: 0 },
        });
      }
      // "cueva": sin caja 3D (una boca de cueva no es una caja rectangular)
      // — un arco de rocas del propio bioma alrededor del portal en vez de
      // una caja (generarBocaCueva), con el hueco de la puerta despejado.
      if (dungeonDef.estiloExterior === "cueva") {
        decoracionPorPOI.set(slug, generarBocaCueva(poi, semillaPOI, catalogoRocas));
      }

      portales.push({
        tipo: "interior", x: puertaX, y: puertaY,
        edificio: mazmorra.id, tipoEdificioId: def.dungeonTipoId, esMazmorra: true,
      });
    }
  }

  return { portales, objetosPorPOI, decoracionPorPOI };
}

module.exports = { generarInstanciasPOI, slugPOI };
