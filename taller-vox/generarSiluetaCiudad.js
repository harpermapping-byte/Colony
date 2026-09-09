"use strict";
// Silueta 3D REAL del asentamiento visto desde fuera del mapa exterior —
// pedido streamer 2026-09-09 ("se sigue viendo sin hornear el exterior
// prop de la aldea... sigue siendo cuadrado morado"): el placeholder
// `ciudad_<tier>` (baker/src/instanciasPOI.js) nunca tuvo `.glb` real, así
// que caía a una caja de color plano — y como el id sintético `ciudad_
// <tier>` no existe en `interiores/catalogo/tipos_edificio.json`, ni
// siquiera caía al color por riqueza (`COLOR_RIQUEZA`): caía al fallback
// de "id sin catálogo" (`COLOR_DESCONOCIDO`, un morado apagado a propósito
// para cantar a la vista en el editor/bakeador) — de ahí el "cuadrado
// morado" reportado jugando.
//
// A DIFERENCIA del resto de taller-vox (arquetipo + unas pocas variantes
// PRE-generadas y subidas a mano tras revisión): esta pieza es única POR
// INSTANCIA de asentamiento — cada ciudad tiene su propio polígono de
// muralla real (Perlin, irregular) y su propio reparto de edificios, así
// que NO tiene sentido un pool de "4 variantes" compartidas. Se genera EN
// EL MISMO PROCESO DE BAKEO (baker/src/instanciasPOI.js la llama
// directamente, perezoso, mismo criterio que generarEdificio/
// generarMazmorra) a partir del objeto `ciudad` REAL que ya devuelve
// `ciudades/src/index.js::hornearCiudad` — reutiliza datos ya calculados,
// cero generación nueva de forma/terreno:
//   - `ciudad.modulosMuralla` ({tipo:"recto"|"torre"|"puerta", x,y,rot,
//     material}, coordenadas en la rejilla LOCAL de la ciudad) → cada
//     módulo no-puerta se dibuja como un bloque cuadrado sin rotar (las
//     piezas de este taller NUNCA rotan, ver cabecera de generar_naturaleza.js)
//     en su posición real — con módulos cada ~3 casillas trazando el
//     polígono real (posiblemente irregular), el resultado sigue la forma
//     real de la muralla sin necesitar rotación por pieza.
//   - `ciudad.edificios` ({tipoEdificioId, cx, cy, w, h, ...}) → una LÁMINA
//     fina de "tejado" por edificio real (nunca el bloque entero desde el
//     suelo — desde la cámara isométrica fija de este juego una lámina se
//     lee igual que un bloque macizo, a una fracción del coste de vóxeles
//     a exportar), en su posición/tamaño real, para sugerir un perfil
//     urbano dentro de la muralla.
//
// La puerta FUNCIONAL de `instanciasPOI.js` (`generar_puerta_asentamiento.js`)
// vive siempre en el borde de la huella entera (ancho/alto) — muy por
// fuera del polígono real de la muralla gracias a `MARGEN_EXTRAMUROS`
// (16 casillas de respiro que `ciudades/src/generar.js` ya reserva
// alrededor de CUALQUIER tier) — así que nunca hace falta forzar un
// hueco extra en esta silueta para que coincidan; las únicas puertas que
// se saltan aquí son las reales del propio polígono.
//
// Mismo contrato de salida que el resto del taller ({grid, paleta, cajas},
// resolucion=U) — se exporta DIRECTO a assets/edificios/ (enganche rápido,
// mismo criterio que el resto de lotes de esta sesión), con un id ÚNICO
// por instancia (`ciudad_<slug>`, nunca compartido entre asentamientos).

const U = 10; // subdivisiones de vóxel por casilla — mismo criterio que el resto del taller

const PIEDRA = "#8a8580";
const MADERA = "#5a4028";
const TECHOS = ["#8a4a3a", "#6a5a3a", "#7a3e5a", "#4a5a6a"]; // tonos de tejado variados, mismo espíritu que COLOR_RIQUEZA

function sombrear(hex, factor) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * factor)));
  return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function Builder() {
  const paleta = [];
  const cajas = [];
  function color(hex) {
    let i = paleta.indexOf(hex);
    if (i === -1) { i = paleta.length; paleta.push(hex); }
    return i;
  }
  function caja(x0, y0, z0, x1, y1, z1, hex) {
    if (x1 < x0 || y1 < y0 || z1 < z0) return;
    cajas.push([Math.round(x0), Math.round(y0), Math.round(z0), Math.round(x1), Math.round(y1), Math.round(z1), color(hex)]);
  }
  return { caja, paleta, cajas };
}

/**
 * @param {object} ciudad - objeto REAL devuelto por hornearCiudad() (ciudades/src/index.js)
 * @param {() => number} rnd - PRNG mulberry32 (crearPRNG), para variación menor de altura/tejados
 */
function generarSiluetaCiudad(ciudad, rnd) {
  const b = Builder();
  const gx = Math.round(ciudad.ancho * U);
  const gz = Math.round(ciudad.alto * U);

  // --- muralla: un bloque sin rotar por módulo real (recto/torre), nunca en "puerta" ---
  // (la puerta FUNCIONAL de instanciasPOI.js vive siempre en el borde de
  // la huella entera, ancho/alto — muy por fuera del polígono real de la
  // muralla gracias a MARGEN_EXTRAMUROS=16 casillas de respiro que
  // ciudades/src/generar.js ya reserva alrededor de CUALQUIER tier — así
  // que nunca hace falta forzar un hueco extra aquí para que coincidan)
  for (const m of ciudad.modulosMuralla) {
    if (m.tipo === "puerta") continue;
    const esTorre = m.tipo === "torre";
    const esMadera = m.material === "empalizada";
    const vx = Math.round(m.x * U), vz = Math.round(m.y * U);
    const hw = Math.round(U * (esTorre ? 0.55 : 0.4));
    const alto = Math.round(U * (esTorre ? 3.0 : 2.3) * (0.92 + rnd() * 0.16));
    const base = esMadera ? MADERA : PIEDRA;
    const tono = esTorre ? sombrear(base, 0.82) : base;
    b.caja(vx - hw, 0, vz - hw, vx + hw - 1, alto - 1, vz + hw - 1, tono);
    if (esTorre) {
      // remate/almena simple encima de cada torre — rompe la silueta plana
      const hw2 = Math.round(hw * 0.65);
      b.caja(vx - hw2, alto, vz - hw2, vx + hw2 - 1, alto + Math.round(U * 0.18) - 1, vz + hw2 - 1, sombrear(base, 0.7));
    }
  }

  // --- tejados: solo una LÁMINA fina por edificio real (nunca el bloque
  // entero desde el suelo — con hasta 125 edificios reales en capital_jarl,
  // un bloque sólido de pared a pared multiplicaba el recuento de vóxeles
  // a exportar por nada visible de más: desde la cámara isométrica fija de
  // este juego, una lámina delgada a la altura de tejado se lee IGUAL que
  // un bloque macizo — silueta idéntica, una fracción del coste real ---
  let indice = 0;
  const ESPESOR_TEJADO = Math.max(2, Math.round(U * 0.28));
  for (const ed of ciudad.edificios) {
    const w = Math.max(2, Math.round((ed.w || 6) * U * 0.82));
    const d = Math.max(2, Math.round((ed.h || 6) * U * 0.82));
    const vx = Math.round(ed.cx * U), vz = Math.round(ed.cy * U);
    const y0 = Math.round(U * (0.9 + rnd() * 0.6));
    const tono = TECHOS[indice % TECHOS.length];
    b.caja(vx - w / 2, y0, vz - d / 2, vx + w / 2 - 1, y0 + ESPESOR_TEJADO - 1, vz + d / 2 - 1, tono);
    indice++;
  }

  return { grid: [gx, Math.round(U * 3.4), gz], paleta: b.paleta, cajas: b.cajas };
}

module.exports = { generarSiluetaCiudad, U };
