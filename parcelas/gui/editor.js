"use strict";

// Editor de parcelas — lienzo con pan/zoom sobre el mapa principal bakeado.
// El mapa es 3200x3200 casillas (100 sectores): JAMÁS se carga entero — se
// piden por fetch solo los sectores que tocan el viewport y cada uno se
// rasteriza UNA vez a un canvas propio (1px por casilla) que luego se escala
// con drawImage. Mismo espíritu que el streaming de sectores del cliente.
//
// Mascara y Varita llegan por <script> (window.Mascara / window.Varita) —
// exactamente los mismos módulos que usan Node (servidor/demo/tests).

/* global Mascara, Varita */

(async function () {
  const lienzo = document.getElementById("lienzo");
  const ctx = lienzo.getContext("2d");
  const contenedor = document.getElementById("contenedor");
  const estadoEl = document.getElementById("estado");
  const avisoEl = document.getElementById("aviso");

  // --- Datos base: terrenos (colores/vetos) + índice del mapa + parcelas ---
  const terrenos = await (await fetch("/api/catalogo/terrenos")).json();
  const respParcelas = await (await fetch("/api/parcelas")).json();
  const rutaMapa = respParcelas.rutaMapa; // "/mapa" — el servidor decide qué mapa es
  const indice = await (await fetch(`${rutaMapa}/indice.json`)).json();

  const TAM_CHUNK = indice.tamanoChunk;
  const CHUNKS_SECTOR = indice.tamanoSectorChunks;
  const TAM_SECTOR = TAM_CHUNK * CHUNKS_SECTOR; // casillas de lado por sector
  const ANCHO = indice.anchoChunks * TAM_CHUNK;
  const ALTO = indice.altoChunks * TAM_CHUNK;
  const SECTORES_X = Math.ceil(indice.anchoChunks / CHUNKS_SECTOR);
  const SECTORES_Y = Math.ceil(indice.altoChunks / CHUNKS_SECTOR);

  let datos = respParcelas.datos; // el parcelas.json vivo (se edita aquí y se POSTea al guardar)
  let parcelaActiva = Object.keys(datos.parcelas)[0] || null;

  // Máscaras en memoria: Map<parcelaId, Set<clave>> — se editan las máscaras
  // y los runs solo se recalculan al guardar (aRuns es determinista).
  const mascaras = new Map();
  for (const [id, p] of Object.entries(datos.parcelas)) mascaras.set(id, Mascara.desdeRuns(p.runs, ANCHO));

  // --- Cámara: cx/cy = casilla del centro del viewport; escala = px/casilla ---
  const camara = { cx: indice.ciudad ? indice.ciudad.x : ANCHO / 2, cy: indice.ciudad ? indice.ciudad.y : ALTO / 2, escala: 3 };

  // --- Sectores bajo demanda ---
  // clave "sx_sy" → { canvas, terreno: Uint8Array } | "cargando" | null (no existe)
  const sectores = new Map();

  function pedirSector(sx, sy) {
    if (sx < 0 || sy < 0 || sx >= SECTORES_X || sy >= SECTORES_Y) return null;
    const k = `${sx}_${sy}`;
    if (sectores.has(k)) {
      const s = sectores.get(k);
      return s === "cargando" ? null : s;
    }
    sectores.set(k, "cargando");
    const pad3 = (n) => String(n).padStart(3, "0");
    fetch(`${rutaMapa}/sector_${pad3(sx)}_${pad3(sy)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        sectores.set(k, json ? rasterizarSector(json) : null);
        pintar();
      })
      .catch(() => sectores.set(k, null));
    return null;
  }

  // Rasteriza el sector a un canvas 1px/casilla con colorDebug del catálogo
  // y guarda además los índices de terreno (para vetos O(1) del pincel/varita).
  function rasterizarSector(sector) {
    const cv = document.createElement("canvas");
    cv.width = TAM_SECTOR;
    cv.height = TAM_SECTOR;
    const c2 = cv.getContext("2d");
    const img = c2.createImageData(TAM_SECTOR, TAM_SECTOR);
    const idx = new Uint8Array(TAM_SECTOR * TAM_SECTOR).fill(255); // 255 = sin chunk
    const colores = indice.leyendaTerreno.map((id) => {
      const hex = (terrenos[id] && terrenos[id].colorDebug) || "#ff00ff";
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    });
    const baseCx = sector.sectorX * CHUNKS_SECTOR;
    const baseCy = sector.sectorY * CHUNKS_SECTOR;
    for (const [claveChunk, chunk] of Object.entries(sector.chunks)) {
      const [cx, cy] = claveChunk.split("_").map(Number);
      const ox = (cx - baseCx) * TAM_CHUNK;
      const oy = (cy - baseCy) * TAM_CHUNK;
      for (let y = 0; y < TAM_CHUNK; y++) {
        for (let x = 0; x < TAM_CHUNK; x++) {
          const t = parseInt(chunk.terreno[y * TAM_CHUNK + x], 36);
          const p = (oy + y) * TAM_SECTOR + (ox + x);
          idx[p] = t;
          const rgb = colores[t] || [255, 0, 255];
          img.data[p * 4] = rgb[0];
          img.data[p * 4 + 1] = rgb[1];
          img.data[p * 4 + 2] = rgb[2];
          img.data[p * 4 + 3] = 255;
        }
      }
    }
    c2.putImageData(img, 0, 0);
    return { canvas: cv, terreno: idx };
  }

  /** Id de terreno de la casilla global, o null si el sector no está cargado/existe. */
  function terrenoEn(x, y) {
    if (x < 0 || y < 0 || x >= ANCHO || y >= ALTO) return null;
    const s = sectores.get(`${Math.floor(x / TAM_SECTOR)}_${Math.floor(y / TAM_SECTOR)}`);
    if (!s || s === "cargando") return null;
    const t = s.terreno[(y % TAM_SECTOR) * TAM_SECTOR + (x % TAM_SECTOR)];
    return t === 255 ? null : indice.leyendaTerreno[t];
  }

  /** Vetada según GDD §1 (terreno + pertenencia a OTRA parcela). null de terreno cuenta como vetada. */
  function casillaVetada(x, y, parcelaId) {
    const t = terrenoEn(x, y);
    if (t === null || Varita.terrenoVetado(t, terrenos[t])) return true;
    const k = Mascara.clave(x, y, ANCHO);
    for (const [id, mask] of mascaras) if (id !== parcelaId && mask.has(k)) return true;
    return false;
  }

  // --- Colores por parcela: paleta fija rotada por orden de id (estable) ---
  const PALETA = ["#e0b04a", "#6ad86a", "#d86ad8", "#6ad8d8", "#d8886a", "#8a6ad8", "#a8d84a", "#d86a8a"];
  function colorParcela(id) {
    const n = parseInt(id.replace(/\D/g, ""), 10) || 0;
    return PALETA[n % PALETA.length];
  }

  // --- Pintado ---
  function pintar() {
    const w = (lienzo.width = contenedor.clientWidth);
    const h = (lienzo.height = contenedor.clientHeight);
    const e = camara.escala;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#101014";
    ctx.fillRect(0, 0, w, h);

    // casilla ↔ píxel del viewport
    const aPx = (x) => (x - camara.cx) * e + w / 2;
    const aPy = (y) => (y - camara.cy) * e + h / 2;

    const x0 = Math.floor(camara.cx - w / 2 / e);
    const y0 = Math.floor(camara.cy - h / 2 / e);
    const x1 = Math.ceil(camara.cx + w / 2 / e);
    const y1 = Math.ceil(camara.cy + h / 2 / e);

    for (let sy = Math.floor(y0 / TAM_SECTOR); sy <= Math.floor(y1 / TAM_SECTOR); sy++) {
      for (let sx = Math.floor(x0 / TAM_SECTOR); sx <= Math.floor(x1 / TAM_SECTOR); sx++) {
        const s = pedirSector(sx, sy);
        if (s) ctx.drawImage(s.canvas, aPx(sx * TAM_SECTOR), aPy(sy * TAM_SECTOR), TAM_SECTOR * e, TAM_SECTOR * e);
      }
    }

    // Overlay de parcelas: relleno semitransparente + borde (aristas cuyo
    // vecino no pertenece a la parcela — así el borde sigue la forma orgánica).
    for (const [id, mask] of mascaras) {
      const activa = id === parcelaActiva;
      const color = colorParcela(id);
      ctx.fillStyle = color + (activa ? "66" : "38");
      ctx.strokeStyle = color;
      ctx.lineWidth = activa ? 2 : 1;
      ctx.beginPath();
      for (const k of mask) {
        const { x, y } = Mascara.coordenadas(k, ANCHO);
        if (x1 < x || x < x0 - 1 || y1 < y || y < y0 - 1) continue;
        const px = aPx(x), py = aPy(y);
        ctx.fillRect(px, py, e, e);
        if (!mask.has(k - ANCHO)) { ctx.moveTo(px, py); ctx.lineTo(px + e, py); }
        if (!mask.has(k + ANCHO)) { ctx.moveTo(px, py + e); ctx.lineTo(px + e, py + e); }
        if (!mask.has(k - 1)) { ctx.moveTo(px, py); ctx.lineTo(px, py + e); }
        if (!mask.has(k + 1)) { ctx.moveTo(px + e, py); ctx.lineTo(px + e, py + e); }
      }
      ctx.stroke();
    }

    // Vista previa de la varita (amarillo punteado hasta aceptar/descartar)
    if (preview) {
      ctx.fillStyle = "#f0e06880";
      for (const k of preview.casillas) {
        const { x, y } = Mascara.coordenadas(k, ANCHO);
        ctx.fillRect(aPx(x), aPy(y), e, e);
      }
    }

    // Huella del pincel bajo el ratón: verde pintable, rojo vetada
    if (raton && (herramienta === "pincel" || herramienta === "goma")) {
      const t = Number(selTamano.value);
      const r = Math.floor(t / 2);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = raton.x + dx, y = raton.y + dy;
          const vetada = herramienta === "pincel" && casillaVetada(x, y, parcelaActiva);
          ctx.fillStyle = vetada ? "#d84a4a90" : "#ffffff50";
          ctx.fillRect(aPx(x), aPy(y), e, e);
        }
      }
    }

    estadoEl.textContent = raton
      ? `(${raton.x}, ${raton.y}) ${terrenoEn(raton.x, raton.y) || "…"} · zoom ${e.toFixed(1)}px/casilla`
      : `zoom ${e.toFixed(1)}px/casilla`;
  }

  // --- Panel lateral ---
  const listaEl = document.getElementById("listaParcelas");
  function pintarPanel() {
    listaEl.innerHTML = "";
    for (const [id, p] of Object.entries(datos.parcelas)) {
      const div = document.createElement("div");
      div.className = "parcela" + (id === parcelaActiva ? " activa" : "");
      const n = mascaras.get(id).size;
      div.innerHTML = `
        <div class="fila"><span class="nombre"><span class="swatch" style="background:${colorParcela(id)}"></span>${p.nombre}</span><span class="dato">${id}</span></div>
        <div class="fila"><span class="dato">asentamiento: ${p.asentamiento}</span><span class="dato">${n} casillas</span></div>
        <div class="fila"><span class="dato">topeProps</span><input class="tope" type="number" min="0" value="${p.topeProps}"></div>`;
      div.addEventListener("click", (ev) => {
        if (ev.target.classList.contains("tope")) return;
        parcelaActiva = id;
        pintarPanel();
        pintar();
      });
      div.querySelector(".tope").addEventListener("change", (ev) => {
        p.topeProps = Math.max(0, Math.round(Number(ev.target.value) || 0));
        ev.target.value = p.topeProps;
      });
      listaEl.appendChild(div);
    }
  }

  function aviso(txt) {
    avisoEl.textContent = txt || "";
  }

  document.getElementById("btnCrear").addEventListener("click", () => {
    const nombre = prompt("Nombre de la parcela:", "Parcela nueva");
    if (!nombre) return;
    const asentamiento = prompt("Asentamiento:", "ciudad") || "ciudad";
    const id = `p_${String(datos.siguienteId++).padStart(4, "0")}`;
    datos.parcelas[id] = { asentamiento, nombre, runs: [], casillas: 0, topeProps: 0 };
    mascaras.set(id, new Set());
    parcelaActiva = id;
    pintarPanel();
    pintar();
  });
  document.getElementById("btnRenombrar").addEventListener("click", () => {
    if (!parcelaActiva) return;
    const nombre = prompt("Nuevo nombre:", datos.parcelas[parcelaActiva].nombre);
    if (nombre) datos.parcelas[parcelaActiva].nombre = nombre;
    pintarPanel();
  });
  document.getElementById("btnBorrar").addEventListener("click", () => {
    if (!parcelaActiva || !confirm(`¿Borrar ${datos.parcelas[parcelaActiva].nombre}?`)) return;
    delete datos.parcelas[parcelaActiva];
    mascaras.delete(parcelaActiva);
    parcelaActiva = Object.keys(datos.parcelas)[0] || null;
    pintarPanel();
    pintar();
  });

  document.getElementById("btnGuardar").addEventListener("click", async () => {
    // Los runs/casillas/topeProps salen de las máscaras vivas justo al
    // guardar — el POST re-valida en servidor y devuelve el motivo si no.
    for (const [id, p] of Object.entries(datos.parcelas)) {
      const mask = mascaras.get(id);
      p.runs = Mascara.aRuns(mask, ANCHO);
      p.casillas = mask.size;
      if (!p.topeProps) p.topeProps = Math.round(mask.size / 5);
    }
    const r = await fetch("/api/parcelas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos) });
    const resp = await r.json();
    aviso(resp.ok ? `Guardado en ${resp.archivo}` : `RECHAZADO: ${resp.motivo}`);
    pintarPanel();
  });

  document.getElementById("btnIrCiudad").addEventListener("click", () => {
    if (indice.ciudad) {
      camara.cx = indice.ciudad.x;
      camara.cy = indice.ciudad.y;
      pintar();
    }
  });

  // --- Herramientas ---
  let herramienta = "pincel"; // pincel | goma | varita
  const selTamano = document.getElementById("selTamano");
  const botones = { pincel: document.getElementById("btnPincel"), goma: document.getElementById("btnGoma"), varita: document.getElementById("btnVarita") };
  for (const [nombre, btn] of Object.entries(botones)) {
    btn.addEventListener("click", () => {
      herramienta = nombre;
      for (const b of Object.values(botones)) b.classList.remove("activa");
      btn.classList.add("activa");
    });
  }

  function aplicarPincel(x0, y0) {
    if (!parcelaActiva) return aviso("Crea o selecciona una parcela primero");
    const mask = mascaras.get(parcelaActiva);
    const t = Number(selTamano.value);
    const r = Math.floor(t / 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (herramienta === "goma") Mascara.quitar(mask, x, y, ANCHO);
        else if (!casillaVetada(x, y, parcelaActiva)) Mascara.anadir(mask, x, y, ANCHO);
      }
    }
    pintarPanel();
    pintar();
  }

  // Mulberry32 sembrado con la casilla pulsada — mismo algoritmo que
  // interiores/src/azar.js (aquí duplicado a mano porque azar.js es CommonJS
  // puro y esta GUI va sin bundler): mismo clic = misma parcela.
  function crearPRNG(semillaTexto) {
    let h = 1779033703 ^ semillaTexto.length;
    for (let i = 0; i < semillaTexto.length; i++) {
      h = Math.imul(h ^ semillaTexto.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let preview = null; // { casillas: Set } pendiente de aceptar/descartar
  const previewBarra = document.getElementById("previewBarra");

  function lanzarVarita(x, y) {
    if (!parcelaActiva) return aviso("Crea o selecciona una parcela primero");
    const objetivo = Math.max(1, Number(document.getElementById("inObjetivo").value) || 1);
    const { casillas, completo } = Varita.crecimientoParcela({
      esValida: (vx, vy) => !casillaVetada(vx, vy, parcelaActiva) && !mascaras.get(parcelaActiva).has(Mascara.clave(vx, vy, ANCHO)),
      semillaX: x,
      semillaY: y,
      objetivo,
      rnd: crearPRNG(`varita|${x}|${y}`),
      anchoMapa: ANCHO,
    });
    if (casillas.size === 0) return aviso("La semilla cae en casilla vetada");
    preview = { casillas };
    document.getElementById("previewTexto").textContent = `${casillas.size} casillas${completo ? "" : " (frontera agotada antes del objetivo)"}`;
    previewBarra.style.display = "flex";
    pintar();
  }

  document.getElementById("btnAceptar").addEventListener("click", () => {
    if (preview && parcelaActiva) {
      const mask = mascaras.get(parcelaActiva);
      for (const k of preview.casillas) mask.add(k);
    }
    preview = null;
    previewBarra.style.display = "none";
    pintarPanel();
    pintar();
  });
  document.getElementById("btnDescartar").addEventListener("click", () => {
    preview = null;
    previewBarra.style.display = "none";
    pintar();
  });

  // --- Ratón: pan (botón secundario o espacio), zoom (rueda), pintar (primario) ---
  let raton = null; // casilla bajo el cursor
  let arrastre = null; // { px, py } último punto de pan
  let pintando = false;
  let espacio = false;

  function casillaDeEvento(ev) {
    const r = lienzo.getBoundingClientRect();
    return {
      x: Math.floor((ev.clientX - r.left - lienzo.width / 2) / camara.escala + camara.cx),
      y: Math.floor((ev.clientY - r.top - lienzo.height / 2) / camara.escala + camara.cy),
    };
  }

  lienzo.addEventListener("contextmenu", (ev) => ev.preventDefault());
  lienzo.addEventListener("mousedown", (ev) => {
    if (ev.button === 2 || espacio) {
      arrastre = { px: ev.clientX, py: ev.clientY };
      return;
    }
    if (ev.button === 0) {
      const c = casillaDeEvento(ev);
      if (herramienta === "varita") lanzarVarita(c.x, c.y);
      else {
        pintando = true;
        aplicarPincel(c.x, c.y);
      }
    }
  });
  window.addEventListener("mouseup", () => {
    arrastre = null;
    pintando = false;
  });
  lienzo.addEventListener("mousemove", (ev) => {
    if (arrastre) {
      camara.cx -= (ev.clientX - arrastre.px) / camara.escala;
      camara.cy -= (ev.clientY - arrastre.py) / camara.escala;
      arrastre = { px: ev.clientX, py: ev.clientY };
      pintar();
      return;
    }
    raton = casillaDeEvento(ev);
    if (pintando) aplicarPincel(raton.x, raton.y);
    else pintar();
  });
  lienzo.addEventListener("mouseleave", () => {
    raton = null;
    pintar();
  });
  lienzo.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    // Zoom centrado en el cursor: la casilla bajo el ratón no se mueve.
    const antes = casillaDeEvento(ev);
    camara.escala = Math.min(24, Math.max(0.35, camara.escala * (ev.deltaY < 0 ? 1.2 : 1 / 1.2)));
    const despues = casillaDeEvento(ev);
    camara.cx += antes.x - despues.x;
    camara.cy += antes.y - despues.y;
    pintar();
  }, { passive: false });
  window.addEventListener("keydown", (ev) => {
    if (ev.code === "Space") espacio = true;
  });
  window.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") espacio = false;
  });
  window.addEventListener("resize", pintar);

  pintarPanel();
  pintar();
})();
