/**
 * Marco común para paneles/menús de UI superpuestos al HUD (pedido streamer
 * 2026-09-09: placeholders sencillos para todos los menús/pantallas, cada
 * uno minimizable, con una X arriba-derecha y clic fuera para cerrar).
 * Unifica lo que cada panel repetía a mano (fondo/borde/tipografía,
 * abrir/cerrar) para que "retocar estéticamente" más adelante sea editar
 * temaPaneles.css, no cada archivo de panel.
 *
 * Por COMPOSICIÓN, no herencia: `crearMarcoPanel(...)` devuelve `{raiz,
 * cuerpo, abrir, cerrar, ...}` — un panel (nuevo o ya existente) lo llama
 * una vez y monta SU contenido en `cuerpo`, sin tener que encajar su lógica
 * (rejillas, formularios, sesiones de minijuego...) en una jerarquía de
 * clases que no pintan todas igual.
 *
 * Clic fuera cierra (mismo criterio que menuInteraccion.ts, 'mousedown' para
 * disparar antes que cualquier 'click' de apertura) — pero ignora a
 * propósito los iconos del dock (`.dock-hud-icono`): cada icono llama a
 * `alternar()` de SU panel, y si el cierre genérico también reaccionara a
 * ese mismo clic (el icono está fuera de `raiz`), un panel abierto se
 * cerraría y volvería a abrirse en el mismo gesto — el mismo tipo de bug
 * ya resuelto una vez en el proyecto para menuInteraccion.ts/game.ts
 * (2026-09-06, "un clic con el menú ya abierto solo lo cierra, nunca
 * reabre de paso").
 */

export interface OpcionesMarcoPanel {
  contenedor: HTMLElement;
  titulo: string;
  icono?: string;
  left?: string;
  top?: string;
  ancho?: string;
  /** false para paneles que NO deben cerrarse solos con un clic fuera (raro — por defecto true). */
  cierraAlClicarFuera?: boolean;
  /** false para paneles sin Escape propio (raro — por defecto true). */
  cierraConEscape?: boolean;
}

export interface MarcoPanel {
  /** Elemento raíz completo (cabecera + cuerpo), ya insertado en `contenedor`. */
  raiz: HTMLDivElement;
  /** Dónde montar el contenido propio del panel — nunca en `raiz` directamente. */
  cuerpo: HTMLDivElement;
  abrir(): void;
  cerrar(): void;
  alternar(): void;
  estaAbierto(): boolean;
  /** Se dispara en cada abrir/cerrar por CUALQUIER vía (X, clic fuera, Escape, o programático) — dockHud.ts lo usa para reflejar el aro de "abierto" en su icono. */
  onCambioEstado(cb: () => void): void;
}

// Arrastre por la cabecera (pedido streamer 2026-09-13: "los paneles se
// puedan mover por si se solapan al abrir con click sobre el y
// arrastrarlo"). Contador de z-index COMPARTIDO por todos los paneles del
// marco — arrancar por encima del z-index base (40, temaPaneles.css) y subir
// con cada arrastre/clic en una cabecera trae ese panel al frente, útil
// justo para el caso que motivó el pedido (dos paneles solapados).
let contadorZIndexPanel = 40;

export function crearMarcoPanel(opciones: OpcionesMarcoPanel): MarcoPanel {
  const raiz = document.createElement("div");
  raiz.className = "panel-colony";
  raiz.style.display = "none";
  if (opciones.left) raiz.style.left = opciones.left;
  if (opciones.top) raiz.style.top = opciones.top;
  if (opciones.ancho) raiz.style.width = opciones.ancho;

  const cabecera = document.createElement("div");
  cabecera.className = "panel-colony-cabecera";
  const tituloEl = document.createElement("span");
  tituloEl.textContent = opciones.icono ? `${opciones.icono} ${opciones.titulo}` : opciones.titulo;
  cabecera.appendChild(tituloEl);
  const botonCerrar = document.createElement("button");
  botonCerrar.className = "panel-colony-cerrar";
  botonCerrar.textContent = "✕";
  botonCerrar.title = "Cerrar";
  botonCerrar.onclick = () => cerrar();
  cabecera.appendChild(botonCerrar);
  raiz.appendChild(cabecera);

  const cuerpo = document.createElement("div");
  cuerpo.className = "panel-colony-cuerpo";
  raiz.appendChild(cuerpo);

  opciones.contenedor.appendChild(raiz);

  let abierto = false;
  const listenersCambio: (() => void)[] = [];
  const notificar = () => {
    for (const cb of listenersCambio) cb();
  };

  function abrir() {
    if (abierto) return;
    abierto = true;
    raiz.style.display = "flex";
    notificar();
  }
  function cerrar() {
    if (!abierto) return;
    abierto = false;
    raiz.style.display = "none";
    notificar();
  }
  function alternar() {
    if (abierto) cerrar();
    else abrir();
  }
  function estaAbierto() {
    return abierto;
  }

  if (opciones.cierraAlClicarFuera !== false) {
    window.addEventListener("mousedown", (e) => {
      if (!abierto) return;
      if (e.target instanceof Node && raiz.contains(e.target)) return;
      if (e.target instanceof HTMLElement && e.target.closest(".dock-hud-icono")) return;
      cerrar();
    });
  }
  if (opciones.cierraConEscape !== false) {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && abierto) cerrar();
    });
  }

  // Arrastre: solo si el panel usa `position:absolute` de verdad — los dos
  // overlays fullscreen centrados por flex (panelResumen.ts/
  // panelMapaMundo.ts) fuerzan `position:relative` a propósito para no
  // romper su centrado ("el position:absolute del tema rompería el
  // centrado"), y ahí arrastrar no tiene sentido: el contenedor ya es
  // pantalla completa. La comprobación es sobre el estilo COMPUTADO (no
  // `opciones`) para que siga funcionando aunque el override se haga después
  // de crear el marco, como ya hacen esos dos paneles.
  let arrastrando = false;
  let inicioPuntero = { x: 0, y: 0 };
  let inicioPanel = { left: 0, top: 0 };

  function origenAncestro(): { left: number; top: number } {
    const padre = raiz.offsetParent as HTMLElement | null;
    if (!padre) return { left: 0, top: 0 };
    const r = padre.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }

  cabecera.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // solo botón principal del ratón (touch/pen dan 0 igualmente)
    if (e.target instanceof HTMLElement && e.target.closest(".panel-colony-cerrar")) return;
    if (getComputedStyle(raiz).position !== "absolute") return;
    const rectRaiz = raiz.getBoundingClientRect();
    const origen = origenAncestro();
    // Neutraliza cualquier transform de centrado (translate(-50%,...), usado
    // por la mayoría de paneles para centrarse en left:50%/top:50%) y
    // cualquier anclaje por right/bottom (panelCompanero.ts/panelMascotas.ts)
    // fijando left/top explícitos que reproducen EXACTAMENTE la posición
    // visual actual — el panel no debe saltar al primer píxel de arrastre.
    raiz.style.transform = "none";
    raiz.style.right = "auto";
    raiz.style.bottom = "auto";
    inicioPanel = { left: rectRaiz.left - origen.left, top: rectRaiz.top - origen.top };
    raiz.style.left = `${inicioPanel.left}px`;
    raiz.style.top = `${inicioPanel.top}px`;
    raiz.style.zIndex = String(++contadorZIndexPanel);
    inicioPuntero = { x: e.clientX, y: e.clientY };
    arrastrando = true;
    cabecera.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cabecera.addEventListener("pointermove", (e) => {
    if (!arrastrando) return;
    const origen = origenAncestro();
    const maxLeft = Math.max(0, window.innerWidth - origen.left - raiz.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - origen.top - raiz.offsetHeight);
    const nuevoLeft = Math.min(maxLeft, Math.max(0, inicioPanel.left + (e.clientX - inicioPuntero.x)));
    const nuevoTop = Math.min(maxTop, Math.max(0, inicioPanel.top + (e.clientY - inicioPuntero.y)));
    raiz.style.left = `${nuevoLeft}px`;
    raiz.style.top = `${nuevoTop}px`;
  });
  const terminarArrastre = (e: PointerEvent) => {
    if (!arrastrando) return;
    arrastrando = false;
    if (cabecera.hasPointerCapture(e.pointerId)) cabecera.releasePointerCapture(e.pointerId);
  };
  cabecera.addEventListener("pointerup", terminarArrastre);
  cabecera.addEventListener("pointercancel", terminarArrastre);

  return { raiz, cuerpo, abrir, cerrar, alternar, estaAbierto, onCambioEstado: (cb) => listenersCambio.push(cb) };
}

/** Línea de texto simple — mismo estilo que ya repetían panelJugador.ts/panelMascotas.ts a mano. */
export function crearLineaTexto(texto: string, opts?: { negrita?: boolean; tenue?: boolean; fontSize?: string }): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = texto;
  if (opts?.negrita) el.style.fontWeight = "bold";
  if (opts?.tenue) el.style.color = "var(--panel-texto-tenue)";
  if (opts?.fontSize) el.style.fontSize = opts.fontSize;
  el.style.marginBottom = "4px";
  return el;
}

/** Subtítulo de sección con separador — mismo patrón que `subtitulo()` de panelJugador.ts. */
export function crearSubtitulo(texto: string): HTMLDivElement {
  const el = document.createElement("div");
  el.textContent = texto;
  el.style.fontWeight = "bold";
  el.style.marginTop = "8px";
  el.style.marginBottom = "3px";
  el.style.borderTop = "1px solid var(--panel-borde)";
  el.style.paddingTop = "4px";
  return el;
}

/** Botón con el estilo compartido (`.panel-colony-boton` de temaPaneles.css). */
export function crearBoton(texto: string, onClick: () => void): HTMLButtonElement {
  const boton = document.createElement("button");
  boton.textContent = texto;
  boton.className = "panel-colony-boton";
  boton.onclick = onClick;
  return boton;
}

/** Campo de texto con el estilo compartido. */
export function crearInput(opts?: { placeholder?: string; tipo?: string }): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "panel-colony-input";
  input.type = opts?.tipo ?? "text";
  if (opts?.placeholder) input.placeholder = opts.placeholder;
  return input;
}
