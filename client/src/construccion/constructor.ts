/**
 * MODO CONSTRUCCIÓN estilo Project Zomboid (GDD_Construccion §6): tecla B,
 * panel DOM con los catálogos construibles, fantasma verde/rojo con snap a
 * casilla y rotación R, bordes de parcela visibles solo dentro del modo.
 *
 * El fantasma valida con el ESPEJO local de las reglas del servidor (§5:
 * casillas en parcela propia + sin solapar construcciones conocidas +
 * dentro del topeProps) para dar feedback instantáneo — la verdad final la
 * dicta siempre el servidor, que responde "construir:error" si discrepa.
 */
import * as THREE from "three";
import type { WorldScene } from "../render3d/worldScene";
import {
  CONSTRUIBLES_POR_CATEGORIA,
  ALTURA_CATEGORIA,
  huellaRotada,
  type Construible,
} from "./catalogoConstruccion";
import { crearBordesParcela, type ArchivoParcelas } from "./parcelasCliente";
import type { RenderConstrucciones } from "./renderConstrucciones";

/** Payload del mensaje "construir" (contrato §4). */
export interface MensajeConstruir {
  objeto: string;
  categoria: string;
  x: number;
  y: number;
  rot: number;
  variante: number;
}

export interface OpcionesConstructor {
  contenedor: HTMLElement;
  escena: WorldScene;
  /** Nombre del jugador local — identidad v1 del contrato (§4). */
  nombreJugador: string;
  anchoMapa: number;
  parcelas: ArchivoParcelas | null;
  /** casilla (y*anchoMapa+x) → parcelaId, de parcelasCliente. */
  indiceParcelas: Map<number, string>;
  render: RenderConstrucciones;
  enviarConstruir(mensaje: MensajeConstruir): void;
}

// colores pactados: propia verde / ajena gris; fantasma verde válido / rojo no
const COLOR_PARCELA_PROPIA = "#48bb78";
const COLOR_PARCELA_AJENA = "#718096";
const COLOR_FANTASMA_OK = 0x3ddc78;
const COLOR_FANTASMA_MAL = 0xe74c3c;
const MS_ERROR = 3000; // "construir:error" visible 3 segundos (§6)

interface Validez {
  ok: boolean;
  motivo: string;
  parcelaId: string | null;
}

export class ModoConstruccion {
  private _activo = false;
  private seleccionado: Construible | null = null;
  private rot = 0;
  private casillaX = 0;
  private casillaY = 0;
  private punteroValido = false; // ¿el ray tocó el plano del suelo alguna vez?
  private ultimaValidez: Validez = { ok: false, motivo: "", parcelaId: null };

  // dueños de parcela según "parcelas:estado" (servidor manda al entrar y
  // tras cada cambio); vacío hasta que llegue — el modo avisa si no hay nada
  private duenos: Record<string, { dueno: string | null }> = {};

  private fantasma: THREE.Mesh | null = null;
  private bordes: THREE.Group | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly puntoRay = new THREE.Vector3();

  // panel DOM
  private readonly panel: HTMLDivElement;
  private readonly lineaInfo: HTMLDivElement;
  private readonly lineaError: HTMLDivElement;
  private readonly botones = new Map<string, HTMLButtonElement>();
  private temporizadorError: ReturnType<typeof setTimeout> | null = null;
  private temporizadorAviso: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opciones: OpcionesConstructor) {
    const { panel, lineaInfo, lineaError } = this.crearPanel();
    this.panel = panel;
    this.lineaInfo = lineaInfo;
    this.lineaError = lineaError;

    const lienzo = opciones.escena.renderer.domElement;
    lienzo.addEventListener("mousemove", (e) => this.alMoverPuntero(e));
    lienzo.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.alClic();
    });
    window.addEventListener("keydown", (e) => {
      if (!this._activo) return;
      const k = e.key.toLowerCase();
      if (k === "r") this.rotar();
      if (k === "escape") this.desactivar();
    });
  }

  activo(): boolean {
    return this._activo;
  }

  /** Nuevo estado de dueños del servidor ("parcelas:estado"). */
  actualizarDuenos(estado: Record<string, { dueno: string | null }>): void {
    this.duenos = estado || {};
    if (this._activo) this.refrescarBordes(); // una asignación en caliente recolorea
  }

  /** Estado crudo recibido — lo lee la sonda de tests de game.ts. */
  estadoParcelas(): Record<string, { dueno: string | null }> {
    return this.duenos;
  }

  alternar(): void {
    if (this._activo) this.desactivar();
    else this.activar();
  }

  /**
   * Entra al modo si el jugador es dueño de ALGUNA parcela (aunque no la
   * pise: construir fuera ya lo veta el servidor por parcela). Sin ninguna,
   * aviso breve en el panel y no se activa.
   */
  activar(): void {
    if (this._activo) return;
    if (!this.tieneAlgunaParcela()) {
      this.avisoBreve("No eres dueño de ninguna parcela — pide una al jarl.");
      return;
    }
    this._activo = true;
    this.panel.style.display = "block";
    this.lineaInfo.textContent = "Elige un objeto y apunta a tu parcela.";
    this.refrescarBordes();
  }

  desactivar(): void {
    if (!this._activo) return;
    this._activo = false;
    this.panel.style.display = "none";
    this.seleccionar(null);
    this.quitarBordes();
  }

  /** Selecciona (o deselecciona con null) un construible por id. */
  seleccionar(id: string | null): void {
    for (const [bid, boton] of this.botones) boton.classList.toggle("sel", bid === id);
    if (id === null) {
      this.seleccionado = null;
      this.quitarFantasma();
      return;
    }
    for (const lista of CONSTRUIBLES_POR_CATEGORIA.values()) {
      const c = lista.find((x) => x.id === id);
      if (c) {
        this.seleccionado = c;
        this.rot = 0;
        this.reconstruirFantasma();
        return;
      }
    }
  }

  seleccionadoId(): string | null {
    return this.seleccionado?.id ?? null;
  }

  /** R: gira la huella 0..3 (pasos de 90° horario). */
  rotar(): void {
    if (!this.seleccionado) return;
    this.rot = (this.rot + 1) % 4;
    this.reconstruirFantasma();
  }

  /** Envía "construir" con lo seleccionado en una casilla concreta (la usa la sonda e2e). */
  colocarEn(x: number, y: number): boolean {
    if (!this.seleccionado) return false;
    this.opciones.enviarConstruir({
      objeto: this.seleccionado.id,
      categoria: this.seleccionado.categoria,
      x,
      y,
      rot: this.rot,
      variante: 0,
    });
    return true;
  }

  /** "construir:error" del servidor: motivo visible 3 segundos. */
  mostrarError(motivo: string): void {
    this.lineaError.textContent = motivo || "El servidor rechazó la construcción.";
    this.lineaError.style.display = "block";
    if (this.temporizadorError) clearTimeout(this.temporizadorError);
    this.temporizadorError = setTimeout(() => {
      this.lineaError.style.display = "none";
    }, MS_ERROR);
  }

  // ------------------------------------------------------------------ ratón

  private alMoverPuntero(e: MouseEvent): void {
    if (!this._activo) return;
    const lienzo = this.opciones.escena.renderer.domElement;
    const r = lienzo.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    // con cámara ortográfica setFromCamera lanza el rayo paralelo al eje de
    // vista desde el punto del encuadre — intersección limpia con y=0
    this.raycaster.setFromCamera(ndc, this.opciones.escena.camera);
    if (!this.raycaster.ray.intersectPlane(this.planoSuelo, this.puntoRay)) return;
    this.punteroValido = true;
    this.casillaX = Math.floor(this.puntoRay.x);
    this.casillaY = Math.floor(this.puntoRay.z);
    this.refrescarFantasma();
  }

  private alClic(): void {
    if (!this._activo || !this.seleccionado || !this.punteroValido) return;
    if (!this.ultimaValidez.ok) return; // rojo: ni se envía (el servidor lo rechazaría igual)
    this.colocarEn(this.casillaX, this.casillaY);
  }

  // -------------------------------------------------------------- validación

  private tieneAlgunaParcela(): boolean {
    const { parcelas, nombreJugador } = this.opciones;
    if (!parcelas) return false;
    return Object.keys(parcelas.parcelas).some((id) => this.duenos[id]?.dueno === nombreJugador);
  }

  /** Espejo local de §5: parcela PROPIA entera + sin solape + bajo el tope. */
  private validar(cx: number, cy: number): Validez {
    const { parcelas, indiceParcelas, anchoMapa, render, nombreJugador } = this.opciones;
    if (!this.seleccionado) return { ok: false, motivo: "", parcelaId: null };
    const [w, h] = huellaRotada(this.seleccionado.huella, this.rot);

    const parcelaId = indiceParcelas.get(cy * anchoMapa + cx) ?? null;
    if (!parcelaId) return { ok: false, motivo: "Fuera de parcela", parcelaId: null };
    if (this.duenos[parcelaId]?.dueno !== nombreJugador) return { ok: false, motivo: "Parcela ajena", parcelaId };

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (indiceParcelas.get(y * anchoMapa + x) !== parcelaId)
          return { ok: false, motivo: "La huella se sale de la parcela", parcelaId };
        if (render.ocupada(x, y)) return { ok: false, motivo: "Casilla ocupada", parcelaId };
      }
    }

    const tope = parcelas?.parcelas[parcelaId]?.topeProps ?? 0;
    if (render.contarPorPropiedad(parcelaId) >= tope)
      return { ok: false, motivo: `Tope de la parcela alcanzado (${tope})`, parcelaId };

    return { ok: true, motivo: "", parcelaId };
  }

  // ---------------------------------------------------------------- fantasma

  private reconstruirFantasma(): void {
    this.quitarFantasma();
    if (!this.seleccionado) return;
    const [w, h] = huellaRotada(this.seleccionado.huella, this.rot);
    const altura = ALTURA_CATEGORIA[this.seleccionado.categoria];
    // caja semitransparente sin depthWrite: se ve el terreno a través y no
    // ensucia el z-buffer mientras persigue al puntero
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.seleccionado.colorDebug),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.fantasma = new THREE.Mesh(new THREE.BoxGeometry(w, altura, h), material);
    this.opciones.escena.añadirEstatico(this.fantasma);
    this.refrescarFantasma();
  }

  private refrescarFantasma(): void {
    if (!this.fantasma || !this.seleccionado) return;
    const [w, h] = huellaRotada(this.seleccionado.huella, this.rot);
    const altura = ALTURA_CATEGORIA[this.seleccionado.categoria];
    this.fantasma.position.set(this.casillaX + w / 2, altura / 2, this.casillaY + h / 2);
    this.fantasma.visible = this.punteroValido;

    this.ultimaValidez = this.validar(this.casillaX, this.casillaY);
    // el veredicto tiñe la caja hacia verde/rojo SIN perder del todo el
    // colorDebug: se lee a la vez QUÉ colocas y si puedes hacerlo aquí
    const material = this.fantasma.material as THREE.MeshStandardMaterial;
    material.color
      .set(this.seleccionado.colorDebug)
      .lerp(new THREE.Color(this.ultimaValidez.ok ? COLOR_FANTASMA_OK : COLOR_FANTASMA_MAL), 0.6);
    this.refrescarInfo();
  }

  private quitarFantasma(): void {
    if (!this.fantasma) return;
    this.opciones.escena.quitarEstatico(this.fantasma);
    this.fantasma.geometry.dispose();
    (this.fantasma.material as THREE.Material).dispose();
    this.fantasma = null;
  }

  // ------------------------------------------------------------------ bordes

  /** Bordes de TODAS las parcelas, solo visibles dentro del modo: propia verde, ajena gris. */
  private refrescarBordes(): void {
    this.quitarBordes();
    const { parcelas, escena, nombreJugador } = this.opciones;
    if (!parcelas) return;
    this.bordes = new THREE.Group();
    for (const [id, parcela] of Object.entries(parcelas.parcelas)) {
      const propia = this.duenos[id]?.dueno === nombreJugador;
      this.bordes.add(crearBordesParcela(parcela, propia ? COLOR_PARCELA_PROPIA : COLOR_PARCELA_AJENA));
    }
    escena.añadirEstatico(this.bordes);
  }

  private quitarBordes(): void {
    if (!this.bordes) return;
    this.opciones.escena.quitarEstatico(this.bordes);
    for (const linea of this.bordes.children as THREE.LineSegments[]) {
      linea.geometry.dispose();
      (linea.material as THREE.Material).dispose();
    }
    this.bordes = null;
  }

  // ------------------------------------------------------------------- panel

  private refrescarInfo(): void {
    const { parcelas } = this.opciones;
    const pid = this.ultimaValidez.parcelaId;
    if (!pid || !parcelas) {
      this.lineaInfo.textContent = this.ultimaValidez.motivo || "Fuera de parcela";
      return;
    }
    const p = parcelas.parcelas[pid];
    const usados = this.opciones.render.contarPorPropiedad(pid);
    const dueno = this.duenos[pid]?.dueno || "jarl";
    const estado = this.ultimaValidez.ok ? "✓" : `✗ ${this.ultimaValidez.motivo}`;
    this.lineaInfo.textContent = `${p.nombre} (${dueno}) · props ${usados}/${p.topeProps} · ${estado}`;
  }

  private avisoBreve(texto: string): void {
    // panel visible solo el tiempo del aviso (no se está en el modo)
    this.panel.style.display = "block";
    this.lineaInfo.textContent = texto;
    if (this.temporizadorAviso) clearTimeout(this.temporizadorAviso);
    this.temporizadorAviso = setTimeout(() => {
      if (!this._activo) this.panel.style.display = "none";
    }, 2500);
  }

  private crearPanel(): { panel: HTMLDivElement; lineaInfo: HTMLDivElement; lineaError: HTMLDivElement } {
    // estilos una sola vez (varias instancias no duplican la hoja)
    if (!document.getElementById("estilos-construccion")) {
      const estilos = document.createElement("style");
      estilos.id = "estilos-construccion";
      estilos.textContent = `
        .panel-construccion{position:absolute;top:12px;right:12px;width:260px;max-height:calc(100vh - 40px);
          overflow-y:auto;background:rgba(17,21,28,0.92);color:#e2e8f0;font:12px/1.4 sans-serif;
          border:1px solid #2d3748;border-radius:6px;padding:10px;z-index:10;display:none}
        .panel-construccion h3{margin:0 0 6px;font-size:13px;letter-spacing:.5px}
        .panel-construccion h4{margin:10px 0 4px;font-size:11px;text-transform:uppercase;color:#a0aec0}
        .panel-construccion .info{min-height:16px;color:#cbd5e0;border-bottom:1px solid #2d3748;padding-bottom:6px}
        .panel-construccion .error{display:none;color:#feb2b2;background:rgba(120,30,30,.35);
          border:1px solid #9b2c2c;border-radius:4px;padding:4px 6px;margin-top:6px}
        .panel-construccion button{display:flex;align-items:center;gap:6px;width:100%;text-align:left;
          background:transparent;border:1px solid transparent;border-radius:4px;color:#e2e8f0;
          font:11px sans-serif;padding:3px 5px;cursor:pointer}
        .panel-construccion button:hover{background:#2d3748}
        .panel-construccion button.sel{border-color:#48bb78;background:#22543d}
        .panel-construccion .sw{width:12px;height:12px;border-radius:2px;flex:none;border:1px solid rgba(255,255,255,.25)}
        .panel-construccion .hu{margin-left:auto;color:#718096}`;
      document.head.appendChild(estilos);
    }

    const panel = document.createElement("div");
    panel.className = "panel-construccion";

    const titulo = document.createElement("h3");
    titulo.textContent = "Construcción · clic coloca · R rota · B/ESC salir";
    panel.appendChild(titulo);

    const lineaInfo = document.createElement("div");
    lineaInfo.className = "info";
    panel.appendChild(lineaInfo);

    const lineaError = document.createElement("div");
    lineaError.className = "error";
    panel.appendChild(lineaError);

    for (const [categoria, lista] of CONSTRUIBLES_POR_CATEGORIA) {
      const h = document.createElement("h4");
      h.textContent = `${categoria}s (${lista.length})`;
      panel.appendChild(h);
      for (const c of lista) {
        const boton = document.createElement("button");
        const sw = document.createElement("span");
        sw.className = "sw";
        sw.style.background = c.colorDebug;
        const nombre = document.createElement("span");
        nombre.textContent = c.id;
        const hu = document.createElement("span");
        hu.className = "hu";
        hu.textContent = `${c.huella[0]}×${c.huella[1]}`;
        boton.append(sw, nombre, hu);
        boton.addEventListener("click", () => this.seleccionar(c.id));
        this.botones.set(c.id, boton);
        panel.appendChild(boton);
      }
    }

    this.opciones.contenedor.appendChild(panel);
    return { panel, lineaInfo, lineaError };
  }
}
