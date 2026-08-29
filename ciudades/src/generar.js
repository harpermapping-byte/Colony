"use strict";
// Bakeador de CIUDADES/ALDEAS — generación ORGÁNICA (GDD_Bakeador_POIs §4).
// Nada de grillas rígidas: la aldea crece adaptándose a la geografía.
//
// Pipeline (el orden importa, cada paso usa lo anterior):
//   1. Terreno base: heightmap Perlin (colina/desniveles) y río opcional.
//   2. Punto FOCAL (plaza del mercado) en terreno favorable cerca del centro.
//   3. Caminos principales: A* desde los bordes del mapa al focal, con coste
//      por pendiente y agua — bordean colinas y ríos; si cruzan agua, puente.
//   4. Muralla ORGÁNICA: polígono radial deformado con Perlin alrededor del
//      focal, torres en vértices, y PUERTAS exactamente donde la cruzan los
//      caminos del paso 3. Módulos (recto/torre/puerta) en capa vectorial.
//   5. Edificios intramuros: Poisson + rechazo, densos cerca de la plaza,
//      ROTADOS hacia su camino más cercano; huella del INTERIOR real (bake
//      anidado). La muralla es el límite habitable: fuera solo caminos.
//   6. Rasterizado a casillas + validación (estanqueidad/conectividad).
//
// Determinismo total: mismo tier + semilla = misma ciudad e interiores.

const path = require("path");
const fs = require("fs");
const { crearPRNG, elegirPonderado } = require("../../interiores/src/azar");
const { cargarCatalogos } = require("../../interiores/src/catalogo");
const { generarEdificio } = require("../../interiores/src/edificio");
const { CapaRuido } = require("../../baker/src/ruido");
const {
  muestrearPoisson, aEstrella, puntoEnPoligono, distanciaASegmento,
  rasterizarSegmento, rasterizarRectRotado,
} = require("./geometria");

const MARGEN_EXTRAMUROS = 16; // respiro visual alrededor de la muralla (solo caminos)
const ANCHO_CALLE = 2;

function cargarAsentamientos() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "asentamientos.json"), "utf8"));
}

class Rejilla {
  constructor(ancho, alto, relleno) {
    this.ancho = ancho;
    this.alto = alto;
    this.datos = new Array(ancho * alto).fill(relleno);
  }
  dentro(x, y) { return x >= 0 && y >= 0 && x < this.ancho && y < this.alto; }
  get(x, y) { return this.dentro(x, y) ? this.datos[y * this.ancho + x] : null; }
  set(x, y, v) { if (this.dentro(x, y)) this.datos[y * this.ancho + x] = v; }
}

// ---------------------------------------------------------------------------
function generarCiudad({ tier, semilla, catalogos, catalogoAsentamientos }) {
  const asentamientos = catalogoAsentamientos || cargarAsentamientos();
  const def = asentamientos[tier];
  if (!def || tier.startsWith("_")) throw new Error(`tier de asentamiento desconocido: ${tier}`);
  catalogos = catalogos || cargarCatalogos();
  const rnd = crearPRNG(`ciudad:${tier}:${semilla}`);
  const org = def.organico;

  // --- dimensiones: recinto ~radio + cinturón extramuros, múltiplo de 8 ----
  const radio = org.radio;
  const lado = Math.ceil((2 * (radio * 1.3 + MARGEN_EXTRAMUROS)) / 8) * 8;
  const ancho = lado, alto = lado;
  const centro = { x: ancho / 2, y: alto / 2 };

  // --- 1. terreno base: heightmap + variante geográfica --------------------
  const variante = elegirPonderado(org.geografias, rnd);
  const relieve = new CapaRuido(`relieve:${tier}:${semilla}`, radio * 1.4);
  const alturas = new Float32Array(ancho * alto);
  for (let y = 0; y < alto; y++)
    for (let x = 0; x < ancho; x++) {
      let h = relieve.fbm(x, y, 4, 0.5); // 0..1
      if (variante === "colina") {
        // colina central suave: la aldea corona el alto, como en la realidad
        const d = Math.hypot(x - centro.x, y - centro.y) / radio;
        h += 0.5 * Math.exp(-d * d * 1.1);
      }
      alturas[y * ancho + x] = h;
    }

  const terreno = new Rejilla(ancho, alto, "cesped");
  const esAgua = new Uint8Array(ancho * alto);
  if (variante === "rio") {
    // un ARROYO estrecho (1 casilla, 2 en algún remanso) que cruza la
    // ciudad de norte a sur con meandro Perlin — decisión del usuario: da
    // vida sin partir el recinto en dos mitades incomunicadas
    const meandro = new CapaRuido(`rio:${tier}:${semilla}`, alto / 2.2);
    const xRio = centro.x + (rnd() - 0.5) * radio * 0.8; // desplazado del focal
    for (let y = 0; y < alto; y++) {
      const cx = Math.round(xRio + (meandro.fbm(0, y, 3, 0.5) - 0.5) * radio * 0.8);
      const remanso = meandro.fbm(9, y, 2, 0.5) > 0.62; // ensancha a 2 a tramos
      for (let dx = 0; dx <= (remanso ? 1 : 0); dx++) {
        const x = cx + dx;
        if (!terreno.dentro(x, y)) continue;
        terreno.set(x, y, "agua");
        esAgua[y * ancho + x] = 1;
        alturas[y * ancho + x] = Math.min(alturas[y * ancho + x], 0.15);
      }
    }
  }

  // --- 2. punto focal: terreno alto y seco cerca del centro ----------------
  let focal = { x: Math.round(centro.x), y: Math.round(centro.y) };
  let mejorPuntuacion = -Infinity;
  for (let y = Math.round(centro.y - radio / 3); y <= centro.y + radio / 3; y++)
    for (let x = Math.round(centro.x - radio / 3); x <= centro.x + radio / 3; x++) {
      if (esAgua[y * ancho + x]) continue;
      const p = alturas[y * ancho + x] - Math.hypot(x - centro.x, y - centro.y) / (radio * 4);
      if (p > mejorPuntuacion) { mejorPuntuacion = p; focal = { x, y }; }
    }

  // --- 3. caminos principales: bordes del mapa → focal ---------------------
  const costeDe = (x, y) => {
    const i = y * ancho + x;
    let c = 1 + Math.abs(alturas[i] - alturas[Math.max(0, i - 1)]) * 26; // la pendiente cuesta
    if (esAgua[i]) c += 30; // cruzar agua cuesta MUCHO: solo si no hay rodeo (→ puente)
    if (terreno.get(x, y) === "camino") c *= 0.4; // los caminos se atraen y se fusionan
    return c;
  };
  const nPuertas = def.muralla.puertas;
  const anguloBase = rnd() * Math.PI * 2;
  const caminos = [];
  for (let i = 0; i < nPuertas; i++) {
    const ang = anguloBase + (i * Math.PI * 2) / nPuertas + (rnd() - 0.5) * 0.5;
    const borde = {
      x: Math.min(ancho - 1, Math.max(0, Math.round(centro.x + Math.cos(ang) * lado))),
      y: Math.min(alto - 1, Math.max(0, Math.round(centro.y + Math.sin(ang) * lado))),
    };
    const ruta = aEstrella(ancho, alto, borde, focal, costeDe);
    if (!ruta) continue;
    caminos.push(ruta);
    for (const p of ruta) if (!esAgua[p.y * ancho + p.x]) terreno.set(p.x, p.y, "camino"); // atrae al siguiente A*
  }

  // --- 4. muralla orgánica: polígono radial deformado con Perlin -----------
  const ruidoMuro = new CapaRuido(`muralla:${tier}:${semilla}`, 2.2);
  const NV = 26; // vértices del polígono
  const poligono = [];
  for (let i = 0; i < NV; i++) {
    const ang = (i / NV) * Math.PI * 2;
    // muestrear el Perlin SOBRE el círculo unitario lo hace periódico: sin costura en 0
    const n = ruidoMuro.fbm(Math.cos(ang) * 2 + 4, Math.sin(ang) * 2 + 4, 3, 0.5) - 0.5;
    const r = radio * (1 + org.irregularidad * 2 * n);
    poligono.push({ x: focal.x + Math.cos(ang) * r, y: focal.y + Math.sin(ang) * r });
  }

  // puertas: el punto donde cada camino principal cruza el anillo
  const grosor = def.muralla.grosor;
  const distAlMuro = (x, y) => {
    let d = Infinity;
    for (let i = 0; i < NV; i++) d = Math.min(d, distanciaASegmento(x, y, poligono[i], poligono[(i + 1) % NV]));
    return d;
  };
  const puertas = [];
  for (const ruta of caminos) {
    for (const p of ruta) { // la ruta va de borde → focal: el primer cruce es LA puerta
      if (distAlMuro(p.x + 0.5, p.y + 0.5) <= grosor / 2 + 0.5) {
        puertas.push({ x: p.x, y: p.y });
        break;
      }
    }
  }

  // rasterizar muralla (módulos vectoriales a la vez), saltando las puertas
  const material = def.muralla.material;
  const idTerrenoMuro = material === "empalizada" ? "empalizada" : "muralla_piedra";
  // por debajo de ~1.8 de grosor el raster deja huecos en las diagonales:
  // el lienzo se pinta siempre continuo, el grosor del tier es visual/vector
  const grosorRaster = Math.max(grosor, 1.8);
  // el hueco de la puerta debe atravesar TODO el grosor del lienzo (el
  // punto de puerta puede caer en el borde exterior de la banda)
  const radioHueco = grosorRaster / 2 + 2;
  const esPuertaCerca = (x, y) => puertas.some((p) => Math.hypot(p.x - x, p.y - y) < radioHueco);
  const modulos = [];
  for (let i = 0; i < NV; i++) {
    const a = poligono[i], b = poligono[(i + 1) % NV];
    rasterizarSegmento(a, b, grosorRaster, ancho, alto, (x, y) => {
      if (!esPuertaCerca(x, y)) terreno.set(x, y, idTerrenoMuro);
    });
    // capa vectorial: tramos rectos de ~3 casillas + puerta si toca
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    const tramos = Math.max(1, Math.round(largo / 3));
    const rot = Math.atan2(b.y - a.y, b.x - a.x);
    for (let t = 0; t < tramos; t++) {
      const cx = a.x + ((t + 0.5) / tramos) * (b.x - a.x);
      const cy = a.y + ((t + 0.5) / tramos) * (b.y - a.y);
      modulos.push({
        tipo: esPuertaCerca(Math.round(cx), Math.round(cy)) ? "puerta" : "recto",
        x: +cx.toFixed(1), y: +cy.toFixed(1), rot: +((rot * 180) / Math.PI).toFixed(0), material,
      });
    }
  }
  // torres en los vértices (cada 2 para no saturar; castillos en todos) —
  // nunca a menos de 4 casillas de una puerta: una torre no sella el hueco
  const cadaCuantos = def.muralla.torresEnTodos ? 1 : 2;
  for (let i = 0; i < NV; i += cadaCuantos) {
    const v = poligono[i];
    if (puertas.some((p) => Math.hypot(p.x - v.x, p.y - v.y) < 4.5)) continue;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.round(v.x) + dx, y = Math.round(v.y) + dy;
        if (terreno.dentro(x, y)) terreno.set(x, y, idTerrenoMuro);
      }
    modulos.push({ tipo: "torre", x: +v.x.toFixed(1), y: +v.y.toFixed(1), rot: 0, material });
  }

  const dentroMuralla = (x, y) => puntoEnPoligono(x + 0.5, y + 0.5, poligono);

  // --- rasterizar caminos y plaza (encima del muro SOLO en las puertas) ----
  for (const ruta of caminos) {
    for (let i = 0; i + 1 < ruta.length; i++) {
      rasterizarSegmento(ruta[i], ruta[i + 1], ANCHO_CALLE, ancho, alto, (x, y) => {
        const t = terreno.get(x, y);
        if ((t === idTerrenoMuro) && !esPuertaCerca(x, y)) return; // el muro gana salvo en la puerta
        if (esAgua[y * ancho + x]) { terreno.set(x, y, "puente"); return; }
        terreno.set(x, y, dentroMuralla(x, y) ? "adoquin" : "camino");
      });
    }
  }
  // plaza del mercado: disco de adoquín alrededor del focal
  const radioPlaza = def.plaza;
  for (let y = focal.y - radioPlaza; y <= focal.y + radioPlaza; y++)
    for (let x = focal.x - radioPlaza; x <= focal.x + radioPlaza; x++)
      if (terreno.dentro(x, y) && !esAgua[y * ancho + x] && Math.hypot(x - focal.x, y - focal.y) <= radioPlaza)
        terreno.set(x, y, "adoquin");

  // Las calles MENORES (ronda + ramales) se abren DESPUÉS de asentar los
  // edificios monumentales: en una ciudad real el mercado y la iglesia se
  // plantan primero y los callejones crecen rodeándolos, no al revés.
  const carvarCallesMenores = () => {
    // calle de RONDA: el anillo interior clásico medieval — el polígono de
    // la muralla encogido hacia el focal. Solo en asentamientos grandes:
    // en una aldea pequeña el anillo se comería el único espacio.
    // en las metrópolis (radio >= 80) hay DOS rondas: la interior y otra
    // pegada a la muralla, para que el anillo exterior también tenga barrio
    const factoresRonda = radio >= 80 ? [0.55, 0.82] : radio >= 36 || def.muralla.torresEnTodos ? [0.68] : [];
    for (const factor of factoresRonda) {
      const ronda = poligono.map((p) => ({
        x: focal.x + (p.x - focal.x) * factor,
        y: focal.y + (p.y - focal.y) * factor,
      }));
      for (let i = 0; i < NV; i++) {
        rasterizarSegmento(ronda[i], ronda[(i + 1) % NV], 1.4, ancho, alto, (x, y) => {
          const t = terreno.get(x, y);
          if (t === idTerrenoMuro || t === "puente" || t === "solar_edificio") return;
          if (esAgua[y * ancho + x]) { terreno.set(x, y, "puente"); return; }
          terreno.set(x, y, "adoquin");
        });
      }
    }
    // calles SECUNDARIAS: callejones A* que se ramifican hacia objetivos
    // repartidos por el recinto, esquivando lo ya construido
    const nRamales = Math.max(4, Math.round(radio / 6));
    for (let rIdx = 0; rIdx < nRamales; rIdx++) {
      const angR = ((rIdx + rnd() * 0.7) / nRamales) * Math.PI * 2; // estratificados
      const dR = radio * (0.35 + rnd() * 0.5);
      const objetivo = { x: Math.round(focal.x + Math.cos(angR) * dR), y: Math.round(focal.y + Math.sin(angR) * dR) };
      if (!terreno.dentro(objetivo.x, objetivo.y) || !dentroMuralla(objetivo.x, objetivo.y)) continue;
      const tObjetivo = terreno.get(objetivo.x, objetivo.y);
      if (esAgua[objetivo.y * ancho + objetivo.x] || tObjetivo === idTerrenoMuro || tObjetivo === "solar_edificio") continue;
      const costeRamal = (x, y) => {
        const t = terreno.get(x, y);
        if (t === idTerrenoMuro || t === "solar_edificio") return Infinity;
        let c = 1 + Math.abs(alturas[y * ancho + x] - alturas[objetivo.y * ancho + objetivo.x]) * 8;
        if (esAgua[y * ancho + x]) c += 30;
        if (t === "camino" || t === "adoquin" || t === "puente") c *= 0.5;
        return c;
      };
      const ramal = aEstrella(ancho, alto, objetivo, focal, costeRamal);
      if (!ramal) continue;
      for (const p of ramal) {
        const t = terreno.get(p.x, p.y);
        if (t === "adoquin" || t === "puente" || t === idTerrenoMuro || t === "solar_edificio") continue;
        if (esAgua[p.y * ancho + p.x]) { terreno.set(p.x, p.y, "puente"); continue; }
        terreno.set(p.x, p.y, dentroMuralla(p.x, p.y) ? "adoquin" : "camino");
      }
    }
  };

  // --- 5. edificios ---------------------------------------------------------
  const [minEd, maxEd] = def.edificios.cantidad;
  const cantidad = minEd + Math.floor(rnd() * (maxEd - minEd + 1));
  const tiposElegidos = [...(def.edificios.obligatorios || [])];
  while (tiposElegidos.length < cantidad) tiposElegidos.push(elegirPonderado(def.edificios.ponderados, rnd));

  // huella EXTERIOR compacta de catálogo (huellas.json): el interior
  // instanciado es otra room y no necesita caber en ella — los interiores
  // reales generan plantas de 30+ casillas que harían imposible la escala
  // de ciudad medieval de las referencias. El bake anidado no cambia.
  const huellas = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "huellas.json"), "utf8"));
  const huellaDe = (tipoEdificioId) => {
    if (huellas.porTipo[tipoEdificioId]) return huellas.porTipo[tipoEdificioId];
    const riqueza = catalogos.tiposEdificio[tipoEdificioId]?.riqueza || "modesta";
    return huellas.porRiqueza[riqueza] || huellas.porRiqueza.modesta;
  };
  const edificios = tiposElegidos.map((tipoEdificioId, n) => {
    const semillaInterior = `${semilla}:${tipoEdificioId}:${n}`;
    const interior = generarEdificio({ tipoEdificioId, catalogos, semilla: semillaInterior });
    // variedad de FORMAS (pedido del usuario): jitter ±1 por instancia y,
    // en los tipos con "alas" del catálogo, planta en L (ala trasera a un
    // lado elegido por semilla)
    const base = huellaDe(tipoEdificioId);
    const w = Math.max(5, base[0] + Math.floor(rnd() * 3) - 1);
    const h = Math.max(4, base[1] + Math.floor(rnd() * 3) - 1);
    // piezas en coords LOCALES (la puerta cae en +Y del cuerpo principal).
    // Todas las formas nacen de rectángulos/cuadrados compuestos (decisión
    // del usuario): rect solo, L (un ala), T (ala centrada) o U (dos alas).
    const piezas = [{ ox: 0, oy: 0, w, h }];
    const ala = huellas.alas?.[tipoEdificioId];
    if (ala) {
      const tirada = rnd();
      const alaEn = (ox) => piezas.push({ ox, oy: -(h / 2 + ala[1] / 2), w: ala[0], h: ala[1] });
      if (tirada < 0.4) alaEn((rnd() < 0.5 ? 1 : -1) * (w / 2 - ala[0] / 2)); // L
      else if (tirada < 0.55) alaEn(0); // T
      else if (tirada < 0.72 && w >= ala[0] * 2 + 2) { alaEn(w / 2 - ala[0] / 2); alaEn(-(w / 2 - ala[0] / 2)); } // U
    }
    return {
      tipoEdificioId, semillaInterior, interior, w, h, piezas,
      obligatorio: n < (def.edificios.obligatorios || []).length,
    };
  });

  // PARCELAS RESERVADAS (docs/GDD_Ciudad_Capital.md): huecos SIN construir,
  // candidatos de más — reusan el MISMO fitting Poisson+rechazo que un
  // edificio real (misma lista, mismo orden por tamaño, misma competencia
  // por sitio junto al resto de solares), pero sin tipoEdificioId/interior;
  // al colocarse (colocarEdificio con reservado=true, ver más abajo) el
  // terreno base queda intacto — un hueco real caminable, no un descampado.
  // Solo tiers con `edificios.parcelasReservadas` en el catálogo (hoy solo
  // `capital_jarl`) generan esto; el resto de tiers no cambia.
  const resDef = def.parcelasReservadas || {};
  const [wResNormal, hResNormal] = huellas.porRiqueza.modesta; // igual que un solar de vivienda/tienda normal
  const wResGrande = Math.round(wResNormal * 1.6), hResGrande = Math.round(hResNormal * 1.6); // huella similar a los obligatorios más grandes (ayuntamiento 14x10, arena_combate 14x11)
  const reservaEntrada = (tipoReserva, w, h) => ({
    tipoEdificioId: `parcela_reservada_${tipoReserva}`, tipoReserva, semillaInterior: null, interior: null,
    w, h, piezas: [{ ox: 0, oy: 0, w, h }], obligatorio: false, reservado: true,
  });
  for (let i = 0; i < (resDef.especiales || 0); i++) edificios.push(reservaEntrada("especial", wResGrande, hResGrande));
  for (let i = 0; i < (resDef.normales || 0); i++) edificios.push(reservaEntrada("normal", wResNormal, hResNormal));

  // los OBLIGATORIOS eligen sitio primero (con el recinto aún vacío); dentro
  // de cada grupo, los grandes antes — lo pequeño siempre encuentra hueco
  // (las parcelas reservadas compiten en igualdad con los edificios reales
  // de su mismo tamaño, nunca van "sobradas" al final)
  edificios.sort((a, b) =>
    (b.obligatorio ? 1 : 0) - (a.obligatorio ? 1 : 0) ||
    b.w * b.h - a.w * a.h ||
    a.tipoEdificioId.localeCompare(b.tipoEdificioId));

  // colchón mínimo entre solares (callejón): configurable por tier, default
  // 1 = comportamiento histórico. La capital del jarl usa un valor bajo
  // para el casco viejo apretado (edificios pegados, callejuelas estrechas).
  const colchon = def.edificios.colchonMinimo ?? 1;
  const esCalle = (x, y) => { const t = terreno.get(x, y); return t === "camino" || t === "adoquin" || t === "puente"; };
  // camino más cercano por barrido BFS multi-origen — recalculable, porque
  // las calles menores se abren a mitad de la colocación
  let distCalle, origenCalle;
  const recalcularCalles = () => {
    distCalle = new Int16Array(ancho * alto).fill(-1);
    origenCalle = new Int32Array(ancho * alto).fill(-1);
    const cola = [];
    for (let y = 0; y < alto; y++)
      for (let x = 0; x < ancho; x++)
        if (esCalle(x, y)) { const i = y * ancho + x; distCalle[i] = 0; origenCalle[i] = i; cola.push(i); }
    for (let q = 0; q < cola.length; q++) {
      const i = cola[q], x = i % ancho, y = Math.floor(i / ancho);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
        const j = ny * ancho + nx;
        if (distCalle[j] !== -1) continue;
        distCalle[j] = distCalle[i] + 1;
        origenCalle[j] = origenCalle[i];
        cola.push(j);
      }
    }
  };
  recalcularCalles();

  const ocupado = new Uint8Array(ancho * alto); // solares ya puestos (con colchón)

  // FRENTES de calle: cada 2ª casilla de calle con su tangente local — los
  // edificios se sientan pegados a la calle con la puerta mirándola, como
  // crece una ciudad medieval de verdad (nada de dardos al azar).
  let frentes = [];
  const construirFrentes = () => {
    frentes = [];
    for (let y = 2; y < alto - 2; y += 1)
      for (let x = (y % 2) * 1 + 2; x < ancho - 2; x += 2) {
        if (!esCalle(x, y)) continue;
        // tangente: hacia la casilla de calle más lejana en la ventana 5x5
        let mejor = null, mejorD = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            if (!esCalle(x + dx, y + dy)) continue;
            const d = dx * dx + dy * dy;
            if (d > mejorD) { mejorD = d; mejor = [dx, dy]; }
          }
        if (!mejor) continue;
        const norma = Math.hypot(mejor[0], mejor[1]);
        frentes.push({ x, y, tx: mejor[0] / norma, ty: mejor[1] / norma, dentro: dentroMuralla(x, y) });
      }
    // orden determinista barajado: la variedad la pone la semilla
    for (let i = frentes.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [frentes[i], frentes[j]] = [frentes[j], frentes[i]];
    }
  };
  construirFrentes();

  // rasteriza TODAS las piezas del edificio (cuerpo + ala si tiene planta
  // en L): los offsets locales se giran con el mismo ángulo de la fachada
  const rasterizarPiezas = (ed, cx, cy, angulo, extra, pintar) => {
    const cosA = Math.cos(angulo), sinA = Math.sin(angulo);
    for (const p of ed.piezas) {
      const wx = cx + p.ox * cosA - p.oy * sinA;
      const wy = cy + p.ox * sinA + p.oy * cosA;
      rasterizarRectRotado(wx, wy, p.w / 2 + extra, p.h / 2 + extra, angulo, ancho, alto, pintar);
    }
  };

  const probarCandidato = (ed, cx, cy, angulo) => {
    let libre = true;
    // el NÚCLEO no pisa adoquín/puente/muro/agua/otros solares. Un CAMINO de
    // tierra sí puede quedar debajo (la casa lo interrumpe, como en un
    // pueblo real; la pasada de reparación re-conecta después).
    rasterizarPiezas(ed, cx, cy, angulo, 0, (x, y) => {
      if (!libre) return;
      const t = terreno.get(x, y);
      if (t === null || ocupado[y * ancho + x] || esAgua[y * ancho + x] || t === idTerrenoMuro || t === "adoquin" || t === "puente") libre = false;
    });
    if (!libre) return false;
    // el colchón (callejón mínimo entre solares) es CONFIGURABLE por tier
    // (edificios.colchonMinimo, default 1 = comportamiento de siempre) —
    // la capital del jarl pide un casco viejo apretado con un valor bajo.
    // Que el edificio roce la calle a la que da fachada es justo lo que
    // se busca, el colchón solo respeta a OTROS edificios.
    rasterizarPiezas(ed, cx, cy, angulo, colchon, (x, y) => {
      if (ocupado[y * ancho + x]) libre = false;
    });
    return libre;
  };

  // `reservado`: usado por las parcelas reservadas (huecos sin construir,
  // ver más abajo) — reusa TODO el fitting (frentes, colchón, fallback de
  // plaza) pero no pinta "solar_edificio" ni abre puerta/senda: el hueco
  // queda con el terreno base intacto, listo para construcción futura.
  const colocarEdificio = (ed, reservado = false) => {
    let mejorCandidato = null, mejorPuntos = -Infinity, validos = 0;
    for (const f of frentes) {
      if (!f.dentro) continue; // la muralla es el LÍMITE habitable: fuera no se edifica
      // dos aceras: el edificio puede caer a cada lado de la calle
      for (const lado of [1, -1]) {
        const nx = -f.ty * lado, ny = f.tx * lado; // normal a la tangente
        const cx = f.x + 0.5 + nx * (ed.h / 2 + 1.4);
        const cy = f.y + 0.5 + ny * (ed.h / 2 + 1.4);
        if (!dentroMuralla(cx, cy)) continue;
        if (distAlMuro(cx, cy) < grosor / 2 + 1.5) continue;
        // fachada paralela a la calle, puerta (local +Y) mirándola
        const angulo = Math.atan2(f.y + 0.5 - cy, f.x + 0.5 - cx) - Math.PI / 2;
        if (!probarCandidato(ed, cx, cy, angulo)) continue;
        const puntos = -Math.hypot(cx - focal.x, cy - focal.y) + rnd() * 5;
        if (puntos > mejorPuntos) { mejorPuntos = puntos; mejorCandidato = { cx, cy, angulo }; }
        validos++;
      }
      // los obligatorios rastrean TODAS las fachadas; para el relleno basta
      if (!ed.obligatorio && validos >= 14) break;
    }
    // fallback monumental: un obligatorio sin fachada se planta DANDO FRENTE
    // A LA PLAZA (la iglesia/castillo presidiendo el mercado, como en las
    // referencias) — anillos crecientes de ángulos alrededor
    if (!mejorCandidato && ed.obligatorio) {
      buscar: for (let k = 0; k < 5; k++) {
        const distancia = radioPlaza + ed.h / 2 + 1.5 + k * 3;
        for (let i = 0; i < 40; i++) {
          const ang = (i / 40) * Math.PI * 2;
          const cx = focal.x + Math.cos(ang) * distancia;
          const cy = focal.y + Math.sin(ang) * distancia;
          const angulo = Math.atan2(focal.y - cy, focal.x - cx) - Math.PI / 2; // puerta a la plaza
          if (!dentroMuralla(cx, cy) || distAlMuro(cx, cy) < grosor / 2 + 1.5) continue;
          if (!probarCandidato(ed, cx, cy, angulo)) continue;
          mejorCandidato = { cx, cy, angulo };
          break buscar;
        }
      }
    }
    if (!mejorCandidato) return false;
    const { cx, cy, angulo } = mejorCandidato;
    ed.cx = +cx.toFixed(1); ed.cy = +cy.toFixed(1);
    ed.rot = +(((angulo * 180) / Math.PI) % 360).toFixed(0);
    ed.casillas = [];
    const yaPintada = new Set(); // dos piezas a ras pueden pisar la misma casilla
    rasterizarPiezas(ed, cx, cy, angulo, 0, (x, y) => {
      const k = y * ancho + x;
      if (yaPintada.has(k)) return;
      yaPintada.add(k);
      if (!reservado) terreno.set(x, y, "solar_edificio"); // reservada: terreno base intacto (hueco caminable)
      ed.casillas.push([x, y]);
    });
    rasterizarPiezas(ed, cx, cy, angulo, colchon, (x, y) => { ocupado[y * ancho + x] = 1; });
    if (reservado) return true; // un hueco vacío no tiene puerta ni senda que abrir
    // puerta en la fachada (lado que mira al camino): se empuja hacia fuera
    // hasta la primera casilla que NO sea del solar (el redondeo a rejilla
    // puede dejar la teórica dentro del propio muro del edificio)
    let px = 0, py = 0;
    for (let salto = 0.6; salto < 4; salto += 0.5) {
      px = Math.round(cx + Math.cos(angulo + Math.PI / 2) * (ed.h / 2 + salto));
      py = Math.round(cy + Math.sin(angulo + Math.PI / 2) * (ed.h / 2 + salto));
      if (terreno.get(px, py) !== "solar_edificio") break;
    }
    ed.puerta = { x: px, y: py };
    for (let paso = 0; paso < 14 && terreno.dentro(px, py) && !esCalle(px, py); paso++) {
      if (terreno.get(px, py) === "cesped" || terreno.get(px, py) === "tierra") terreno.set(px, py, "camino");
      const o = origenCalle[py * ancho + px];
      const ox = o % ancho, oy = Math.floor(o / ancho);
      px += Math.sign(ox - px); py += Math.sign(oy - py);
    }
    return true;
  };

  const colocados = [], descartados = [];
  // fase A: los OBLIGATORIOS se asientan con solo la red principal trazada
  for (const ed of edificios.filter((e) => e.obligatorio))
    (colocarEdificio(ed) ? colocados : descartados).push(ed);
  // fase B: crecen las calles menores rodeándolos
  carvarCallesMenores();
  recalcularCalles();
  construirFrentes();

  // ZONAS VERDES designadas (pedido del usuario): parques con árboles y
  // huertos INTRAMUROS, reservados ANTES del relleno para que las casas
  // los respeten — el pulmón del barrio, no el hueco que sobró.
  const zonasVerdes = [];
  const arboles = []; // props de vegetación (van al export como objetos "v")
  const esArbol = new Set();
  const ESPECIES_PARQUE = [["roble", 3], ["tilo", 2], ["abedul", 2], ["manzano_silvestre", 1]];
  for (let z = 0; z < (def.zonasVerdes || 0); z++) {
    let puesto = null;
    for (let intento = 0; intento < 120 && !puesto; intento++) {
      const ang = rnd() * Math.PI * 2;
      const d = radioPlaza + 6 + rnd() * (radio - radioPlaza - 12);
      const zx = Math.round(focal.x + Math.cos(ang) * d), zy = Math.round(focal.y + Math.sin(ang) * d);
      const r = 3 + Math.floor(rnd() * 3);
      if (!terreno.dentro(zx, zy) || !dentroMuralla(zx, zy) || distAlMuro(zx, zy) < r + grosor) continue;
      let libre = true;
      for (let dy = -r; dy <= r && libre; dy++)
        for (let dx = -r; dx <= r && libre; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const t = terreno.get(zx + dx, zy + dy);
          if (t !== "cesped" && t !== "tierra") libre = false;
          if (ocupado[(zy + dy) * ancho + zx + dx]) libre = false;
        }
      if (!libre) continue;
      puesto = { x: zx, y: zy, r };
    }
    if (!puesto) continue;
    const esHuerto = rnd() < 0.45;
    for (let dy = -puesto.r; dy <= puesto.r; dy++)
      for (let dx = -puesto.r; dx <= puesto.r; dx++) {
        if (dx * dx + dy * dy > puesto.r * puesto.r) continue;
        ocupado[(puesto.y + dy) * ancho + puesto.x + dx] = 1; // las casas lo respetan
        if (esHuerto) terreno.set(puesto.x + dx, puesto.y + dy, "tierra_labrada");
      }
    if (!esHuerto) {
      // parque: árboles con distancia mínima entre ellos (colisionan de
      // verdad: el catálogo del baker ya les da colision:true)
      const nArboles = 2 + Math.floor(rnd() * puesto.r);
      for (let a = 0; a < nArboles * 6 && arboles.filter((t) => Math.hypot(t.x - puesto.x, t.y - puesto.y) <= puesto.r).length < nArboles; a++) {
        const ax = puesto.x + Math.round((rnd() - 0.5) * 2 * (puesto.r - 1));
        const ay = puesto.y + Math.round((rnd() - 0.5) * 2 * (puesto.r - 1));
        const k = ay * ancho + ax;
        if (esArbol.has(k) || terreno.get(ax, ay) !== "cesped") continue;
        if (arboles.some((t) => Math.abs(t.x - ax) <= 1 && Math.abs(t.y - ay) <= 1)) continue;
        arboles.push({ i: elegirPonderado(ESPECIES_PARQUE, rnd), t: "v", va: Math.floor(rnd() * 5), ro: Math.floor(rnd() * 4) * 90, es: 1, x: ax, y: ay });
        esArbol.add(k);
      }
    }
    zonasVerdes.push({ tipo: esHuerto ? "huerto" : "parque", x: puesto.x, y: puesto.y, r: puesto.r });
  }

  // CAMPOS DE CULTIVO (docs/GDD_Ciudad_Capital.md): decisión de menor
  // fricción — reusan el MISMO tratamiento que un huerto de zonasVerdes
  // (tierra_labrada + valla con hueco de entrada, capa `zonasVerdes` del
  // export, sin canal nuevo) pero forzados al anillo MÁS CERCANO a la
  // muralla, del lado PISABLE — nunca en el anillo puramente decorativo de
  // fuera, que la norma del proyecto dice que jamás se pisa. Solo los tiers
  // con `camposCultivo` en el catálogo (hoy solo capital_jarl) generan
  // esto; cantidad inicial fija (ampliable a futuro por un proyecto del
  // jarl que todavía no existe — ver GDD, no implementado aquí).
  for (let c = 0; c < (def.camposCultivo || 0); c++) {
    let puesto = null;
    for (let intento = 0; intento < 160 && !puesto; intento++) {
      const ang = rnd() * Math.PI * 2;
      const r = 3 + Math.floor(rnd() * 2);
      // banda pegada a la cara interior de la muralla: entre su grosor y
      // ~9 casillas más adentro — el anillo pisable más próximo al lienzo
      const d = radio - grosor - r - 1 - rnd() * 8;
      const zx = Math.round(focal.x + Math.cos(ang) * d), zy = Math.round(focal.y + Math.sin(ang) * d);
      if (!terreno.dentro(zx, zy) || !dentroMuralla(zx, zy) || distAlMuro(zx, zy) < r + 1.5) continue;
      let libre = true;
      for (let dy = -r; dy <= r && libre; dy++)
        for (let dx = -r; dx <= r && libre; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const t = terreno.get(zx + dx, zy + dy);
          if (t !== "cesped" && t !== "tierra") libre = false;
          if (ocupado[(zy + dy) * ancho + zx + dx]) libre = false;
        }
      if (!libre) continue;
      puesto = { x: zx, y: zy, r };
    }
    if (!puesto) continue;
    for (let dy = -puesto.r; dy <= puesto.r; dy++)
      for (let dx = -puesto.r; dx <= puesto.r; dx++) {
        if (dx * dx + dy * dy > puesto.r * puesto.r) continue;
        ocupado[(puesto.y + dy) * ancho + puesto.x + dx] = 1; // las casas lo respetan
        terreno.set(puesto.x + dx, puesto.y + dy, "tierra_labrada");
      }
    zonasVerdes.push({ tipo: "campo_cultivo", x: puesto.x, y: puesto.y, r: puesto.r });
  }

  // el resto se coloca sobre la red completa, respetando las zonas verdes —
  // incluye tanto edificios reales como parcelas reservadas (mismo pool,
  // misma competencia por sitio: `colocarEdificio` con reservado=true deja
  // el terreno base intacto en vez de pintar "solar_edificio")
  for (const ed of edificios.filter((e) => !e.obligatorio))
    (colocarEdificio(ed, !!ed.reservado) ? colocados : descartados).push(ed);

  // las parcelas reservadas se separan del resto de edificios: no llevan
  // interior ni puerta, no son "ciudad.edificios" — solo posición/tamaño
  // para el futuro sistema de construcción en regiones (ver GDD_Ciudad_Capital.md)
  const parcelasReservadas = colocados
    .filter((e) => e.reservado)
    .map((e) => ({ tipo: e.tipoReserva, x: e.cx, y: e.cy, rot: e.rot, ancho: e.w, largo: e.h }));

  // la muralla es el LÍMITE habitable (decisión del usuario): fuera solo
  // quedan los caminos de llegada — nada de granjas ni casas extramuros
  const todos = colocados.filter((e) => !e.reservado);

  // patios: la casilla de césped pegada a un solar pasa a tierra pisada
  for (const ed of todos)
    for (const [x, y] of ed.casillas)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (terreno.get(x + dx, y + dy) === "cesped") terreno.set(x + dx, y + dy, "tierra");

  // === CAPA DE VEGETACIÓN dispersa ==========================================
  // "verde por aquí, verde por allá": arbustos (atravesables) y algún árbol
  // suelto en rincones de césped alejados de las calles. Densidad DOBLADA
  // (pedido del usuario 2026-08-28: la aldea se veía demasiado pelada) —
  // sigue siendo dispersión aleatoria sobre césped libre, así que en un
  // recinto pequeño con poco césped sobrante el tope real lo pone el
  // espacio disponible, no este multiplicador.
  const ARBUSTOS = [["arbusto_comun", 4], ["espino_albar", 2], ["lavanda_silvestre", 2], ["romero", 1], ["helecho", 1]];
  const ARBOLES_SUELTOS = [["roble", 2], ["tilo", 2], ["abedul", 1]];
  const nVerdes = Math.round(radio * 2.8);
  for (let v = 0; v < nVerdes; v++) {
    const vx = 2 + Math.floor(rnd() * (ancho - 4)), vy = 2 + Math.floor(rnd() * (alto - 4));
    const k = vy * ancho + vx;
    if (!dentroMuralla(vx, vy) || terreno.get(vx, vy) !== "cesped" || ocupado[k] || esArbol.has(k)) continue;
    if (distCalle[k] < 2) continue; // el verde no invade la calle
    const esArbolGrande = rnd() < 0.3;
    arboles.push({
      i: elegirPonderado(esArbolGrande ? ARBOLES_SUELTOS : ARBUSTOS, rnd),
      t: "v", va: Math.floor(rnd() * 5), ro: Math.floor(rnd() * 4) * 90, es: 1, x: vx, y: vy,
      colisiona: esArbolGrande, // los arbustos se atraviesan; el árbol no
    });
    if (esArbolGrande) esArbol.add(k);
  }
  // arbustos también en los parques, entre los árboles
  for (const zv of zonasVerdes) {
    if (zv.tipo !== "parque") continue;
    for (let a = 0; a < 2 + Math.floor(rnd() * 3); a++) {
      const ax = zv.x + Math.round((rnd() - 0.5) * 2 * (zv.r - 1));
      const ay = zv.y + Math.round((rnd() - 0.5) * 2 * (zv.r - 1));
      if (terreno.get(ax, ay) !== "cesped" || esArbol.has(ay * ancho + ax)) continue;
      arboles.push({ i: elegirPonderado(ARBUSTOS, rnd), t: "v", va: Math.floor(rnd() * 5), ro: 0, es: 1, x: ax, y: ay, colisiona: false });
    }
  }

  // === CAPA DE DECORACIÓN + CANAL DE ILUMINACIÓN ===========================
  // Muebles urbanos (ciudades/catalogo/decoracion.json): vallas en huertos,
  // puestos y bancos en la plaza, cajas/barriles/sillas junto a fachadas, y
  // las LUCES (farola rica / antorcha pobre) en plaza, puertas y calle
  // principal — exportadas también como canal aparte (indice.luces).
  const catalogoDeco = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "decoracion.json"), "utf8"));
  const deco = [];
  const luces = [];
  const decoSolida = new Set();
  const ponerDeco = (id, x, y, ro = 0) => {
    const def2 = catalogoDeco[id];
    if (!def2 || !terreno.dentro(x, y)) return false;
    const k = y * ancho + x;
    const t = terreno.get(x, y);
    if (esArbol.has(k) || decoSolida.has(k) || esAgua[k]) return false;
    if (t === idTerrenoMuro || t === "solar_edificio") return false;
    if (def2.colision) {
      // lo que bloquea NUNCA pisa un camino/senda ni tapona una puerta:
      // la deco decora, no encierra a nadie en su casa
      if (t === "camino" || t === "puente") return false;
      for (const ed of todos) if (Math.abs(ed.puerta.x - x) <= 2 && Math.abs(ed.puerta.y - y) <= 2) return false;
    }
    deco.push({ i: id, t: "m", va: 0, ro, es: 1, x, y });
    if (def2.colision) decoSolida.add(k);
    if (def2.luz) luces.push({ x, y, id, radio: def2.luz.radio, color: def2.luz.color });
    return true;
  };

  // vallas alrededor de cada huerto o campo de cultivo (con hueco de entrada
  // hacia la calle) — mismo tratamiento visual, ver GDD_Ciudad_Capital.md
  for (const zv of zonasVerdes) {
    if (zv.tipo !== "huerto" && zv.tipo !== "campo_cultivo") continue;
    const oEntrada = origenCalle[zv.y * ancho + zv.x];
    const angEntrada = Math.atan2(Math.floor(oEntrada / ancho) - zv.y, (oEntrada % ancho) - zv.x);
    for (let ang = 0; ang < Math.PI * 2; ang += 0.28) {
      let dAng = Math.abs(ang - ((angEntrada + Math.PI * 2) % (Math.PI * 2)));
      if (dAng > Math.PI) dAng = Math.PI * 2 - dAng;
      if (dAng < 0.5) continue; // hueco de entrada
      const fx = Math.round(zv.x + Math.cos(ang) * (zv.r + 1));
      const fy = Math.round(zv.y + Math.sin(ang) * (zv.r + 1));
      if (terreno.get(fx, fy) === "cesped" || terreno.get(fx, fy) === "tierra" || terreno.get(fx, fy) === "tierra_labrada") {
        ponerDeco("valla_madera", fx, fy, Math.round(((ang * 180) / Math.PI + 90) % 360));
      }
    }
  }

  const esRico = material !== "empalizada";
  const idBanco = esRico ? "banco_piedra" : "banco_madera";

  // HITO de la plaza según el tier (la referencia del usuario: pozo en la
  // aldea, fuente en el pueblo, estatua presidiendo la capital)
  const idHito = radio >= 80 ? "estatua_piedra" : radio >= 40 ? (rnd() < 0.5 ? "fuente_piedra" : "pozo_agua") : "pozo_agua";
  ponerDeco(idHito, focal.x, focal.y);
  if (idHito === "estatua_piedra") ponerDeco("fuente_piedra", focal.x + 3, focal.y + 2); // la gran capital tiene ambas
  ponerDeco("cubo_madera", focal.x + 1, focal.y + 1); // el cubo del pozo/fuente
  if (rnd() < 0.8) ponerDeco("charco_agua", focal.x - 1, focal.y + 2);

  // plaza: puestos de mercado, tenderetes, bancos, macetas y carga suelta
  const nPuestos = Math.min(5, Math.max(1, Math.floor(radioPlaza / 2)));
  for (let pIdx = 0; pIdx < nPuestos; pIdx++) {
    const ang = (pIdx / nPuestos) * Math.PI * 2 + 0.4 + rnd() * 0.3;
    const px2 = Math.round(focal.x + Math.cos(ang) * (radioPlaza - 1.2));
    const py2 = Math.round(focal.y + Math.sin(ang) * (radioPlaza - 1.2));
    ponerDeco(rnd() < 0.7 ? "puesto_mercado" : "tenderete_comida", px2, py2, Math.round(((ang * 180) / Math.PI + 180) % 360));
    if (rnd() < 0.8) ponerDeco(elegirPonderado([["caja_madera", 3], ["cesta_pan", 2], ["jaula_vacia", 2], ["barril", 1]], rnd),
      Math.round(focal.x + Math.cos(ang + 0.35) * (radioPlaza - 1)),
      Math.round(focal.y + Math.sin(ang + 0.35) * (radioPlaza - 1)));
  }
  for (let b = 0; b < Math.max(2, Math.floor(radioPlaza / 2)); b++) {
    const ang = rnd() * Math.PI * 2;
    ponerDeco(idBanco, Math.round(focal.x + Math.cos(ang) * (radioPlaza + 1.5)), Math.round(focal.y + Math.sin(ang) * (radioPlaza + 1.5)), Math.round((ang * 180) / Math.PI));
    if (esRico && rnd() < 0.5) ponerDeco("maceta_grande", Math.round(focal.x + Math.cos(ang + 0.5) * (radioPlaza + 1.5)), Math.round(focal.y + Math.sin(ang + 0.5) * (radioPlaza + 1.5)));
  }
  // bancos y carros en los parques; gallinero y carretilla en los huertos
  for (const zv of zonasVerdes) {
    if (zv.tipo === "parque") {
      if (rnd() < 0.85) ponerDeco(idBanco, zv.x + 1, zv.y, Math.floor(rnd() * 4) * 90);
      if (rnd() < 0.4) ponerDeco("charco_agua", zv.x - 1, zv.y - zv.r + 1);
    } else {
      if (rnd() < 0.6) ponerDeco("gallinero_jaula", zv.x + zv.r, zv.y - 1);
      if (rnd() < 0.5) ponerDeco("carro_mano", zv.x - zv.r, zv.y + 1, Math.floor(rnd() * 4) * 90);
      if (rnd() < 0.5) ponerDeco("cubo_madera", zv.x, zv.y + zv.r);
    }
  }

  // fachadas con OFICIO: cada edificio recibe 1-3 piezas acordes a lo que
  // es (la herrería apila leña, la taberna saca mesa y barriles, la casa
  // noble pone macetas...) + cartel de tienda en los comercios
  const DECO_GENERICA = [["caja_madera", 3], ["barril", 3], ["cubo_madera", 2], ["silla", 2], ["lena_apilada", 2], ["escalera_mano", 1], ["tendedero", 1], [idBanco, 1], ["carro_mano", 1]];
  const DECO_POR_TEMA = {
    herreria: [["lena_apilada", 4], ["barril", 2], ["cubo_madera", 1]],
    panaderia: [["saco_harina", 4], ["lena_apilada", 2], ["cesta_pan", 2]],
    taberna: [["barril", 4], ["mesa_comedor", 2], ["silla", 2]],
    posada: [["abrevadero", 3], ["amarradero", 3], ["barril", 2], ["carromato", 1]],
    establo: [["abrevadero", 4], ["amarradero", 4], ["carreta", 2], ["saco_harina", 1]],
    granero: [["carreta", 3], ["saco_harina", 3], ["carro_mano", 2]],
    alfareria: [["tinaja_barro", 5], ["carro_mano", 1]],
    curtiduria: [["tinaja_barro", 3], ["cubo_madera", 2], ["tendedero", 2]],
    tienda: [["caja_madera", 3], ["jaula_vacia", 2], ["cesta_pan", 2]],
    casa_noble: [["maceta_grande", 4], [idBanco, 2]],
    mansion: [["maceta_grande", 4], [idBanco, 2]],
    templo: [["maceta_grande", 2], [idBanco, 3]],
  };
  const COMERCIOS = new Set(["tienda", "taberna", "posada", "panaderia", "herreria", "botica", "joyeria", "taller_sastre", "curtiduria", "alfareria", "carpinteria", "destileria", "casa_de_cambio", "lonja_pescado"]);
  for (const ed of todos) {
    const tabla = DECO_POR_TEMA[ed.tipoEdificioId] || DECO_GENERICA;
    const nPiezas = 1 + Math.floor(rnd() * 3);
    for (let d2 = 0; d2 < nPiezas; d2++) {
      const lado = rnd() < 0.5 ? 1 : -1;
      ponerDeco(elegirPonderado(tabla, rnd),
        ed.puerta.x + lado * (2 + Math.floor(rnd() * 2)),
        ed.puerta.y + Math.floor(rnd() * 3) - 1,
        Math.floor(rnd() * 4) * 90);
    }
    // cartel del oficio junto a la puerta (los comercios anuncian)
    if (COMERCIOS.has(ed.tipoEdificioId) || catalogos.tiposEdificio[ed.tipoEdificioId]?.temaTaller) {
      ponerDeco("cartel_tienda", ed.puerta.x + (rnd() < 0.5 ? 1 : -1), ed.puerta.y);
    }
  }

  // PUERTAS de muralla: abrevadero + amarradero para las monturas, algún
  // carro aparcado y el poste indicador del cruce
  for (const p of puertas) {
    const hacia = Math.atan2(focal.y - p.y, focal.x - p.x);
    const ix2 = Math.round(p.x + Math.cos(hacia) * (grosorRaster + 2));
    const iy2 = Math.round(p.y + Math.sin(hacia) * (grosorRaster + 2));
    ponerDeco("abrevadero", ix2 + 2, iy2, Math.round((hacia * 180) / Math.PI));
    ponerDeco("amarradero", ix2 + 2, iy2 + 1, Math.round((hacia * 180) / Math.PI));
    ponerDeco("cartel_poste", ix2 - 2, iy2 - 1);
    if (rnd() < 0.6) ponerDeco(rnd() < 0.5 ? "carreta" : "carromato", ix2 - 2, iy2 + 2, Math.floor(rnd() * 4) * 90);
    if (rnd() < 0.5) ponerDeco("charco_agua", ix2, iy2 + 1);
  }

  // tenderetes sueltos en la calle principal (mercadeo fuera de la plaza)
  for (const ruta of caminos) {
    for (let i = 6; i < ruta.length; i += 14) {
      const p = ruta[i];
      if (!dentroMuralla(p.x, p.y) || rnd() > 0.5) continue;
      for (const [dx2, dy2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = terreno.get(p.x + dx2, p.y + dy2);
        if ((t === "cesped" || t === "tierra") && ponerDeco("tenderete_comida", p.x + dx2, p.y + dy2)) break;
      }
    }
  }

  // charcos por las calles (vida de barro; junto al arroyo, más)
  const nCharcos = Math.round(radio / 2.2);
  for (let c2 = 0; c2 < nCharcos; c2++) {
    const cx2 = 2 + Math.floor(rnd() * (ancho - 4)), cy2 = 2 + Math.floor(rnd() * (alto - 4));
    if (!dentroMuralla(cx2, cy2)) continue;
    const t = terreno.get(cx2, cy2);
    if (t === "camino" || t === "tierra" || t === "adoquin") ponerDeco("charco_agua", cx2, cy2, Math.floor(rnd() * 4) * 90);
  }

  // LUCES: junto a cada puerta de muralla, en la plaza y a lo largo de la
  // calle principal cada ~9 casillas, pegadas al borde de la calle
  const idLuz = material === "empalizada" ? "antorcha_poste" : "farola_calle";
  for (const p of puertas) {
    const hacia = Math.atan2(focal.y - p.y, focal.x - p.x);
    ponerDeco(idLuz, Math.round(p.x + Math.cos(hacia) * (grosorRaster + 1.5)) + 1, Math.round(p.y + Math.sin(hacia) * (grosorRaster + 1.5)));
  }
  for (let l = 0; l < 4; l++) {
    const ang = (l / 4) * Math.PI * 2 + 0.9;
    ponerDeco(idLuz, Math.round(focal.x + Math.cos(ang) * (radioPlaza + 1)), Math.round(focal.y + Math.sin(ang) * (radioPlaza + 1)));
  }
  for (const ruta of caminos) {
    for (let i = 4; i < ruta.length; i += 9) {
      const p = ruta[i];
      if (!dentroMuralla(p.x, p.y)) continue;
      // la farola va en la acera: la casilla vecina que no sea calle
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = terreno.get(p.x + dx, p.y + dy);
        if ((t === "cesped" || t === "tierra") && ponerDeco(idLuz, p.x + dx, p.y + dy)) break;
      }
    }
  }

  // CONFINAMIENTO: fuera de la muralla es solo decorado de fondo, nunca
  // terreno explorable — pedido del streamer tras ver que se podía salir
  // caminando por el hueco de la puerta y perderse por el anillo exterior
  // (el camino de acceso incluido) sin usar nunca el portal. La única
  // salida real de un asentamiento amurallado es LA PUERTA como portal
  // (tecla de interacción, ya cableado en RegionRoom) — el hueco físico en
  // el muro sigue estando ahí (así no hace falta tocar el rasterizado ni
  // la detección de "puertas"), pero más allá de un despejado corto
  // alrededor de cada puerta (sitio para el abrevadero/amarradero/carreta
  // que ya se colocan ahí y para el radio de interacción del portal) todo
  // se vuelve intransitable. `extramuros` tiene el MISMO colorDebug que
  // césped (baker/catalogo/terrenos.json) — se ve exactamente igual, solo
  // que bloquea, así el corte no se nota a la vista.
  const RADIO_DESPEJADO_PUERTA = grosorRaster + 4;
  const TERRENO_CONVERTIBLE_EXTRAMUROS = new Set([
    "cesped", "cesped_ralo", "tierra", "tierra_baldia", "camino", "adoquin", "roca", "arena", "nieve", "hielo",
  ]);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (dentroMuralla(x, y)) continue;
      if (puertas.some((p) => Math.hypot(p.x - x, p.y - y) < RADIO_DESPEJADO_PUERTA)) continue;
      if (TERRENO_CONVERTIBLE_EXTRAMUROS.has(terreno.get(x, y))) terreno.set(x, y, "extramuros");
    }
  }

  // reparación de conectividad: toda puerta de edificio DEBE alcanzarse
  // desde la puerta principal — si el río o un solar la dejó aislada, se
  // abre una senda A* (con puente si cruza agua). Garantiza por
  // construcción lo que el validador exige.
  const p0 = puertas[0] || focal;
  const spawn = {
    x: Math.round(p0.x + Math.cos(Math.atan2(focal.y - p0.y, focal.x - p0.x)) * (grosorRaster + 2)),
    y: Math.round(p0.y + Math.sin(Math.atan2(focal.y - p0.y, focal.x - p0.x)) * (grosorRaster + 2)),
  };
  const TRANSITABLE_LOCAL = new Set(["cesped", "camino", "adoquin", "tierra", "tierra_labrada", "puente"]);
  const costeSenda = (x, y) => {
    const t = terreno.get(x, y);
    if (t === idTerrenoMuro || t === "solar_edificio") return Infinity;
    const k = y * ancho + x;
    if (esArbol.has(k) || decoSolida.has(k)) return Infinity; // árbol/valla/farola: la senda los rodea
    if (esAgua[k] && t !== "puente") return 14; // cruzar = construir puente
    if (t === "camino" || t === "adoquin" || t === "puente") return 0.5;
    return 1;
  };
  for (const ed of todos) {
    const alcanzable = floodDesde(terreno, spawn, TRANSITABLE_LOCAL);
    if (alcanzable.has(ed.puerta.y * ancho + ed.puerta.x)) continue;
    const senda = aEstrella(ancho, alto, ed.puerta, spawn, costeSenda);
    if (!senda) continue; // el validador lo reportará
    const tallar = (x, y) => {
      const t = terreno.get(x, y);
      if (esAgua[y * ancho + x]) terreno.set(x, y, "puente");
      else if (t === "cesped" || t === "tierra" || t === "tierra_labrada") terreno.set(x, y, "camino");
    };
    for (let i = 0; i < senda.length; i++) {
      tallar(senda[i].x, senda[i].y);
      // el A* da pasos diagonales pero se camina a 4 vecinos: rellenar el codo
      if (i > 0 && senda[i].x !== senda[i - 1].x && senda[i].y !== senda[i - 1].y) tallar(senda[i].x, senda[i - 1].y);
    }
  }

  // --- 6. salida ------------------------------------------------------------
  const portales = puertas.map((p) => ({ tipo: "exterior", x: p.x, y: p.y }));
  for (const ed of todos) portales.push({ tipo: "interior", x: ed.puerta.x, y: ed.puerta.y, edificio: ed.interior.id, tipoEdificioId: ed.tipoEdificioId });

  // elevación exportable 0..35 (base36); el agua queda hundida por su altura ya rebajada
  const elevacion = new Uint8Array(ancho * alto);
  for (let i = 0; i < elevacion.length; i++) elevacion[i] = Math.max(0, Math.min(35, Math.round(alturas[i] * 18 + 6)));

  return {
    tier, semilla, variante, ancho, alto, terreno, elevacion, radioHueco,
    zonasVerdes, arboles, deco, luces, parcelasReservadas,
    focal, plazaRadio: radioPlaza, poligonoMuralla: poligono, modulosMuralla: modulos,
    caminos: caminos.map((r) => r.filter((_, i) => i % 3 === 0)), // polilíneas aligeradas
    puertas, portales, spawn,
    edificios: todos,
    descartados: descartados.map((e) => e.tipoEdificioId),
  };
}

// ---------------------------------------------------------------------------
const TRANSITABLES = new Set(["cesped", "camino", "adoquin", "tierra", "tierra_labrada", "puente"]);

// flood 4-vecinos sobre una Rejilla de terreno con el conjunto transitable dado
function floodDesde(terreno, inicio, transitables) {
  const visitado = new Set([inicio.y * terreno.ancho + inicio.x]);
  const cola = [[inicio.x, inicio.y]];
  while (cola.length) {
    const [x, y] = cola.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * terreno.ancho + nx;
      if (!terreno.dentro(nx, ny) || visitado.has(k)) continue;
      if (!transitables.has(terreno.get(nx, ny))) continue;
      visitado.add(k);
      cola.push([nx, ny]);
    }
  }
  return visitado;
}

function floodTransitable(ciudad, inicios) {
  const { terreno } = ciudad;
  const visitado = new Set();
  const cola = [];
  for (const { x, y } of inicios) { cola.push([x, y]); visitado.add(y * terreno.ancho + x); }
  while (cola.length) {
    const [x, y] = cola.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * terreno.ancho + nx;
      if (!terreno.dentro(nx, ny) || visitado.has(k)) continue;
      if (!TRANSITABLES.has(terreno.get(nx, ny))) continue;
      visitado.add(k);
      cola.push([nx, ny]);
    }
  }
  return visitado;
}

function validarCiudad(ciudad) {
  const errores = [];
  const { terreno, poligonoMuralla } = ciudad;
  const idMuro = terreno.datos.includes("empalizada") ? "empalizada" : "muralla_piedra";

  // 1) estanqueidad: tapa las puertas y comprueba que desde fuera no se
  //    alcanza NINGUNA casilla transitable de dentro del polígono
  const tapadas = [];
  const radioTapon = (ciudad.radioHueco || 3) + 1.6; // más ancho que el hueco: sin rendijas
  for (const p of ciudad.puertas)
    for (let y = Math.floor(p.y - radioTapon); y <= p.y + radioTapon; y++)
      for (let x = Math.floor(p.x - radioTapon); x <= p.x + radioTapon; x++) {
        const t = terreno.get(x, y);
        if (t !== null && t !== idMuro && t !== "solar_edificio" && Math.hypot(x - p.x, y - p.y) <= radioTapon) {
          tapadas.push([x, y, t]);
          terreno.set(x, y, idMuro);
        }
      }
  const desdeFuera = floodTransitable(ciudad, [{ x: 0, y: 0 }]);
  let filtracion = null;
  for (const k of desdeFuera) {
    const x = k % terreno.ancho, y = Math.floor(k / terreno.ancho);
    if (puntoEnPoligono(x + 0.5, y + 0.5, poligonoMuralla) && ciudad.puertas.every((p) => Math.hypot(p.x - x, p.y - y) > radioTapon + 1.5)) {
      filtracion = `${x},${y}`;
      break;
    }
  }
  if (filtracion) errores.push(`la muralla NO es estanca: se entra sin puerta (p.ej. por ${filtracion})`);
  for (const [x, y, t] of tapadas) terreno.set(x, y, t);

  // 2) conectividad: desde el spawn se alcanza la puerta de todo edificio.
  // Los árboles de parque colisionan en juego (catálogo): se tapan para
  // que el flood no se cuele por una casilla que en realidad está ocupada.
  const taponesArbol = [];
  const catDeco = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalogo", "decoracion.json"), "utf8"));
  const solidosDeco = [
    ...(ciudad.arboles || []).filter((a) => a.colisiona !== false),
    ...(ciudad.deco || []).filter((d) => catDeco[d.i]?.colision),
  ];
  for (const a of solidosDeco) {
    const t = terreno.get(a.x, a.y);
    if (t !== null) { taponesArbol.push([a.x, a.y, t]); terreno.set(a.x, a.y, "solar_edificio"); }
  }
  const alcanzable = floodTransitable(ciudad, [ciudad.spawn]);
  for (const [x, y, t] of taponesArbol) terreno.set(x, y, t);
  for (const ed of ciudad.edificios) {
    if (!alcanzable.has(ed.puerta.y * terreno.ancho + ed.puerta.x)) {
      errores.push(`puerta inalcanzable: ${ed.tipoEdificioId} en ${ed.puerta.x},${ed.puerta.y}`);
    }
  }

  // 3) solares sin solaparse
  const vistos = new Set();
  for (const ed of ciudad.edificios)
    for (const [x, y] of ed.casillas) {
      const k = y * terreno.ancho + x;
      if (vistos.has(k)) errores.push(`solape de huellas en ${x},${y} (${ed.tipoEdificioId})`);
      vistos.add(k);
    }
  return errores;
}

module.exports = { generarCiudad, validarCiudad, cargarAsentamientos, floodTransitable, TRANSITABLES, Rejilla };
