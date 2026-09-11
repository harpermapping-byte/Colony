"use strict";
// Generador de vóxeles de OBJETOS (items/catalogo/items.json, tipo:"objeto",
// 77 ids) — HERRAMIENTA reutilizable, mismo patrón que generar_armas.js/
// generar_herramientas.js. Ver cabecera de generar_armas.js para el pacto
// de alcance (esto es la herramienta; el bakeo de producción lo lanza el
// streamer cuando decida).
//
// El más heterogéneo de los cuatro catálogos: vajilla, iluminación, papeles
// de mesa, sacos de semillas, una montura, 4 barcos y 40 ids "cadaver_*"
// (restos de caza/pesca — géneros MUY variados de bicho, sin silueta común
// razonable con el resto de objetos). Los 40 cadáveres quedan FUERA de
// cobertura a propósito (arquetipo "SIN_COBERTURA", generarObjeto() devuelve
// null) — documentado en docs/GDD_Motor_3D_Props.md, no forzado a un molde
// que no les pega; siguen con su placeholder actual hasta que el streamer
// decida un arquetipo propio para restos de animal.

const fs = require("fs");
const path = require("path");
const items = require("../items/catalogo/items.json");
const { sombrear, Builder, U, MADERA_MANGO, METAL_CLARO, METAL_OSCURO } = require("./itemsComun");

const IDS_OBJETO = Object.keys(items).filter((id) => items[id] && items[id].tipo === "objeto");

/** Vasija de mesa (plato/taza/cuenco/jarra/olla/caldero/cantimplora): cuerpo
 * troncocónico por capas (misma técnica que barril/tina de generar_modelos.js). */
function generarVasija(id, v) {
  const alto = /plato$/.test(id) ? 0.35 : /taza$|cuenco$/.test(id) ? 0.6 : /jarra_|cantimplora$/.test(id) ? 1.0 : 1.3;
  const gxz = Math.max(3, Math.round(U * (id === "plato" ? 1.1 : 0.7)));
  const gy = Math.max(2, Math.round(U * alto));
  const b = Builder();
  const capas = 5;
  const abombada = /plato$|cuenco$/.test(id); // más ancha arriba
  for (let i = 0; i < capas; i++) {
    const t = i / (capas - 1);
    const inset = Math.round((abombada ? t : (1 - t)) * gxz * 0.18);
    const y0 = Math.round((gy * i) / capas), y1 = Math.round((gy * (i + 1)) / capas) - 1;
    b.caja(inset, y0, inset, gxz - 1 - inset, y1, gxz - 1 - inset, i === capas - 1 ? sombrear(v.colorDebug, 1.15) : v.colorDebug);
  }
  if (/jarra_|cantimplora$/.test(id)) {
    // asa lateral en arco
    b.caja(gxz, Math.round(gy * 0.35), Math.round(gxz / 2) - 1, gxz + Math.max(1, Math.round(U * 0.1)), Math.round(gy * 0.75), Math.round(gxz / 2), METAL_OSCURO);
    return { grid: [gxz + Math.max(1, Math.round(U * 0.1)) + 1, gy, gxz], paleta: b.paleta, cajas: b.cajas };
  }
  return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Sartén: disco plano + mango largo lateral. */
function generarSarten(v) {
  const gxz = Math.max(4, Math.round(U * 0.8));
  const gy = Math.max(1, Math.round(U * 0.14));
  const mangoLargo = Math.max(3, Math.round(U * 0.9));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, gy - 1, gxz - 1, v.colorDebug);
  b.caja(Math.max(1, Math.round(gxz * 0.1)), 0, Math.round(gxz * 0.1), gxz - 1 - Math.max(1, Math.round(gxz * 0.1)), 1, gxz - 1 - Math.round(gxz * 0.1), sombrear(v.colorDebug, 1.2)); // interior antiadherente
  b.caja(-mangoLargo, 0, Math.round(gxz / 2) - 1, -1, gy - 1, Math.round(gxz / 2), METAL_OSCURO);
  return { grid: [gxz + mangoLargo, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Objeto de mesa plano: libro/pergamino/mapa/tintero/dados/cartas/moneda —
 * losa fina con una segunda capa de acento (tapa/portada/borde). */
function generarPlano(id, v) {
  const grosor = /dados$|moneda_suelta$/.test(id) ? 0.35 : 0.22;
  const gxz = Math.max(3, Math.round(U * (id === "mapa_mesa" || id === "pergamino" ? 0.9 : 0.55)));
  const gy = Math.max(1, Math.round(U * grosor));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, gy - 1, gxz - 1, v.colorDebug);
  if (/^libro$/.test(id)) {
    b.caja(0, gy - 1, 0, Math.max(1, Math.round(gxz * 0.08)), gy - 1, gxz - 1, sombrear(v.colorDebug, 0.6)); // lomo
  } else if (id === "dados") {
    // dos cubos pequeños en vez de una losa
    const c = Math.max(2, Math.round(U * 0.22));
    b.cajas.length = 0; b.paleta.length = 0;
    b.caja(0, 0, 0, c - 1, c - 1, c - 1, v.colorDebug);
    b.caja(c + 1, 0, Math.round(c / 2), 2 * c, c - 1, Math.round(c / 2) + c - 1, v.colorDebug);
    return { grid: [2 * c + 1, c, 2 * c], paleta: b.paleta, cajas: b.cajas };
  } else if (id === "moneda_suelta") {
    b.caja(1, gy, 1, gxz - 2, gy, gxz - 2, sombrear(v.colorDebug, 1.3)); // brillo
  }
  return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Iluminación de mesa (vela/lámpara de aceite/brasero): base + llama, sin
 * escuadra de pared (es de mesa, no colgada) — mismo espíritu que
 * generarFuegoPared() de generar_modelos.js pero de pie. */
function generarIluminacion(id, v) {
  const esBrasero = id === "brasero";
  const gxz = Math.max(2, Math.round(U * (esBrasero ? 0.7 : 0.3)));
  const baseH = Math.max(1, Math.round(U * (esBrasero ? 0.35 : 0.2)));
  const b = Builder();
  b.caja(0, 0, 0, gxz - 1, baseH - 1, gxz - 1, v.colorDebug);
  const llamaY0 = baseH;
  const llamaW = Math.max(1, Math.round(gxz * 0.5));
  const cx = Math.round(gxz / 2);
  b.caja(cx - Math.round(llamaW / 2), llamaY0, cx - Math.round(llamaW / 2), cx - Math.round(llamaW / 2) + llamaW - 1, llamaY0 + Math.max(1, Math.round(U * 0.16)), cx - Math.round(llamaW / 2) + llamaW - 1, "#ffb545");
  return { grid: [gxz, llamaY0 + Math.max(1, Math.round(U * 0.16)) + 1, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Higiene (jabón/toalla): jabón = pastilla redondeada, toalla = pila de tela plegada. */
function generarHigiene(id, v) {
  const b = Builder();
  if (id === "jabon") {
    const gxz = Math.max(2, Math.round(U * 0.35)), gy = Math.max(1, Math.round(U * 0.16));
    b.caja(0, 0, 0, gxz - 1, gy - 1, gxz - 1, v.colorDebug);
    return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
  }
  const gxz = Math.max(3, Math.round(U * 0.6)), capas = 4;
  for (let i = 0; i < capas; i++) {
    const inset = i;
    b.caja(inset, i * 2, inset, gxz - 1 - inset, i * 2 + 1, gxz - 1 - inset, i % 2 === 0 ? v.colorDebug : sombrear(v.colorDebug, 0.85));
  }
  return { grid: [gxz, capas * 2, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Contenedor pequeño (cubo de madera / jaula de pájaro): cubo = balde
 * troncocónico con asa, jaula = barrotes sobre base. */
function generarContenedorPequeno(id, v) {
  const b = Builder();
  if (id === "cubo_madera") {
    const gxz = Math.max(3, Math.round(U * 0.6)), gy = Math.max(2, Math.round(U * 0.65));
    const capas = 4;
    for (let i = 0; i < capas; i++) {
      const t = i / (capas - 1);
      const inset = Math.round((1 - t) * gxz * 0.14);
      const y0 = Math.round((gy * i) / capas), y1 = Math.round((gy * (i + 1)) / capas) - 1;
      b.caja(inset, y0, inset, gxz - 1 - inset, y1, gxz - 1 - inset, v.colorDebug);
    }
    b.caja(-1, gy, Math.round(gxz / 2) - 1, gxz, gy + Math.max(1, Math.round(U * 0.16)), Math.round(gxz / 2), METAL_OSCURO);
    return { grid: [gxz, gy + Math.max(1, Math.round(U * 0.16)) + 1, gxz], paleta: b.paleta, cajas: b.cajas };
  }
  // jaula_pajaro: base + barrotes verticales + cúpula
  const gxz = Math.max(4, Math.round(U * 0.7)), gy = Math.max(4, Math.round(U * 0.9));
  b.caja(0, 0, 0, gxz - 1, Math.max(1, Math.round(U * 0.08)) - 1, gxz - 1, MADERA_MANGO);
  const nBarrotes = 8;
  for (let i = 0; i < nBarrotes; i++) {
    const ang = (i / nBarrotes) * Math.PI * 2;
    const x = Math.round(gxz / 2 + Math.cos(ang) * gxz * 0.42);
    const z = Math.round(gxz / 2 + Math.sin(ang) * gxz * 0.42);
    b.caja(x, Math.round(U * 0.08), z, x, gy - Math.round(U * 0.15), z, v.colorDebug);
  }
  b.caja(Math.round(gxz * 0.15), gy - Math.round(U * 0.15), Math.round(gxz * 0.15), gxz - 1 - Math.round(gxz * 0.15), gy - 1, gxz - 1 - Math.round(gxz * 0.15), v.colorDebug); // cúpula
  return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Saco de semillas: bolsa de tela abombada, atada por el cuello. */
function generarSaco(v) {
  const gxz = Math.max(3, Math.round(U * 0.55)), gy = Math.max(3, Math.round(U * 0.7));
  const b = Builder();
  const capas = 4;
  for (let i = 0; i < capas; i++) {
    const t = i / (capas - 1);
    const bulge = Math.sin(t * Math.PI * 0.8);
    const inset = Math.round((1 - bulge) * gxz * 0.35);
    const y0 = Math.round((gy * i) / capas), y1 = Math.round((gy * (i + 1)) / capas) - 1;
    b.caja(inset, y0, inset, gxz - 1 - inset, y1, gxz - 1 - inset, v.colorDebug);
  }
  b.caja(Math.round(gxz * 0.35), gy, Math.round(gxz * 0.35), gxz - 1 - Math.round(gxz * 0.35), gy + Math.max(1, Math.round(U * 0.08)), gxz - 1 - Math.round(gxz * 0.35), sombrear(v.colorDebug, 0.7)); // atado del cuello
  return { grid: [gxz, gy + Math.max(1, Math.round(U * 0.08)) + 1, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Montura de caballo: asiento curvo (aproximado por escalones) + faldones
 * laterales + cincha. */
function generarMontura(v) {
  const gx = Math.max(6, Math.round(U * 1.4)), gz = Math.max(4, Math.round(U * 0.9)), gy = Math.max(2, Math.round(U * 0.5));
  const b = Builder();
  const escalones = 6;
  for (let i = 0; i < escalones; i++) {
    const t = i / (escalones - 1);
    const bulge = 1 - Math.pow(Math.abs(t - 0.5) * 2, 2); // más alto en el centro (asiento), sube en los bordes (perilla/tras)
    const y1 = Math.max(1, Math.round(gy * (0.4 + bulge * 0.6)));
    const x0 = Math.round((gx * i) / escalones), x1 = Math.round((gx * (i + 1)) / escalones) - 1;
    b.caja(x0, 0, 0, x1, y1 - 1, gz - 1, v.colorDebug);
  }
  // faldones laterales colgantes
  b.caja(Math.round(gx * 0.3), -Math.round(gy * 0.6), 0, Math.round(gx * 0.7), -1, Math.max(1, Math.round(U * 0.1)) - 1, sombrear(v.colorDebug, 0.8));
  b.caja(Math.round(gx * 0.3), -Math.round(gy * 0.6), gz - Math.max(1, Math.round(U * 0.1)), Math.round(gx * 0.7), -1, gz - 1, sombrear(v.colorDebug, 0.8));
  return { grid: [gx, gy, gz], paleta: b.paleta, cajas: b.cajas, offsetY: Math.round(gy * 0.6) };
}

/** Herbolario (mortero de mano / hierbas secas atadas): reutiliza vasija
 * pequeña o un manojo colgante de tallos. */
function generarHerbolario(id, v) {
  if (id === "mortero_mano") return generarVasija("cuenco", v);
  const b = Builder();
  const gxz = Math.max(2, Math.round(U * 0.3)), gy = Math.max(3, Math.round(U * 0.7));
  b.caja(Math.round(gxz / 2) - 1, gy - Math.max(1, Math.round(U * 0.08)), Math.round(gxz / 2) - 1, Math.round(gxz / 2), gy - 1, Math.round(gxz / 2), sombrear(v.colorDebug, 0.6)); // atado
  const escalones = 3;
  for (let i = 0; i < escalones; i++) {
    const y0 = Math.round((gy * i) / (escalones + 1)), y1 = Math.round((gy * (i + 1)) / (escalones + 1)) - 1;
    const w = gxz - i;
    b.caja(Math.round((gxz - w) / 2), y0, Math.round((gxz - w) / 2), Math.round((gxz - w) / 2) + w - 1, y1, Math.round((gxz - w) / 2) + w - 1, v.colorDebug);
  }
  return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Arnés de tiro (docs/GDD_Carros.md §2): yugo de madera horizontal + dos
 * correas de cuero colgando de los extremos — se lleva al cuello/pecho del
 * animal para tirar de un carro, silueta bien distinta de una silla de
 * MONTAR (esa es un asiento; esto es un yugo con correas). */
function generarArnes(v) {
  const anchoYugo = Math.max(6, Math.round(U * 1.1));
  const grosorYugo = Math.max(1, Math.round(U * 0.14));
  const largoCorrea = Math.max(3, Math.round(U * 0.6));
  const b = Builder();
  const cuero = v.colorDebug;
  // yugo: barra horizontal de madera por encima de las correas
  b.caja(0, largoCorrea, 0, anchoYugo - 1, largoCorrea + grosorYugo - 1, grosorYugo - 1, MADERA_MANGO);
  // dos correas de cuero colgando de cada extremo del yugo
  b.caja(0, 0, 0, grosorYugo - 1, largoCorrea - 1, grosorYugo - 1, cuero);
  b.caja(anchoYugo - grosorYugo, 0, 0, anchoYugo - 1, largoCorrea - 1, grosorYugo - 1, cuero);
  // hebilla metálica central donde se engancha el tiro del carro
  const cx = Math.round(anchoYugo / 2);
  b.caja(cx - 1, 0, 0, cx, Math.max(1, Math.round(U * 0.1)) - 1, grosorYugo - 1, METAL_OSCURO);
  return { grid: [anchoYugo, largoCorrea + grosorYugo, grosorYugo], paleta: b.paleta, cajas: b.cajas };
}

/** Herramienta de mesa reutilizada: martillo/tenazas/herradura/clavos —
 * mismos arquetipos que generar_herramientas.js, importados aquí para no
 * duplicar geometría (misma silueta real, catálogo de origen distinto). */
function generarHerramientaMesa(id, v) {
  const { generarHerramienta } = require("./generar_herramientas");
  if (id === "martillo" || id === "tenazas") {
    // hay ids homónimos en items.json (objeto) vs una herramienta real del
    // otro catálogo — se genera con el mismo arquetipo directamente aquí
    // para no depender de que exista una entrada con ese id en el otro json.
    const arq = id === "martillo" ? require("./generar_herramientas").ARQUETIPO_FN.MARTILLO : require("./generar_herramientas").ARQUETIPO_FN.TENAZAS;
    return arq(v, id);
  }
  if (id === "clavos") {
    const b = Builder();
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x = i * 3;
      b.caja(x, 0, 0, x, Math.max(2, Math.round(U * 0.3)) - 1, 0, v.colorDebug);
      b.caja(x - 1, Math.max(2, Math.round(U * 0.3)), 0, x + 1, Math.max(2, Math.round(U * 0.3)), 0, sombrear(v.colorDebug, 1.2));
    }
    return { grid: [n * 3, Math.max(2, Math.round(U * 0.3)) + 1, 1], paleta: b.paleta, cajas: b.cajas };
  }
  // herradura: arco en U (mitad de circunferencia) aproximado por escalones
  // tumbados en el plano x/z, apoyada plana en el suelo (grosor = alto)
  const b = Builder();
  const gxz = Math.max(4, Math.round(U * 0.6));
  const grosor = Math.max(1, Math.round(U * 0.12));
  const radio = gxz * 0.42;
  const cx = gxz / 2, cz = gxz * 0.15;
  const escalones = 8;
  for (let i = 0; i <= escalones; i++) {
    const ang = Math.PI * (0.08 + 0.84 * (i / escalones)); // de casi 0 a casi PI: arco abierto hacia -z (los clavos)
    const x = Math.round(cx + Math.cos(ang) * radio);
    const z = Math.round(cz + Math.sin(ang) * radio);
    b.caja(x, 0, z, x + grosor - 1, grosor - 1, z + grosor - 1, v.colorDebug);
  }
  return { grid: [gxz, grosor, gxz], paleta: b.paleta, cajas: b.cajas };
}

// --- clasificador ------------------------------------------------------------

const IDS_VASIJA = new Set(["plato", "taza", "cuenco", "cantimplora", "jarra_cerveza", "olla", "caldero"]);
const IDS_PLANO = new Set(["libro", "pergamino", "mapa_mesa", "tintero_pluma", "dados", "baraja_cartas", "moneda_suelta", "joyero_pequeno", "reliquia", "frasco_pocion"]);
const IDS_ILUMINACION = new Set(["vela_mesa", "lampara_aceite", "brasero"]);
const IDS_HIGIENE = new Set(["jabon", "toalla"]);
const IDS_CONTENEDOR = new Set(["cubo_madera", "jaula_pajaro"]);
const IDS_HERBOLARIO = new Set(["mortero_mano", "hierbas_secas"]);
const IDS_HERRAMIENTA_MESA = new Set(["martillo", "tenazas", "herradura", "clavos"]);
const IDS_ARNES = new Set(["arnes_cuero", "arnes_reforzado"]); // docs/GDD_Carros.md §2

// --- Expositores (docs/GDD_Construccion.md §9.7, 2026-09-11) ------------------
// Lo que un jugador deja sobre una estantería/vitrina/maniquí se dibuja con
// su `.glb` real. Armas y herramientas ya tenían el suyo; esto cubre lo que
// NO es `tipo:"objeto"` pero sí acaba en un expositor: pociones/elixires
// (consumibles), libros, joyas (anillo/cuello/brazalete) y piezas de
// armadura (maniquí). Son formas GENÉRICAS por familia coloreadas con el
// `colorDebug` del ítem — un frasco es un frasco, lo que cambia es el color
// del líquido — para no inventar 80 siluetas a mano.
const RE_POCION = /pocion|elixir|tonico|antidoto|jarabe/;
const SLOTS_JOYA = new Set(["anillo", "cuello", "brazalete"]);
const IDS_EXPOSITOR = Object.keys(items).filter((id) => {
  const v = items[id];
  if (!v || typeof v !== "object") return false;
  if (v.tipo === "consumible" && RE_POCION.test(id)) return true;
  if (v.tipo === "libro") return true;
  if (v.tipo === "equipable" && SLOTS_JOYA.has(v.slotEquipo)) return true;
  if (v.tipo === "armadura") return true;
  return false;
});

/** Frasco de poción: cuerpo ancho del color del líquido, cuello estrecho de cristal y corcho. */
function generarFrasco(id, v) {
  const grande = /grande/.test(id);
  const gxz = Math.max(3, Math.round(U * (grande ? 0.5 : 0.36)));
  const gy = Math.max(4, Math.round(U * (grande ? 0.9 : 0.7)));
  const b = Builder();
  const cuerpoH = Math.round(gy * 0.55), cuelloW = Math.max(1, Math.round(gxz * 0.4));
  const c0 = Math.round((gxz - cuelloW) / 2);
  b.caja(0, 0, 0, gxz - 1, cuerpoH - 1, gxz - 1, v.colorDebug); // líquido
  b.caja(0, cuerpoH, 0, gxz - 1, cuerpoH, gxz - 1, "#bcd6dc"); // hombro de cristal
  b.caja(c0, cuerpoH + 1, c0, c0 + cuelloW - 1, gy - 2, c0 + cuelloW - 1, "#bcd6dc"); // cuello
  b.caja(c0, gy - 1, c0, c0 + cuelloW - 1, gy - 1, c0 + cuelloW - 1, MADERA_MANGO); // corcho
  return { grid: [gxz, gy, gxz], paleta: b.paleta, cajas: b.cajas };
}

/** Joya: anillo/brazalete = aro cuadrado hueco tumbado; collar = óvalo plano de eslabones con colgante. */
function generarJoya(id, v) {
  const b = Builder();
  const metal = v.colorDebug;
  if (v.slotEquipo === "cuello") {
    const g = Math.max(5, Math.round(U * 0.6));
    for (let x = 0; x < g; x++) for (let z = 0; z < g; z++) {
      const dx = (x - (g - 1) / 2) / (g / 2), dz = (z - (g - 1) / 2) / (g / 2);
      const r = Math.hypot(dx, dz);
      if (r > 0.7 && r <= 1.0) b.caja(x, 0, z, x, 0, z, metal);
    }
    b.caja(Math.round(g / 2) - 1, 0, g - 2, Math.round(g / 2), 1, g - 1, sombrear(metal, 1.3)); // colgante
    return { grid: [g, 2, g], paleta: b.paleta, cajas: b.cajas };
  }
  const g = Math.max(3, Math.round(U * (v.slotEquipo === "brazalete" ? 0.45 : 0.28)));
  const gy = Math.max(1, Math.round(U * (v.slotEquipo === "brazalete" ? 0.18 : 0.1)));
  b.caja(0, 0, 0, g - 1, gy - 1, 0, metal); b.caja(0, 0, g - 1, g - 1, gy - 1, g - 1, metal);
  b.caja(0, 0, 0, 0, gy - 1, g - 1, metal); b.caja(g - 1, 0, 0, g - 1, gy - 1, g - 1, metal);
  if (v.slotEquipo === "anillo" && /rubi|amatista|esmeralda|zafiro|diamante|gema/.test(id)) b.caja(Math.round(g / 2) - 1, gy, 0, Math.round(g / 2), gy, 0, sombrear(metal, 1.4)); // engaste
  return { grid: [g, gy + 1, g], paleta: b.paleta, cajas: b.cajas };
}

/** Pieza de armadura por slot: casco = cúpula, pechera = torso, manos/zapatos = par de bloques, piernas = dos columnas. */
function generarArmaduraPieza(id, v) {
  const b = Builder();
  const c = v.colorDebug, dark = sombrear(c, 0.7);
  const g = Math.max(4, Math.round(U * 0.55));
  switch (v.slotEquipo) {
    case "casco": {
      const capas = 4;
      for (let i = 0; i < capas; i++) {
        const inset = Math.round((i / capas) * g * 0.35);
        b.caja(inset, i, inset, g - 1 - inset, i, g - 1 - inset, i === 0 ? dark : c);
      }
      b.caja(Math.round(g * 0.3), 0, g - 1, Math.round(g * 0.7), 1, g - 1, "#1c1a17"); // visera
      return { grid: [g, capas, g], paleta: b.paleta, cajas: b.cajas };
    }
    case "pechera": {
      const gy = Math.round(g * 1.3);
      b.caja(0, 0, Math.round(g * 0.25), g - 1, gy - 1, Math.round(g * 0.75), c);
      b.caja(Math.round(g * 0.3), 0, Math.round(g * 0.2), Math.round(g * 0.7), gy - 1, Math.round(g * 0.2), dark); // cierre frontal
      return { grid: [g, gy, g], paleta: b.paleta, cajas: b.cajas };
    }
    case "piernas": {
      const gy = Math.round(g * 1.2), w = Math.max(1, Math.round(g * 0.35));
      b.caja(0, 0, 0, w - 1, gy - 1, w - 1, c);
      b.caja(g - w, 0, 0, g - 1, gy - 1, w - 1, c);
      return { grid: [g, gy, w], paleta: b.paleta, cajas: b.cajas };
    }
    default: { // manos / zapatos: dos bloques bajos lado a lado
      const gy = Math.max(2, Math.round(g * 0.4)), w = Math.max(1, Math.round(g * 0.4));
      b.caja(0, 0, 0, w - 1, gy - 1, g - 1, c);
      b.caja(g - w, 0, 0, g - 1, gy - 1, g - 1, c);
      b.caja(0, gy - 1, 0, w - 1, gy - 1, g - 1, dark);
      b.caja(g - w, gy - 1, 0, g - 1, gy - 1, g - 1, dark);
      return { grid: [g, gy, g], paleta: b.paleta, cajas: b.cajas };
    }
  }
}

function clasificarObjeto(id) {
  const v = items[id];
  if (v && v.tipo === "armadura") return "ARMADURA";
  if (v && v.tipo === "equipable" && SLOTS_JOYA.has(v.slotEquipo)) return "JOYA";
  if (v && v.tipo === "libro") return "PLANO";
  if (v && v.tipo === "consumible" && RE_POCION.test(id)) return "FRASCO";
  if (/^frasco_pocion/.test(id)) return "FRASCO";
  if (/^(vaso|copa|decantador|florero|jarra)_cristal$|^jarron_/.test(id)) return "VASIJA";
  if (id === "plato_cristal") return "VASIJA";
  if (/^(catalejo|brujula_naval|reloj_bolsillo|molinillo_especias)$/.test(id)) return "PLANO";
  if (id.startsWith("cadaver_")) return "SIN_COBERTURA";
  if (id.startsWith("barco_")) return "BARCO";
  if (id.startsWith("bolsa_semillas_")) return "SACO";
  if (id === "sarten" || id === "cuchillo_cocina" || id === "cesta_pan") return id === "sarten" ? "SARTEN" : id === "cuchillo_cocina" ? "CUCHILLO_MESA" : "SACO";
  if (id === "silla_montar") return "MONTURA";
  if (IDS_VASIJA.has(id)) return "VASIJA";
  if (IDS_PLANO.has(id)) return "PLANO";
  if (IDS_ILUMINACION.has(id)) return "ILUMINACION";
  if (IDS_HIGIENE.has(id)) return "HIGIENE";
  if (IDS_CONTENEDOR.has(id)) return "CONTENEDOR";
  if (IDS_HERBOLARIO.has(id)) return "HERBOLARIO";
  if (IDS_HERRAMIENTA_MESA.has(id)) return "HERRAMIENTA_MESA";
  if (IDS_ARNES.has(id)) return "ARNES";
  return "SIN_COBERTURA";
}

const ARQUETIPO_FN = {
  VASIJA: (v, id) => generarVasija(id, v),
  SARTEN: (v) => generarSarten(v),
  CUCHILLO_MESA: (v, id) => require("./generar_herramientas").ARQUETIPO_FN.CUCHILLO(v, id),
  PLANO: (v, id) => generarPlano(id, v),
  ILUMINACION: (v, id) => generarIluminacion(id, v),
  HIGIENE: (v, id) => generarHigiene(id, v),
  CONTENEDOR: (v, id) => generarContenedorPequeno(id, v),
  SACO: (v) => generarSaco(v),
  MONTURA: (v) => generarMontura(v),
  HERBOLARIO: (v, id) => generarHerbolario(id, v),
  HERRAMIENTA_MESA: (v, id) => generarHerramientaMesa(id, v),
  ARNES: (v) => generarArnes(v),
  FRASCO: (v, id) => generarFrasco(id, v),
  JOYA: (v, id) => generarJoya(id, v),
  ARMADURA: (v, id) => generarArmaduraPieza(id, v),
  BARCO: null, // ya cubierto por generar_barco.js — no se duplica aquí
  SIN_COBERTURA: null,
};

/** Devuelve el modelo del objeto, o null si su arquetipo es SIN_COBERTURA
 * (cadáveres) o BARCO (generar_barco.js ya los cubre — no se duplica). */
function generarObjeto(id) {
  const v = items[id];
  if (!v) throw new Error(`objeto desconocido en catálogo: ${id}`);
  const arq = clasificarObjeto(id);
  const fn = ARQUETIPO_FN[arq];
  if (!fn) return null;
  const modelo = fn(v, id);
  return { nombre: v.nombre || id, arquetipo: arq, resolucion: U, ...modelo };
}

module.exports = { IDS_OBJETO, IDS_EXPOSITOR, clasificarObjeto, generarObjeto, ARQUETIPO_FN, U };

if (require.main === module) {
  const muestra = process.argv.includes("--muestra");
  const ids = muestra
    ? ["plato", "caldero", "jarra_cerveza", "sarten", "silla_montar", "libro", "brasero", "jaula_pajaro"]
    : [...IDS_OBJETO, ...IDS_EXPOSITOR];
  const resultado = {};
  const sinCobertura = [];
  for (const id of ids) {
    const m = generarObjeto(id);
    if (m) resultado[id] = m; else sinCobertura.push(id);
  }
  const salida = path.join(__dirname, muestra ? "output/objetos_muestra.json" : "objetos_generados.json");
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, JSON.stringify(resultado));
  console.log(`Generados ${Object.keys(resultado).length} objetos -> ${salida}`);
  if (!muestra) console.log(`Sin cobertura (${sinCobertura.length}): ${sinCobertura.slice(0, 5).join(", ")}...`);
}
