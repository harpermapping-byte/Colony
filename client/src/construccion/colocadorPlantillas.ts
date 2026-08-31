/**
 * Colocador de plantillas del jarl (docs/GDD_Produccion.md, pedido
 * 2026-08-29; generalizado 2026-08-31 a los proyectos especiales — ver
 * docs/GDD_Ciudad_Capital.md §5ter y `validarColocacionPlantilla` en
 * construccion.ts): MISMO estilo de UX que `ModoConstruccion` (fantasma
 * verde/rojo con snap a casilla, R rota, clic coloca) — pedido literal:
 * "el admin o superadmin tendrá el mismo tipo de colocador que el de las
 * construcciones o amueblamiento de los jugadores". La diferencia con
 * ModoConstruccion es la validación: aquí no hay parcela propia, el jarl
 * coloca "donde quiera" dentro de un radio a la capital.
 *
 * Solo se activa desde game.ts si el jugador local es jarl de este mapa o
 * superadmin (mismo gate que PanelJarl) — un jugador normal ni siquiera
 * tiene la tecla conectada.
 *
 * Validación LOCAL (solo feedback instantáneo — la verdad final es siempre
 * del servidor, que puede rechazar con "plantilla:error"):
 * - dentro del radio a la capital (mismo punto de referencia y radio que
 *   RoomExteriorBase.ts, ver `RADIO_PLANTILLAS_JARL_CASILLAS_CLIENTE`).
 * - casilla libre (`RenderConstrucciones.ocupada`, ya alimentado por
 *   "construccion:nueva"/"construcciones:lista" para TODO lo construido,
 *   plantillas incluidas).
 * - `plantillaJarl` (aserradero...): la huella NO puede tocar ninguna
 *   parcela existente ("nunca pisa terreno de jugador").
 * - `proyectoJarl` (proyecto especial): puede pisar parcela libremente,
 *   pero solo puede existir UNO de cada tipo por asentamiento
 *   (`RenderConstrucciones.existeObjeto`).
 *
 * A propósito NO valida tipo de terreno (tierra/agua) — mismo criterio que
 * ModoConstruccion: eso lo decide el servidor, que ya lo conoce con certeza.
 */
import * as THREE from "three";
import type { WorldScene } from "../render3d/worldScene";
import { PLANTILLAS_JARL, ALTURA_CATEGORIA, huellaRotada, type Construible } from "./catalogoConstruccion";
import type { RenderConstrucciones } from "./renderConstrucciones";

/** Payload del mensaje "plantilla:colocar" (RoomExteriorBase.ts). */
export interface MensajePlantillaColocar {
  tipoEdificioId: string;
  x: number;
  y: number;
  rot: number;
}

export interface OpcionesColocadorPlantillas {
  contenedor: HTMLElement;
  escena: WorldScene;
  anchoMapa: number;
  /** casilla (y*anchoMapa+x) → parcelaId — MISMO índice que ModoConstruccion, solo para el veto de plantillaJarl. */
  indiceParcelas: Map<number, string>;
  render: RenderConstrucciones;
  /** Punto de referencia de la capital, en casillas — mismo criterio que `MapaCargado.spawnX/Y` del servidor (indice.ciudad, o el centro del mapa). */
  capital: { x: number; y: number };
  radioMax: number;
  enviarColocar(mensaje: MensajePlantillaColocar): void;
}

const COLOR_FANTASMA_OK = 0x3ddc78;
const COLOR_FANTASMA_MAL = 0xe74c3c;
const MS_ERROR = 3000;

interface Validez {
  ok: boolean;
  motivo: string;
}

export class ColocadorPlantillas {
  private _activo = false;
  private seleccionado: Construible | null = null;
  private rot = 0;
  private casillaX = 0;
  private casillaY = 0;
  private punteroValido = false;
  private ultimaValidez: Validez = { ok: false, motivo: "" };

  private fantasma: THREE.Mesh | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly planoSuelo = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly puntoRay = new THREE.Vector3();

  private readonly panel: HTMLDivElement;
  private readonly lineaInfo: HTMLDivElement;
  private readonly lineaError: HTMLDivElement;
  private readonly botones = new Map<string, HTMLButtonElement>();
  private temporizadorError: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opciones: OpcionesColocadorPlantillas) {
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

  alternar(): void {
    if (this._activo) this.desactivar();
    else this.activar();
  }

  activar(): void {
    if (this._activo) return;
    this._activo = true;
    this.panel.style.display = "block";
    this.lineaInfo.textContent = "Elige una plantilla y apunta.";
  }

  desactivar(): void {
    if (!this._activo) return;
    this._activo = false;
    this.panel.style.display = "none";
    this.seleccionar(null);
  }

  seleccionar(id: string | null): void {
    for (const [bid, boton] of this.botones) boton.classList.toggle("sel", bid === id);
    if (id === null) {
      this.seleccionado = null;
      this.quitarFantasma();
      return;
    }
    const c = PLANTILLAS_JARL.find((x) => x.id === id);
    if (c) {
      this.seleccionado = c;
      this.rot = 0;
      this.reconstruirFantasma();
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

  /** Envía "plantilla:colocar" con lo seleccionado en una casilla concreta. */
  colocarEn(x: number, y: number): boolean {
    if (!this.seleccionado) return false;
    this.opciones.enviarColocar({ tipoEdificioId: this.seleccionado.id, x, y, rot: this.rot });
    return true;
  }

  /** "plantilla:error" del servidor: motivo visible unos segundos. */
  mostrarError(motivo: string): void {
    this.lineaError.textContent = motivo || "El servidor rechazó la colocación.";
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

  private validar(cx: number, cy: number): Validez {
    if (!this.seleccionado) return { ok: false, motivo: "" };
    const { indiceParcelas, anchoMapa, render, capital, radioMax } = this.opciones;
    const [w, h] = huellaRotada(this.seleccionado.huella, this.rot);
    const esProyectoEspecial = !!this.seleccionado.proyectoJarl;

    const centroX = cx + w / 2;
    const centroY = cy + h / 2;
    if (Math.hypot(centroX - capital.x, centroY - capital.y) > radioMax) {
      return { ok: false, motivo: "Fuera del radio de la capital" };
    }

    if (esProyectoEspecial && render.existeObjeto(this.seleccionado.id)) {
      return { ok: false, motivo: "Ya existe un proyecto especial de este tipo" };
    }

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (!esProyectoEspecial && indiceParcelas.get(y * anchoMapa + x) !== undefined) {
          return { ok: false, motivo: "Hay una parcela ahí — fuera de las parcelas" };
        }
        if (render.ocupada(x, y)) return { ok: false, motivo: "Casilla ocupada" };
      }
    }

    return { ok: true, motivo: "" };
  }

  // ---------------------------------------------------------------- fantasma

  private reconstruirFantasma(): void {
    this.quitarFantasma();
    if (!this.seleccionado) return;
    const [w, h] = huellaRotada(this.seleccionado.huella, this.rot);
    const altura = ALTURA_CATEGORIA[this.seleccionado.categoria];
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

  // ------------------------------------------------------------------- panel

  private refrescarInfo(): void {
    if (!this.seleccionado) return;
    const nombre = this.seleccionado.nombre ?? this.seleccionado.id;
    const estado = this.ultimaValidez.ok ? "✓" : `✗ ${this.ultimaValidez.motivo}`;
    this.lineaInfo.textContent = `${nombre} · ${estado}`;
  }

  private crearPanel(): { panel: HTMLDivElement; lineaInfo: HTMLDivElement; lineaError: HTMLDivElement } {
    if (!document.getElementById("estilos-plantillas")) {
      const estilos = document.createElement("style");
      estilos.id = "estilos-plantillas";
      estilos.textContent = `
        .panel-plantillas{position:absolute;top:12px;left:12px;width:260px;max-height:calc(100vh - 40px);
          overflow-y:auto;background:rgba(28,20,10,0.92);color:#f0e8d8;font:12px/1.4 sans-serif;
          border:1px solid #8a6a2a;border-radius:6px;padding:10px;z-index:10;display:none}
        .panel-plantillas h3{margin:0 0 6px;font-size:13px;letter-spacing:.5px}
        .panel-plantillas .info{min-height:16px;color:#e2d8c0;border-bottom:1px solid #8a6a2a;padding-bottom:6px}
        .panel-plantillas .error{display:none;color:#feb2b2;background:rgba(120,30,30,.35);
          border:1px solid #9b2c2c;border-radius:4px;padding:4px 6px;margin-top:6px}
        .panel-plantillas button{display:flex;align-items:center;gap:6px;width:100%;text-align:left;
          background:transparent;border:1px solid transparent;border-radius:4px;color:#f0e8d8;
          font:11px sans-serif;padding:3px 5px;cursor:pointer}
        .panel-plantillas button:hover{background:#3a2e18}
        .panel-plantillas button.sel{border-color:#3ddc78;background:#22543d}
        .panel-plantillas .sw{width:12px;height:12px;border-radius:2px;flex:none;border:1px solid rgba(255,255,255,.25)}
        .panel-plantillas .hu{margin-left:auto;color:#c8b890}`;
      document.head.appendChild(estilos);
    }

    const panel = document.createElement("div");
    panel.className = "panel-plantillas";

    const titulo = document.createElement("h3");
    titulo.textContent = "👑 Plantillas del jarl · clic coloca · R rota · Z/ESC salir";
    panel.appendChild(titulo);

    const lineaInfo = document.createElement("div");
    lineaInfo.className = "info";
    panel.appendChild(lineaInfo);

    const lineaError = document.createElement("div");
    lineaError.className = "error";
    panel.appendChild(lineaError);

    for (const c of PLANTILLAS_JARL) {
      const boton = document.createElement("button");
      const sw = document.createElement("span");
      sw.className = "sw";
      sw.style.background = c.colorDebug;
      const nombre = document.createElement("span");
      nombre.textContent = c.nombre ?? c.id;
      const hu = document.createElement("span");
      hu.className = "hu";
      hu.textContent = `${c.huella[0]}×${c.huella[1]}${c.proyectoJarl ? " · especial" : " · producción"}`;
      boton.append(sw, nombre, hu);
      boton.addEventListener("click", () => this.seleccionar(c.id));
      this.botones.set(c.id, boton);
      panel.appendChild(boton);
    }

    this.opciones.contenedor.appendChild(panel);
    return { panel, lineaInfo, lineaError };
  }
}
