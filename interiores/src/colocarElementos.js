"use strict";

// Prototipo de colocación de elementos dentro de UNA sala ya con forma
// rectangular fija — NO es el motor final. El motor real resolverá la
// forma con Wave Function Collapse (GDD_Bakeador_Interiores sección 2);
// esto solo implementa la parte de "dada una sala con forma y tamaño,
// coloca estructura + elementos respetando riqueza/colocacion/huella"
// para poder probar de verdad que el catálogo funciona (GDD sección 7ter
// para el significado exacto de cada valor de colocacion).

const { riquezaAlcanza } = require("./catalogo");

// PRNG determinista pequeño (mulberry32) — mismo semilla, mismo resultado,
// sin depender de nada del bakeador de exteriores (interiores es una
// instancia separada, GDD sección 1).
function crearPRNG(semillaTexto) {
  let h = 1779033703 ^ semillaTexto.length;
  for (let i = 0; i < semillaTexto.length; i++) {
    h = Math.imul(h ^ semillaTexto.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function siguiente() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barajar(lista, rnd) {
  const copia = lista.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Capas incluidas según el nivel de amueblado (GDD sección 1).
const CAPAS_POR_AMUEBLADO = {
  vacio: [],
  fijo: ["decorFija"],
  completo: ["decorFija", "decorMovible", "iluminacion", "suciedad"],
};

function colocarSala({ tipoSalaId, catalogos, riqueza = "modesta", amueblado = "completo", semilla = "prueba" }) {
  const defSala = catalogos.tiposSala[tipoSalaId];
  if (!defSala) throw new Error(`tipoSala desconocido: ${tipoSalaId}`);

  const rnd = crearPRNG(`${semilla}:${tipoSalaId}`);
  const elegirEntero = (min, max) => min + Math.floor(rnd() * (max - min + 1));

  const ancho = Math.max(4, elegirEntero(defSala.anchoTiles[0], defSala.anchoTiles[1]));
  const largo = Math.max(4, elegirEntero(defSala.largoTiles[0], defSala.largoTiles[1]));
  const materialSuelo = defSala.materialSuelo;
  const materialPared = defSala.materialPared;

  // Puerta en el punto medio del lado sur.
  const puerta = { lado: "sur", x: Math.floor(ancho / 2), y: largo - 1 };

  // Ocupación de suelo interior: true = libre. El anillo exterior (x=0,
  // x=ancho-1, y=0, y=largo-1) representa la pared, no es "suelo".
  const libreSuelo = [];
  for (let y = 0; y < largo; y++) {
    libreSuelo.push(new Array(ancho).fill(true));
  }

  const esBorde = (x, y) => x === 0 || y === 0 || x === ancho - 1 || y === largo - 1;
  const esPuerta = (x, y) => x === puerta.x && y === puerta.y;
  const tocaPared = (x, y) => x === 1 || y === 1 || x === ancho - 2 || y === largo - 2;

  function huecoLibre(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    if (x < 1 || y < 1 || x + hw > ancho - 1 || y + hl > largo - 1) return false;
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        if (!libreSuelo[y + dy][x + dx]) return false;
      }
    }
    return true;
  }
  function ocupar(x, y, huella) {
    const [hw, hl] = huella || [1, 1];
    for (let dy = 0; dy < hl; dy++) {
      for (let dx = 0; dx < hw; dx++) {
        libreSuelo[y + dy][x + dx] = false;
      }
    }
  }

  const colocados = []; // mobiliario/decoración en el plano suelo, con footprint real
  const colgados = []; // elementos en el plano pared (colgadoEnPared)
  const techo = []; // elementos en el plano techo
  const superficies = []; // hosts con esSuperficie:true ya colocados, para apilar sobreSuperficie encima
  const bordesOcupados = new Set(); // "x_y" de segmentos de pared ya usados por colgadoEnPared

  function intentarColocarEnSuelo(el) {
    const intentos = 25;
    const preferido = el.colocacion.find((c) => c === "esquina" || c === "pegadaAPared" || c === "centroSala" || c === "libre" || c === "juntoAMesa" || c === "simetrico");
    for (let i = 0; i < intentos; i++) {
      const x = elegirEntero(1, ancho - 2);
      const y = elegirEntero(1, largo - 2);
      if (esPuerta(x, y)) continue;
      if (!huecoLibre(x, y, el.huella)) continue;
      if ((preferido === "pegadaAPared" || preferido === "esquina") && !tocaPared(x, y)) continue;
      ocupar(x, y, el.huella);
      const item = { id: el.id, x, y, ancho: (el.huella || [1, 1])[0], largo: (el.huella || [1, 1])[1], colorDebug: el.colorDebug, capa: el.capa };
      colocados.push(item);
      if (el.esSuperficie) superficies.push(item);
      return true;
    }
    return false;
  }

  // Anillo de casillas justo alrededor de la huella de un ancla (mesa,
  // mostrador, altar...) — donde se sientan sus sillas/bancos, no en
  // cualquier sitio libre de la sala.
  function tilesAlrededorDe(ancla) {
    const tiles = [];
    for (let dx = -1; dx <= ancla.ancho; dx++) {
      tiles.push([ancla.x + dx, ancla.y - 1]);
      tiles.push([ancla.x + dx, ancla.y + ancla.largo]);
    }
    for (let dy = 0; dy < ancla.largo; dy++) {
      tiles.push([ancla.x - 1, ancla.y + dy]);
      tiles.push([ancla.x + ancla.ancho, ancla.y + dy]);
    }
    return tiles.filter(([x, y]) => x >= 1 && y >= 1 && x <= ancho - 2 && y <= largo - 2 && !esPuerta(x, y));
  }

  // "juntoAMesa" de verdad: se sienta junto a un ancla (esSuperficie) ya
  // colocada en esta sala, no en un punto aleatorio de la sala — así una
  // silla siempre aparece pegada a una mesa real, nunca suelta por ahí. Si
  // hay varias mesas, reparte entre las que menos sillas tengan todavía.
  function intentarJuntoAMesa(el) {
    if (superficies.length === 0) return intentarColocarEnSuelo(el);
    const anclasOrdenadas = superficies.slice().sort((a, b) => (a._satelites || 0) - (b._satelites || 0));
    for (const anclaEl of anclasOrdenadas) {
      const anillo = barajar(tilesAlrededorDe(anclaEl), rnd);
      for (const [x, y] of anillo) {
        if (!huecoLibre(x, y, el.huella)) continue;
        ocupar(x, y, el.huella);
        colocados.push({ id: el.id, x, y, ancho: 1, largo: 1, colorDebug: el.colorDebug, capa: el.capa });
        anclaEl._satelites = (anclaEl._satelites || 0) + 1;
        return true;
      }
    }
    return false;
  }

  // Pares en espejo para decoración simétrica de sala noble (columnas a
  // ambos lados, etc.) — solo para elementos cuya única colocación es
  // "simetrico" (una pieza como el trono, que combina centroSala+simetrico,
  // sigue yendo por intentarColocarEnSuelo: ahí simetrico significa
  // "respeta el eje", no "duplícate").
  function colocarSimetrico(el) {
    const [hw, hl] = el.huella || [1, 1];
    const intentos = 20;
    for (let i = 0; i < intentos; i++) {
      const x = elegirEntero(1, ancho - 1 - hw);
      const y = elegirEntero(1, largo - 1 - hl);
      const xEspejo = ancho - hw - x;
      if (esPuerta(x, y) || esPuerta(xEspejo, y)) continue;
      if (!huecoLibre(x, y, el.huella)) continue;
      if (xEspejo !== x && !huecoLibre(xEspejo, y, el.huella)) continue;
      ocupar(x, y, el.huella);
      colocados.push({ id: el.id, x, y, ancho: hw, largo: hl, colorDebug: el.colorDebug, capa: el.capa });
      if (xEspejo !== x) {
        ocupar(xEspejo, y, el.huella);
        colocados.push({ id: el.id, x: xEspejo, y, ancho: hw, largo: hl, colorDebug: el.colorDebug, capa: el.capa });
      }
      return true;
    }
    return false;
  }

  function intentarColgarEnPared(el) {
    const intentos = 25;
    for (let i = 0; i < intentos; i++) {
      const lado = ["norte", "sur", "este", "oeste"][elegirEntero(0, 3)];
      let x, y;
      if (lado === "norte") { x = elegirEntero(1, ancho - 2); y = 0; }
      else if (lado === "sur") { x = elegirEntero(1, ancho - 2); y = largo - 1; }
      else if (lado === "oeste") { x = 0; y = elegirEntero(1, largo - 2); }
      else { x = ancho - 1; y = elegirEntero(1, largo - 2); }
      if (esPuerta(x, y)) continue;
      const clave = `${x}_${y}`;
      if (bordesOcupados.has(clave)) continue;
      bordesOcupados.add(clave);
      colgados.push({ id: el.id, x, y, lado, colorDebug: el.colorDebug });
      return true;
    }
    return false;
  }

  function colocarUno(el) {
    if (el.colocacion.includes("sobreSuperficie")) {
      if (superficies.length === 0) return false;
      const host = superficies[elegirEntero(0, superficies.length - 1)];
      host.sobre = host.sobre || [];
      host.sobre.push({ id: el.id, colorDebug: el.colorDebug });
      return true;
    }
    if (el.colocacion.includes("techo")) {
      techo.push({ id: el.id, colorDebug: el.colorDebug });
      return true;
    }
    if (el.colocacion.includes("colgadoEnPared")) {
      return intentarColgarEnPared(el);
    }
    if (el.colocacion.includes("juntoAMesa")) {
      return intentarJuntoAMesa(el);
    }
    if (defSala.simetrico && el.colocacion.length === 1 && el.colocacion[0] === "simetrico") {
      return colocarSimetrico(el);
    }
    return intentarColocarEnSuelo(el);
  }

  const capasIncluidas = CAPAS_POR_AMUEBLADO[amueblado];
  if (!capasIncluidas) throw new Error(`amueblado desconocido: ${amueblado}`);

  const LIMITE_POR_CAPA = { decorFija: 4, decorMovible: 9, iluminacion: 3, suciedad: 3 };

  for (const capa of capasIncluidas) {
    const candidatos = Object.entries(catalogos.elementos)
      .filter(([id]) => !id.startsWith("_"))
      .map(([id, el]) => ({ id, ...el }))
      .filter((el) => el.capa === capa)
      .filter((el) => (el.tiposSalaValidos || []).includes(tipoSalaId))
      .filter((el) => riquezaAlcanza(riqueza, el.riquezaMinima));

    // Anclas (esSuperficie, ej. mesa_comedor) primero, luego sus satélites
    // (juntoAMesa, ej. silla) — si no, una silla puede intentar colocarse
    // antes de que exista ninguna mesa en la sala y perder su hueco del
    // límite de la capa con un mueble suelto sin relación con nada.
    const rango = (el) => (el.esSuperficie ? 0 : el.colocacion.includes("juntoAMesa") ? 1 : 2);
    const barajados = barajar(candidatos, rnd).sort((a, b) => rango(a) - rango(b));
    let colocadosEnCapa = 0;
    const idsYaUsados = new Set();
    const MAX_SATELITES_POR_TIPO = 4; // ej. hasta 4 sillas repartidas entre las mesas de la sala
    for (const el of barajados) {
      if (colocadosEnCapa >= LIMITE_POR_CAPA[capa]) break;
      if (idsYaUsados.has(el.id)) continue; // no repetir la misma pieza dos veces en una sala pequeña...
      if (el.colocacion.includes("juntoAMesa")) {
        // ...salvo los satélites de un ancla (silla/banco/taburete junto a
        // una mesa): esos sí deben repetirse, es justo lo que da la imagen
        // de "mesa con varias sillas alrededor" en vez de una silla suelta.
        let colocadasDeEste = 0;
        while (colocadasDeEste < MAX_SATELITES_POR_TIPO && colocadosEnCapa < LIMITE_POR_CAPA[capa] && colocarUno(el)) {
          colocadasDeEste++;
          colocadosEnCapa++;
        }
        if (colocadasDeEste > 0) idsYaUsados.add(el.id);
        continue;
      }
      if (colocarUno(el)) {
        colocadosEnCapa++;
        idsYaUsados.add(el.id);
      }
    }
  }

  return { tipoSalaId, ancho, largo, materialSuelo, materialPared, riqueza, amueblado, semilla, puerta, colocados, colgados, techo };
}

module.exports = { colocarSala, crearPRNG };
