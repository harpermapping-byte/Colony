"use strict";

// Resuelve el catálogo de PLANTILLAS DE FORMA (catalogo/formasSala.json,
// ver su `_nota` para el contrato completo) a una máscara real de tiles
// para el ancho/largo concreto que colocarSala ya decidió, y decide qué
// sala usa una forma no rectangular. NO es Wave Function Collapse — es el
// pedido explícito del streamer ("15 plantillas con variación de tamaño"),
// docs/GDD_Bakeador_Interiores.md sección 2.

const { crearPRNG } = require("./azar");

// Una celda de tile (i-ésima de `n`) cae dentro de la fracción [f0,f1) si su
// CENTRO continuo ((i+0.5)/n) está en ese rango — evita ambigüedad de
// redondeo en los bordes y escala limpio a cualquier ancho/largo (colocarSala
// nunca genera salas menores de 4x4, y las plantillas solo se aplican desde
// LADO_MINIMO_PARA_FORMA, ver más abajo).
function celdaEnFraccion(i, n, f0, f1) {
  const centro = (i + 0.5) / n;
  return centro >= f0 && centro < f1;
}

// grid[y][x] boolean — construido sumando/restando cada pieza EN ORDEN
// (mismo criterio que un editor de máscaras real: lo último declarado gana
// sobre esa celda).
function construirMascara(piezas, ancho, largo) {
  const grid = [];
  for (let y = 0; y < largo; y++) grid.push(new Array(ancho).fill(false));
  for (const { modo, x0, y0, x1, y1 } of piezas) {
    for (let y = 0; y < largo; y++) {
      if (!celdaEnFraccion(y, largo, y0, y1)) continue;
      for (let x = 0; x < ancho; x++) {
        if (!celdaEnFraccion(x, ancho, x0, x1)) continue;
        grid[y][x] = modo !== "restar";
      }
    }
  }
  return grid;
}

function espejarMascara(grid) {
  return grid.map((fila) => [...fila].reverse());
}

function contarTrue(grid) {
  let n = 0;
  for (const fila of grid) for (const v of fila) if (v) n++;
  return n;
}

// Salvaguarda real (nunca una sala rota se cuela al bake): única componente
// conexa por 4-vecinos, suelo real en la fila sur (y=largo-1, donde
// colocarSala punza la puerta) y un mínimo de área aprovechable — mismo
// contrato de circulación que ya exige colocarSala/salas.js para el
// rectángulo puro, aplicado ANTES de que la máscara llegue allí.
const AREA_MINIMA_FRACCION = 0.4;
function mascaraValida(grid, ancho, largo) {
  const total = contarTrue(grid);
  if (total === 0 || total < ancho * largo * AREA_MINIMA_FRACCION) return false;
  if (!grid[largo - 1].some(Boolean)) return false;

  let inicio = null;
  for (let y = 0; y < largo && !inicio; y++) {
    for (let x = 0; x < ancho; x++) {
      if (grid[y][x]) { inicio = [x, y]; break; }
    }
  }
  const visitado = new Set([`${inicio[0]}_${inicio[1]}`]);
  const pila = [inicio];
  while (pila.length) {
    const [cx, cy] = pila.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= ancho || ny >= largo || !grid[ny][nx]) continue;
      const k = `${nx}_${ny}`;
      if (!visitado.has(k)) { visitado.add(k); pila.push([nx, ny]); }
    }
  }
  return visitado.size === total;
}

// Resuelve UNA plantilla ya elegida a su máscara real (grid + mismo formato
// string 'ancho*largo' de '1'/'0' que ya usan las salas orgánicas de
// mazmorras/src/celular.js — interiorColision.ts ya sabe leer ese campo
// `mascara` sin ningún cambio). `null` = cae al rectángulo de siempre (sin
// plantilla, plantilla desconocida, o la máscara resultante no pasó la
// validación) — colocarSala trata null exactamente igual que si esta
// plantilla no existiera, cero diferencia de comportamiento con el motor
// anterior a este catálogo.
function resolverFormaSala({ catalogoFormas, formaId, ancho, largo, semilla }) {
  const def = catalogoFormas && catalogoFormas[formaId];
  if (!formaId || formaId === "rectangulo" || !def) return null;

  let grid = construirMascara(def.piezas, ancho, largo);
  if (def.espejoValido) {
    const rnd = crearPRNG(`${semilla}:${formaId}:espejo`);
    if (rnd() < 0.5) grid = espejarMascara(grid);
  }
  if (!mascaraValida(grid, ancho, largo)) return null;

  let mascaraStr = "";
  for (let y = 0; y < largo; y++) for (let x = 0; x < ancho; x++) mascaraStr += grid[y][x] ? "1" : "0";
  return { grid, mascaraStr };
}

// Categorías con carácter arquitectónico real (tipos_sala.json:categoria) —
// justo el ejemplo que dio el streamer ("salones/salas nobles"). FUERA a
// propósito: residencial/utilidad/almacenamiento/artesania (mobiliario en
// fila contra un muro recto, se lee mejor en un rectángulo limpio) y
// circulacion (el pasillo es la columna vertebral literal de
// edificio.js:generarPlanta — su ancho/largo real sostiene la fila de
// habitaciones de encima, tiene que seguir siendo un rectángulo exacto;
// bsp.js tampoco se toca, ver su comentario de cabecera).
const CATEGORIAS_CON_FORMA = new Set(["civico", "religioso", "ocio", "comercio"]);
// Con qué probabilidad una sala ELEGIBLE sale con forma no rectangular en
// vez de la de siempre — no el 100%: un salón sigue pudiendo salir
// rectangular sin más (sigue siendo una plantilla válida del catálogo), la
// variedad viene de que TAMBIÉN pueda salir con carácter.
const PROBABILIDAD_FORMA_NO_RECTANGULAR = 0.55;
// Con <6 tiles de lado una L/T/cruz no se LEE como tal, solo como un
// rectángulo con un mordisco raro — celda/calabozo (2x3/8x14 pero célda es
// la única realmente pequeña de las categorías elegibles) se quedan fuera
// por tamaño, no por categoría.
const LADO_MINIMO_PARA_FORMA = 6;

// Elige qué plantilla usa ESTA instancia de sala — determinista por semilla
// (mismo crearPRNG de siempre: misma semilla = mismo edificio). `defSala`
// es la entrada de tipos_sala.json (para categoria/simetrico); ancho/largo
// son los YA decididos por colocarSala para esta instancia concreta (una
// sala grande y una pequeña del mismo tipoSalaId pueden acabar en
// plantillas distintas sin más razón que el tamaño real que le tocó).
function elegirFormaSala({ tipoSalaId, defSala, catalogoFormas, semilla, ancho, largo }) {
  if (!catalogoFormas) return "rectangulo";
  if (!CATEGORIAS_CON_FORMA.has(defSala.categoria)) return "rectangulo";
  if (ancho < LADO_MINIMO_PARA_FORMA || largo < LADO_MINIMO_PARA_FORMA) return "rectangulo";

  const rnd = crearPRNG(`${semilla}:${tipoSalaId}:formaSala`);
  if (rnd() >= PROBABILIDAD_FORMA_NO_RECTANGULAR) return "rectangulo";

  // Salas con `simetrico:true` (tipos_sala.json) pueden llevar piezas
  // colocacion:["simetrico"] (colocarElementos.js:colocarSimetrico, pares
  // en espejo alrededor del eje central) — solo las plantillas ya
  // simétricas en X (simetricoEjeX:true) garantizan que ese par (x,
  // ancho-hw-x) caiga siempre dentro de suelo real a los dos lados; con una
  // plantilla asimétrica (L, escalonada...) esas piezas simplemente
  // fallarían a colocarse la mayoría de las veces.
  const idsElegibles = Object.keys(catalogoFormas).filter((id) => {
    if (id === "rectangulo" || id.startsWith("_")) return false;
    if (defSala.simetrico && !catalogoFormas[id].simetricoEjeX) return false;
    return true;
  });
  if (idsElegibles.length === 0) return "rectangulo";
  return idsElegibles[Math.floor(rnd() * idsElegibles.length)];
}

// Segmentos de pared REALES de un `resultado` de colocarSala (o de
// cualquier objeto con la misma forma {ancho,largo,mascara?}) — una celda
// de suelo tiene pared en el lado que colinda con una celda que NO es suelo
// (fuera de la caja delimitadora, o dentro pero fuera de la máscara). Sin
// `mascara` (caso rectángulo, el 100% del motor anterior a este catálogo)
// da exactamente el perímetro del rectángulo de siempre. Uso: renderers de
// verificación visual (prueba_render_iso.js, gui/vista3d.js) — el propio
// bakeador no lo necesita, colocarSala ya resuelve su rejilla real vía
// salas.js:detectarSalas.
function segmentosDePared({ ancho, largo, mascara }) {
  const esSuelo = (x, y) => x >= 0 && y >= 0 && x < ancho && y < largo && (!mascara || mascara[y * ancho + x] === "1");
  const segmentos = [];
  for (let y = 0; y < largo; y++) {
    for (let x = 0; x < ancho; x++) {
      if (!esSuelo(x, y)) continue;
      if (!esSuelo(x, y - 1)) segmentos.push({ x, y, lado: "norte" });
      if (!esSuelo(x, y + 1)) segmentos.push({ x, y, lado: "sur" });
      if (!esSuelo(x - 1, y)) segmentos.push({ x, y, lado: "oeste" });
      if (!esSuelo(x + 1, y)) segmentos.push({ x, y, lado: "este" });
    }
  }
  return segmentos;
}

module.exports = { resolverFormaSala, elegirFormaSala, segmentosDePared, construirMascara, mascaraValida };
