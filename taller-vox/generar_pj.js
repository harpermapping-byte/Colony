"use strict";
// Generador PARAMÉTRICO de personajes (PJ/NPC) en vóxeles — evolución de
// generar_personaje.js. Mismo esqueleto de 15 huesos y mismos nombres de
// hueso (el cliente y las animaciones no distinguen un PJ de otro), pero la
// CARNE se genera a partir de parámetros: sexo, altura, peso, pelo, barba,
// tono de piel. El cuerpo va desnudo (anatomía estilizada, criterio
// "muñeco anatómico": sirve para distinguir siluetas, la ropa se genera
// aparte y se colgará de los mismos huesos).
//
// Por qué más resolución que el prototipo (34 vóxeles): con ~56 vóxeles de
// alto hay vóxeles suficientes para que cintura/cadera/hombros/pecho se
// distingan de verdad entre personajes. La densidad es FIJA por metro
// (VOXELES_POR_METRO): un PJ alto tiene más vóxeles, no vóxeles más
// grandes, y así dos PJ juntos en el juego tienen el mismo grano.
//
// Determinismo: sin Math.random(). generarPJ() es una función pura de sus
// parámetros; pjAleatorio(semilla) deriva parámetros con mulberry32 (el
// mismo PRNG que usa el resto del proyecto).

const VOXELES_POR_METRO = 32; // 1 vóxel = 3,125 cm
const UNIT = 1 / VOXELES_POR_METRO;

const TONOS_PIEL = {
  claro: "#e8b98a",
  medio: "#d9a066",
  moreno: "#a56a42",
  oscuro: "#6f4a2f",
};
const COLORES_PELO = {
  negro: "#241d16",
  castano: "#3a2a1a",
  rubio: "#b8934a",
  pelirrojo: "#8a4520",
  canoso: "#9a938c",
};
const ESTILOS_PELO = ["calvo", "rapado", "corto", "melena", "coleta"];
const ESTILOS_BARBA = ["ninguna", "perilla", "corta", "completa"];
const COLOR_OJOS = "#2b2825";

const DEFECTOS = {
  sexo: "hombre",        // "hombre" | "mujer"
  alturaMetros: 1.75,    // altura total, pies a coronilla
  peso: 0.5,             // 0 = muy delgado … 1 = muy corpulento (no cambia la altura)
  tonoPiel: "medio",     // clave de TONOS_PIEL o un "#rrggbb" directo
  pelo: "corto",         // clave de ESTILOS_PELO
  colorPelo: "castano",  // clave de COLORES_PELO o "#rrggbb"
  barba: "ninguna",      // clave de ESTILOS_BARBA (ignorada si sexo=mujer)
};

function resolverColor(valor, tabla) {
  if (typeof valor === "string" && valor.startsWith("#")) return valor;
  return tabla[valor] || Object.values(tabla)[0];
}

// Oscurece un poco un color hex — para dar dos tonos al mismo material
// (p.ej. pezón/areola apenas más oscuros que la piel) sin ampliar la paleta.
function oscurecer(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.round(v * f));
  return "#" + ((c((n >> 16) & 255) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, "0");
}

function generarPJ(params = {}) {
  const p = { ...DEFECTOS, ...params };
  const esMujer = p.sexo === "mujer";
  const H = Math.max(24, Math.round(p.alturaMetros * VOXELES_POR_METRO));
  const peso = Math.min(1, Math.max(0, p.peso));

  const piel = resolverColor(p.tonoPiel, TONOS_PIEL);
  const pielSombra = oscurecer(piel, 0.82);
  const pelo = resolverColor(p.colorPelo, COLORES_PELO);

  // Redondeos: rInt para longitudes (mínimo 1), rHalf para semianchos.
  const rInt = (f) => Math.max(1, Math.round(f * H));

  // ---- proporciones verticales (fracciones de H) ---------------------------
  const footH = rInt(0.04);
  const lowerLegLen = rInt(0.23);
  const upperLegLen = rInt(0.23);
  const hipY = footH + lowerLegLen + upperLegLen; // ~0.5H: la entrepierna a media altura
  const torsoLen = rInt(0.36);
  const headLen = rInt(0.14);
  const T = torsoLen;

  // ---- grosores: sexo + peso ----------------------------------------------
  // El peso escala TODOS los grosores (0.8×–1.3×); el sexo redistribuye:
  // hombro/cadera son la diferencia de silueta principal entre sexos.
  const g = 0.8 + 0.5 * peso;
  const mHombro = esMujer ? 0.88 : 1.15;
  const mPecho = esMujer ? 0.92 : 1.05;
  const mCintura = esMujer ? 0.80 : 1.0;
  const mCadera = esMujer ? 1.12 : 0.92;

  const shoulderHalf = rInt(0.100 * mHombro * g);
  const chestHalf = rInt(0.090 * mPecho * g);
  const waistHalf = rInt(0.068 * mCintura * g);
  const hipHalf = rInt(0.082 * mCadera * g);
  const torsoHalfD = rInt(0.052 * g);
  const headHalf = rInt(0.062);
  const headHalfD = rInt(0.058);

  const brazoHalf = rInt(0.032 * (esMujer ? 0.9 : 1.05) * g);
  const antebrazoHalf = Math.max(1, brazoHalf - (peso > 0.35 ? 1 : 0));
  const musloHalf = rInt(0.046 * (esMujer ? 1.05 : 1.0) * g);
  const pantorrillaHalf = Math.max(1, musloHalf - 1);
  const legOffX = Math.max(musloHalf, Math.round(hipHalf * 0.52));
  const armOffX = shoulderHalf + brazoHalf;

  const upperArmLen = rInt(0.19);
  const lowerArmLen = rInt(0.16);
  const handLen = rInt(0.075);
  const footLen = rInt(0.11);

  // ---- esqueleto (idéntico en nombres/jerarquía al prototipo) -------------
  const bones = [];
  function hueso(name, parent, offset, cajas) {
    bones.push({ name, parent, offset, cajas });
    return bones.length - 1;
  }
  // caja(x0,y0,z0, x1,y1,z1, color) inclusiva, en espacio LOCAL del hueso.
  // Las cajas posteriores SOBRESCRIBEN a las anteriores en el mismo vóxel
  // (así los ojos/pelo se "pintan" encima del cráneo sin recortar cajas).
  const caja = (x0, y0, z0, x1, y1, z1, c) => [x0, y0, z0, x1, y1, z1, c];

  // --- torso: cuatro tramos apilados para tener silueta real ---------------
  const yCadera = Math.round(0.20 * T);
  const yCintura = Math.round(0.50 * T);
  const yPecho = Math.round(0.88 * T);
  const cajasTorso = [
    caja(-hipHalf, 0, -torsoHalfD, hipHalf - 1, yCadera - 1, torsoHalfD - 1, piel),          // pelvis
    caja(-waistHalf, yCadera, -torsoHalfD + (waistHalf < hipHalf ? 1 : 0), waistHalf - 1, yCintura - 1, torsoHalfD - 1, piel), // cintura (algo menos profunda)
    caja(-chestHalf, yCintura, -torsoHalfD, chestHalf - 1, yPecho - 1, torsoHalfD - 1, piel), // pecho
    caja(-shoulderHalf, yPecho, -torsoHalfD, shoulderHalf - 1, T - 1, torsoHalfD - 1, piel),  // hombros
    // glúteos: una capa extra por detrás de la pelvis, en ambos sexos
    caja(-Math.max(1, hipHalf - 1), 0, -torsoHalfD - 1, Math.max(0, hipHalf - 2), Math.round(0.16 * T), -torsoHalfD - 1, piel),
  ];
  if (esMujer) {
    // pecho femenino: una capa saliente delante del tramo de pecho
    const bHalf = Math.max(1, Math.round(chestHalf * 0.75));
    const y0 = Math.round(0.58 * T), y1 = Math.round(0.74 * T);
    cajasTorso.push(caja(-bHalf, y0, torsoHalfD, bHalf - 1, y1, torsoHalfD, piel));
    cajasTorso.push(caja(-bHalf, y0 + 1, torsoHalfD + 1, bHalf - 1, y0 + 1, torsoHalfD + 1, pielSombra)); // pezones (línea, 1 vóxel de saliente)
  } else {
    // pecho masculino: pezones planos (2 vóxeles sombreados sobre el pecho)
    const y = Math.round(0.72 * T);
    const x = Math.max(1, Math.round(chestHalf * 0.5));
    cajasTorso.push(caja(-x - 1, y, torsoHalfD - 1, -x, y, torsoHalfD - 1, pielSombra));
    cajasTorso.push(caja(x - 1, y, torsoHalfD - 1, x, y, torsoHalfD - 1, pielSombra));
  }
  if (peso > 0.6) {
    // barriga: capa extra delante de la cintura cuando el peso es alto
    cajasTorso.push(caja(-waistHalf, yCadera, torsoHalfD, waistHalf - 1, yCintura - 1, torsoHalfD, piel));
  }

  hueso("hips", null, [0, hipY, 0], [
    // genitales estilizados (criterio muñeco anatómico): bulto de 2×2×1 en
    // el hombre; en la mujer el propio hueco del triángulo pélvico. No es
    // contenido sexual: distingue PJ desnudos hasta que exista la ropa.
    ...(esMujer ? [] : [caja(-1, -2, torsoHalfD - 1, 0, -1, torsoHalfD - 1, pielSombra)]),
  ]);
  hueso("spine", "hips", [0, 0, 0], cajasTorso);

  // --- cabeza: cráneo + cara (ojos/nariz) + pelo + barba --------------------
  const cajasCabeza = [
    caja(-headHalf, 0, -headHalfD, headHalf - 1, headLen - 1, headHalfD - 1, piel),
  ];
  const yOjos = Math.round(0.55 * headLen);
  const xOjo = Math.max(1, Math.round(headHalf * 0.45));
  // 1 vóxel por ojo: con 2 se fundían en una sola banda oscura tipo visera
  cajasCabeza.push(caja(-xOjo - 1, yOjos, headHalfD - 1, -xOjo - 1, yOjos, headHalfD - 1, COLOR_OJOS));
  cajasCabeza.push(caja(xOjo, yOjos, headHalfD - 1, xOjo, yOjos, headHalfD - 1, COLOR_OJOS));
  cajasCabeza.push(caja(-1, Math.round(0.38 * headLen), headHalfD, 0, Math.round(0.42 * headLen), headHalfD, pielSombra)); // nariz

  const capaPelo = Math.max(1, Math.round(headLen * 0.22));
  const yPelo = headLen - capaPelo;
  switch (p.pelo) {
    case "calvo":
      break;
    case "rapado": // franja superior pintada SOBRE el cráneo (sin volumen)
      cajasCabeza.push(caja(-headHalf, yPelo, -headHalfD, headHalf - 1, headLen - 1, headHalfD - 1, pelo));
      break;
    case "corto": // casquete con algo de volumen + nuca
      cajasCabeza.push(caja(-headHalf, yPelo, -headHalfD, headHalf - 1, headLen, headHalfD - 1, pelo));
      cajasCabeza.push(caja(-headHalf, Math.round(0.35 * headLen), -headHalfD - 1, headHalf - 1, headLen, -headHalfD - 1, pelo));
      break;
    case "melena": // casquete + laterales + espalda cayendo por debajo de la cabeza
      cajasCabeza.push(caja(-headHalf - 1, yPelo, -headHalfD - 1, headHalf, headLen, headHalfD - 2, pelo));
      cajasCabeza.push(caja(-headHalf - 1, -Math.round(0.5 * headLen), -headHalfD - 1, -headHalf - 1, headLen, headHalfD - 3, pelo));
      cajasCabeza.push(caja(headHalf, -Math.round(0.5 * headLen), -headHalfD - 1, headHalf, headLen, headHalfD - 3, pelo));
      // la caída trasera no es más ancha que la cabeza — si no parece una losa
      cajasCabeza.push(caja(-headHalf, -Math.round(0.55 * headLen), -headHalfD - 1, headHalf - 1, headLen, -headHalfD - 1, pelo));
      break;
    case "coleta": // casquete + cola por detrás
      cajasCabeza.push(caja(-headHalf, yPelo, -headHalfD, headHalf - 1, headLen, headHalfD - 1, pelo));
      cajasCabeza.push(caja(-1, Math.round(0.3 * headLen), -headHalfD - 2, 0, headLen - 1, -headHalfD - 1, pelo));
      cajasCabeza.push(caja(-1, -Math.round(0.6 * headLen), -headHalfD - 2, 0, Math.round(0.3 * headLen), -headHalfD - 2, pelo));
      break;
  }
  if (!esMujer) {
    switch (p.barba) {
      case "perilla": // mentón
        cajasCabeza.push(caja(-1, 0, headHalfD, 0, Math.round(0.18 * headLen), headHalfD, pelo));
        break;
      case "corta": // franja de mandíbula
        cajasCabeza.push(caja(-Math.max(1, headHalf - 1), 0, headHalfD, Math.max(0, headHalf - 2), Math.round(0.25 * headLen), headHalfD, pelo));
        break;
      case "completa": // mandíbula + caída por debajo del mentón
        cajasCabeza.push(caja(-Math.max(1, headHalf - 1), 0, headHalfD, Math.max(0, headHalf - 2), Math.round(0.3 * headLen), headHalfD, pelo));
        cajasCabeza.push(caja(-Math.max(1, headHalf - 2), -Math.round(0.2 * headLen), headHalfD - 1, Math.max(0, headHalf - 3), -1, headHalfD, pelo));
        break;
    }
  }
  hueso("head", "spine", [0, torsoLen, 0], cajasCabeza);

  // --- brazos (desnudos: todo piel, con antebrazo más fino) -----------------
  function brazo(lado, signo) {
    const x0 = signo * armOffX;
    hueso("upperarm." + lado, "spine", [x0, T - Math.round(0.06 * T) - 1, 0], [
      caja(-brazoHalf, -upperArmLen, -brazoHalf, brazoHalf - 1, -1, brazoHalf - 1, piel),
      caja(-brazoHalf, -Math.round(upperArmLen * 0.3), -brazoHalf, brazoHalf - 1, 0, brazoHalf - 1, piel), // hombro redondeado hacia arriba
    ]);
    hueso("lowerarm." + lado, "upperarm." + lado, [0, -upperArmLen, 0], [
      caja(-antebrazoHalf, -lowerArmLen, -antebrazoHalf, antebrazoHalf - 1, -1, antebrazoHalf - 1, piel),
    ]);
    hueso("hand." + lado, "lowerarm." + lado, [0, -lowerArmLen, 0], [
      caja(-antebrazoHalf, -handLen, -antebrazoHalf, antebrazoHalf - 1, -1, antebrazoHalf - 1, pielSombra),
    ]);
  }
  brazo("L", 1);
  brazo("R", -1);

  // --- piernas (descalzas: el pie es piel, no zapato) -----------------------
  function pierna(lado, signo) {
    const x0 = signo * legOffX;
    hueso("upperleg." + lado, "hips", [x0, 0, 0], [
      caja(-musloHalf, -upperLegLen, -musloHalf, musloHalf - 1, -1, musloHalf - 1, piel),
    ]);
    hueso("lowerleg." + lado, "upperleg." + lado, [0, -upperLegLen, 0], [
      caja(-pantorrillaHalf, -lowerLegLen, -pantorrillaHalf, pantorrillaHalf - 1, -1, pantorrillaHalf - 1, piel),
    ]);
    hueso("foot." + lado, "lowerleg." + lado, [0, -lowerLegLen, 0], [
      caja(-pantorrillaHalf, -footH, -pantorrillaHalf, pantorrillaHalf - 1, -1, footLen - pantorrillaHalf - 1, pielSombra),
    ]);
  }
  pierna("L", 1);
  pierna("R", -1);

  return {
    bones,
    alturaVoxeles: H,
    unit: UNIT,
    meta: {
      sexo: p.sexo,
      alturaMetros: p.alturaMetros,
      peso,
      tonoPiel: p.tonoPiel,
      pelo: p.pelo,
      colorPelo: p.colorPelo,
      barba: esMujer ? "ninguna" : p.barba,
    },
  };
}

// ---- personaje aleatorio determinista --------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pjAleatorio(semilla) {
  const rnd = mulberry32(semilla >>> 0);
  const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
  const sexo = rnd() < 0.5 ? "hombre" : "mujer";
  return generarPJ({
    sexo,
    alturaMetros: +(1.5 + rnd() * 0.45).toFixed(2),
    peso: +rnd().toFixed(2),
    tonoPiel: elegir(Object.keys(TONOS_PIEL)),
    pelo: elegir(ESTILOS_PELO),
    colorPelo: elegir(Object.keys(COLORES_PELO)),
    barba: sexo === "hombre" ? elegir(ESTILOS_BARBA) : "ninguna",
  });
}

// ---- los 3 PJ del test acordado con el usuario ------------------------------
const PRESETS_TEST = [
  {
    id: "pj1",
    nombre: "Hombre corpulento",
    params: { sexo: "hombre", alturaMetros: 1.9, peso: 0.85, tonoPiel: "moreno", pelo: "corto", colorPelo: "negro", barba: "completa" },
  },
  {
    id: "pj2",
    nombre: "Mujer delgada",
    params: { sexo: "mujer", alturaMetros: 1.62, peso: 0.25, tonoPiel: "claro", pelo: "melena", colorPelo: "pelirrojo" },
  },
  {
    id: "pj3",
    nombre: "Hombre bajo y medio",
    params: { sexo: "hombre", alturaMetros: 1.58, peso: 0.5, tonoPiel: "medio", pelo: "calvo", colorPelo: "castano", barba: "perilla" },
  },
];

module.exports = {
  generarPJ, pjAleatorio, PRESETS_TEST,
  TONOS_PIEL, COLORES_PELO, ESTILOS_PELO, ESTILOS_BARBA, VOXELES_POR_METRO, UNIT,
};

// ---- CLI --------------------------------------------------------------------
// node generar_pj.js test            -> genera vox/pj1..pj3.glb + vox/pjs_test.json
// node generar_pj.js params.json out.glb
// node generar_pj.js semilla:123 out.glb
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const { construirGLBConSkin } = require("./exportar_personaje_glb");
  const arg = process.argv[2];

  function exportar(esqueleto, outPath) {
    const glb = construirGLBConSkin(esqueleto, esqueleto.unit);
    fs.writeFileSync(outPath, glb);
    const m = esqueleto.meta;
    console.log(
      `${outPath}: ${m.sexo}, ${m.alturaMetros} m (${esqueleto.alturaVoxeles} vóxeles), peso ${m.peso}, ` +
      `pelo ${m.pelo}, barba ${m.barba} — ${esqueleto.bones.length} huesos, ${(glb.length / 1024).toFixed(0)} KB`
    );
  }

  if (arg === "test") {
    const dir = path.join(__dirname, "vox");
    fs.mkdirSync(dir, { recursive: true });
    const indice = [];
    for (const preset of PRESETS_TEST) {
      const esqueleto = generarPJ(preset.params);
      exportar(esqueleto, path.join(dir, preset.id + ".glb"));
      indice.push({ id: preset.id, nombre: preset.nombre, ...esqueleto.meta });
    }
    fs.writeFileSync(path.join(dir, "pjs_test.json"), JSON.stringify(indice, null, 2));
    console.log("Índice:", path.join(dir, "pjs_test.json"));
  } else if (arg && arg.startsWith("semilla:")) {
    exportar(pjAleatorio(Number(arg.slice(8)) || 1), process.argv[3] || "pj.glb");
  } else if (arg) {
    const params = JSON.parse(fs.readFileSync(arg, "utf8"));
    exportar(generarPJ(params), process.argv[3] || "pj.glb");
  } else {
    console.log("Uso: node generar_pj.js test | <params.json> [out.glb] | semilla:<n> [out.glb]");
  }
}
