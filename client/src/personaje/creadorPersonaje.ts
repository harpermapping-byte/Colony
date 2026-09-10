import * as THREE from "three";
import { CATALOGO_PERSONAJE, construirFichaPreview, type EleccionPersonaje } from "./crearFichaVoxel";
import { crearPersonajeVoxel } from "../render3d/personajeVoxel";
import { crearBoton } from "../ui/panelBase";
import { SERVER_URL } from "../config";

const SERVER_URL_HTTP = SERVER_URL.replace(/^ws/, "http");

/** "corto_flequillo" -> "Corto flequillo" — evita mantener a mano una etiqueta por cada uno de los 45 estilos del catálogo (mismo criterio "las listas crecen, el código no" de CLAUDE.md). */
function formatearId(id: string): string {
  const texto = id.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Libera geometría/material de TODA la jerarquía de un rig — se recrea entero en cada cambio de elección durante la vista previa, así que sin esto cada clic dejaría huérfana en la GPU la malla anterior (mismo tipo de leak ya cerrado en otros sitios del proyecto, ver aplicarEquipoAlRig/personajeVoxel.ts). */
function disponerRigCompleto(objeto: THREE.Object3D): void {
  objeto.traverse((o) => {
    const malla = o as THREE.Mesh;
    if (!malla.geometry) return;
    malla.geometry.dispose();
    const material = malla.material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) m.dispose();
  });
}

/** Vista previa 3D girable (pedido streamer: "panel con vista previa 3D girable") — escena Three.js propia, aislada del mundo (esta pantalla existe ANTES de conectar con Colyseus). Arrastrar rota en yaw; suelto, gira solo despacio. */
class VistaPreviaPersonaje {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camara: THREE.PerspectiveCamera;
  private rig: ReturnType<typeof crearPersonajeVoxel> | null = null;
  private anguloY = Math.PI * 0.18;
  private arrastrando = false;
  private ultimoX = 0;
  private rafId = 0;
  private destruida = false;

  private readonly onPointerDown = (e: PointerEvent) => {
    this.arrastrando = true;
    this.ultimoX = e.clientX;
  };
  private readonly onPointerUp = () => {
    this.arrastrando = false;
  };
  private readonly onPointerMove = (e: PointerEvent) => {
    if (!this.arrastrando) return;
    this.anguloY += (e.clientX - this.ultimoX) * 0.012;
    this.ultimoX = e.clientX;
  };

  constructor(ancho = 240, alto = 300) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "creador-preview-canvas";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(ancho, alto, false);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sol = new THREE.DirectionalLight(0xffffff, 0.85);
    sol.position.set(1.4, 2.6, 2.2);
    this.scene.add(sol);

    this.camara = new THREE.PerspectiveCamera(35, ancho / alto, 0.05, 10);
    this.camara.position.set(0, 0.95, 2.5);
    this.camara.lookAt(0, 0.85, 0);

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointermove", this.onPointerMove);

    const animar = () => {
      if (this.destruida) return;
      if (this.rig) {
        if (!this.arrastrando) this.anguloY += 0.005;
        this.rig.objeto.rotation.y = this.anguloY;
      }
      this.renderer.render(this.scene, this.camara);
      this.rafId = requestAnimationFrame(animar);
    };
    this.rafId = requestAnimationFrame(animar);
  }

  actualizar(eleccion: EleccionPersonaje): void {
    const { ficha, voxelesCabeza } = construirFichaPreview(eleccion);
    if (this.rig) {
      this.scene.remove(this.rig.objeto);
      disponerRigCompleto(this.rig.objeto);
    }
    this.rig = crearPersonajeVoxel({ ficha, voxelesCabeza, ropa: [] });
    this.rig.objeto.rotation.order = "YXZ";
    this.rig.objeto.rotation.y = this.anguloY;
    this.scene.add(this.rig.objeto);
  }

  destruir(): void {
    this.destruida = true;
    cancelAnimationFrame(this.rafId);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointermove", this.onPointerMove);
    if (this.rig) disponerRigCompleto(this.rig.objeto);
    this.renderer.dispose();
  }
}

interface RespuestaPersonaje {
  personaje?: unknown;
  error?: string;
}

/**
 * Pantalla completa (mismo criterio que `pantallaBienvenida.ts`: NO usa
 * `crearMarcoPanel`, sin X/clic-fuera/Escape — pedido streamer "justo
 * después del login", obligatorio para una cuenta que aún no tiene
 * personaje guardado). `alConfirmar` es lo que ya hacía `alContinuar` en la
 * bienvenida (conectar y cargar el mundo) — se llama solo tras guardar la
 * ficha con éxito en el servidor.
 */
export function mostrarCreadorPersonaje(contenedor: HTMLElement, token: string, alConfirmar: () => Promise<void>): void {
  const fondo = document.createElement("div");
  fondo.className = "bienvenida-fondo";
  fondo.dataset.testid = "creador-personaje";
  contenedor.appendChild(fondo);

  const tarjeta = document.createElement("div");
  tarjeta.className = "creador-tarjeta";
  fondo.appendChild(tarjeta);

  const titulo = document.createElement("div");
  titulo.className = "creador-titulo";
  titulo.textContent = "🧑 Crea tu personaje";
  tarjeta.appendChild(titulo);

  const layout = document.createElement("div");
  layout.className = "creador-layout";
  tarjeta.appendChild(layout);

  const columnaPreview = document.createElement("div");
  columnaPreview.className = "creador-preview";
  layout.appendChild(columnaPreview);

  const previa = new VistaPreviaPersonaje();
  columnaPreview.appendChild(previa.canvas);
  const pistaGiro = document.createElement("div");
  pistaGiro.style.fontSize = "11px";
  pistaGiro.style.opacity = "0.6";
  pistaGiro.textContent = "arrastra para girar";
  columnaPreview.appendChild(pistaGiro);

  const columnaForm = document.createElement("div");
  columnaForm.className = "creador-form";
  layout.appendChild(columnaForm);

  const eleccion: EleccionPersonaje = {
    sexo: "hombre",
    peloEstilo: "corto",
    barbaEstilo: "ninguna",
    peloColorId: CATALOGO_PERSONAJE.coloresPelo[0][0],
    pielColorId: CATALOGO_PERSONAJE.coloresPiel[0][0],
    ojosColorId: CATALOGO_PERSONAJE.coloresOjos[0][0],
    altura: CATALOGO_PERSONAJE.rangoAltura.defecto,
    corpulencia: CATALOGO_PERSONAJE.rangoCorpulencia.defecto,
  };

  let enviando = false;
  let botonConfirmar: HTMLButtonElement;
  const errorEl = document.createElement("div");
  errorEl.className = "panel-colony-error";

  function fila(etiqueta: string, control: HTMLElement): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "creador-fila";
    const lbl = document.createElement("div");
    lbl.className = "creador-fila-etiqueta";
    lbl.textContent = etiqueta;
    el.appendChild(lbl);
    el.appendChild(control);
    return el;
  }

  function filaSwatches(etiqueta: string, opciones: [string, number, string][], actual: string, onElegir: (id: string) => void): HTMLDivElement {
    const cont = document.createElement("div");
    cont.className = "creador-swatches";
    for (const [id, , hex] of opciones) {
      const boton = document.createElement("button");
      boton.className = "creador-swatch";
      boton.style.background = hex;
      boton.title = formatearId(id);
      boton.dataset.activo = String(id === actual);
      boton.onclick = () => onElegir(id);
      cont.appendChild(boton);
    }
    return fila(etiqueta, cont);
  }

  function filaSelect(etiqueta: string, opciones: string[], actual: string, onElegir: (id: string) => void): HTMLDivElement {
    const select = document.createElement("select");
    select.className = "panel-colony-input";
    for (const id of opciones) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = formatearId(id);
      opt.selected = id === actual;
      select.appendChild(opt);
    }
    select.onchange = () => onElegir(select.value);
    return fila(etiqueta, select);
  }

  function filaSlider(etiqueta: string, rango: { min: number; max: number }, actual: number, onCambiar: (v: number) => void): HTMLDivElement {
    const cont = document.createElement("div");
    cont.className = "creador-slider-fila";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(rango.min);
    input.max = String(rango.max);
    input.step = "0.01";
    input.value = String(actual);
    const valorEl = document.createElement("span");
    valorEl.className = "creador-slider-valor";
    valorEl.textContent = actual.toFixed(2);
    input.oninput = () => {
      const v = Number(input.value);
      valorEl.textContent = v.toFixed(2);
      onCambiar(v);
    };
    cont.appendChild(input);
    cont.appendChild(valorEl);
    return fila(etiqueta, cont);
  }

  function actualizarPreview() {
    previa.actualizar(eleccion);
  }

  function renderForm() {
    columnaForm.innerHTML = "";

    const sexoFila = document.createElement("div");
    sexoFila.className = "creador-sexo-pestanas";
    const botonHombre = crearBoton("♂ Hombre", () => { eleccion.sexo = "hombre"; renderForm(); actualizarPreview(); });
    const botonMujer = crearBoton("♀ Mujer", () => { eleccion.sexo = "mujer"; renderForm(); actualizarPreview(); });
    botonHombre.style.opacity = eleccion.sexo === "hombre" ? "1" : "0.55";
    botonMujer.style.opacity = eleccion.sexo === "mujer" ? "1" : "0.55";
    sexoFila.appendChild(botonHombre);
    sexoFila.appendChild(botonMujer);
    columnaForm.appendChild(fila("Sexo", sexoFila));

    columnaForm.appendChild(filaSlider("Altura", CATALOGO_PERSONAJE.rangoAltura, eleccion.altura, (v) => { eleccion.altura = v; actualizarPreview(); }));
    columnaForm.appendChild(filaSlider("Corpulencia", CATALOGO_PERSONAJE.rangoCorpulencia, eleccion.corpulencia, (v) => { eleccion.corpulencia = v; actualizarPreview(); }));

    columnaForm.appendChild(filaSelect("Peinado", CATALOGO_PERSONAJE.peloEstilos, eleccion.peloEstilo, (id) => { eleccion.peloEstilo = id; renderForm(); actualizarPreview(); }));
    columnaForm.appendChild(filaSelect("Barba", CATALOGO_PERSONAJE.barbaEstilos, eleccion.barbaEstilo, (id) => { eleccion.barbaEstilo = id; renderForm(); actualizarPreview(); }));

    columnaForm.appendChild(filaSwatches("Color de pelo", CATALOGO_PERSONAJE.coloresPelo, eleccion.peloColorId, (id) => { eleccion.peloColorId = id; renderForm(); actualizarPreview(); }));
    columnaForm.appendChild(filaSwatches("Color de piel", CATALOGO_PERSONAJE.coloresPiel, eleccion.pielColorId, (id) => { eleccion.pielColorId = id; renderForm(); actualizarPreview(); }));
    columnaForm.appendChild(filaSwatches("Color de ojos", CATALOGO_PERSONAJE.coloresOjos, eleccion.ojosColorId, (id) => { eleccion.ojosColorId = id; renderForm(); actualizarPreview(); }));

    columnaForm.appendChild(errorEl);
    botonConfirmar = crearBoton("Confirmar personaje", () => void confirmar());
    botonConfirmar.className += " bienvenida-boton-principal";
    botonConfirmar.dataset.testid = "creador-confirmar";
    botonConfirmar.disabled = enviando;
    columnaForm.appendChild(botonConfirmar);
  }

  async function confirmar() {
    if (enviando) return;
    enviando = true;
    errorEl.textContent = "";
    renderForm();
    try {
      const r = await fetch(`${SERVER_URL_HTTP}/auth/jugador/personaje`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, eleccion }),
      });
      const cuerpo = (await r.json().catch(() => null)) as RespuestaPersonaje | null;
      if (!r.ok) {
        errorEl.textContent = cuerpo?.error ?? "no se pudo guardar el personaje";
        enviando = false;
        renderForm();
        return;
      }
      // Mismo criterio "carga en paralelo" que pantallaBienvenida.ts: no se
      // retira el overlay hasta que el mundo termina de cargar, para no
      // dejar un hueco de canvas en negro entre confirmar y ver el mundo.
      previa.destruir();
      tarjeta.innerHTML = "";
      tarjeta.appendChild(titulo);
      const spinner = document.createElement("div");
      spinner.className = "bienvenida-spinner";
      tarjeta.appendChild(spinner);
      await alConfirmar();
      fondo.remove();
    } catch {
      errorEl.textContent = "no se pudo conectar con el servidor";
      enviando = false;
      renderForm();
    }
  }

  renderForm();
  actualizarPreview();
}
