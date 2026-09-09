/**
 * Panel de cocina — PLACEHOLDER de testeo (docs/GDD_Cocina.md, mismo
 * criterio de placeholder que el resto de esta pasada). Se muestra solo
 * al acercarse a una hoguera o vasija; cambia de forma según cuál sea
 * (hoguera: un solo campo "cocinar tal cual"; vasija: añadir ingredientes
 * + botón preparar, con la lista actual de la vasija).
 *
 * Chrome migrado al marco compartido (`panelBase.ts`, pedido streamer
 * 2026-09-09: "TODA pantalla debe salir con esta estética").
 */
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto, type MarcoPanel } from "../ui/panelBase";

export interface IngredienteVista {
  itemId: string;
  cantidad: number;
}

export interface EstadoCocinaVista {
  esVasija: boolean;
  /** id libre desde cocina v2 (docs/GDD_Cocina.md) — cuenco/cazuela/olla/cuenco_grande/olla_grande/tinaja. */
  vasija?: string;
  capacidad?: number;
  hierveAgua?: boolean;
  ingredientes: IngredienteVista[];
  conAgua: boolean;
  hirviendo: boolean;
  segundosParaHervir: number;
}

/** Nombre legible del tipo de vasija para el título del panel — placeholder de testeo, sin traducción curada por id (cocina v2 puede añadir vasijas nuevas sin tocar este panel). */
function nombreVasija(vasija: string | undefined): string {
  if (!vasija) return "Vasija";
  return vasija.replace(/_/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Sesión interactiva del minijuego (docs/GDD_Cocina.md, pedido 2026-09-01:
 * "dale con minijuego cocina") — mismo shape que `SesionEstacion`
 * (estacionFuego.ts) que ya manda el servidor tal cual en `cocina:iniciado`/
 * `cocina:progreso`.
 */
export interface EstadoSesionCocinaVista {
  fase: string; // "TRABAJANDO" | "TERMINADO"
  temperatura: number;
  segundosEnVentana: number;
  segundosTotales: number;
}

export interface ConfigSesionCocinaVista {
  temperaturaObjetivoMin: number;
  temperaturaObjetivoMax: number;
  duracionMinimaSeg: number;
}

export interface ResultadoCocinaVista {
  nombre: string;
  cantidad: number;
  mezclaBonus: boolean;
  pureza?: number;
  enSuelo: boolean;
}

export interface OpcionesPanelCocina {
  contenedor: HTMLElement;
  cocinarSimple(construccionId: number, instanciaId: number): void;
  llenarAgua(construccionId: number, instanciaId: number): void;
  anadir(construccionId: number, instanciaId: number, cantidad: number): void;
  preparar(construccionId: number): void;
  avivar(construccionId: number): void;
  enfriar(construccionId: number): void;
  servir(construccionId: number): void;
  cancelarSesion(construccionId: number): void;
}

export class PanelCocina {
  private marco: MarcoPanel;
  private construccionId: number | null = null;
  private estado: EstadoCocinaVista | null = null;
  /** Cuenta atrás LOCAL mientras hierve el agua — evita tener que preguntarle al servidor cada segundo solo para refrescar un número (docs/GDD_Cocina.md). */
  private temporizadorHervor: ReturnType<typeof setInterval> | null = null;
  /** Sesión del minijuego en curso (docs/GDD_Cocina.md, pedido 2026-09-01) — presente = el panel muestra la sesión en vez del estado normal de la vasija, mismo criterio que panelForja.ts. */
  private sesionCfg: ConfigSesionCocinaVista | null = null;
  private sesion: EstadoSesionCocinaVista | null = null;
  private resultado: ResultadoCocinaVista | null = null;

  constructor(private opciones: OpcionesPanelCocina) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: "Cocina",
      icono: "🍲",
      // Este panel lo muestra/oculta la PROXIMIDAD a la hoguera/vasija
      // (game.ts, cada 500ms) — no un gesto del jugador. Si Escape/clic-
      // fuera lo cerraran mientras sigue de pie junto a la estación, el
      // siguiente mensaje del servidor (agua hirviendo, minijuego en
      // curso...) lo reabriría de golpe, dando sensación de panel que "no
      // se deja cerrar". Solo se cierra por `ocultar()`/la propia lógica
      // interna de proximidad, o el botón ✕ de la cabecera.
      cierraAlClicarFuera: false,
      cierraConEscape: false,
    });
    this.marco.raiz.style.right = "16px";
    this.marco.raiz.style.bottom = "180px";
    this.render();
  }

  /** construccionId=null cuando el jugador ya no está junto a ninguna estación de cocina. */
  actualizarCercania(construccionId: number | null, esVasija: boolean, vasija?: string, capacidad?: number, hierveAgua?: boolean) {
    this.construccionId = construccionId;
    this.estado = construccionId == null ? null : { esVasija, vasija, capacidad, hierveAgua, ingredientes: [], conAgua: false, hirviendo: false, segundosParaHervir: 0 };
    this.pararTemporizador();
    this.render();
  }

  /** Llamar al recibir "cocina:estado" (agua/hervor/ingredientes actuales de la vasija). */
  actualizarEstado(parcial: { ingredientes: IngredienteVista[]; conAgua: boolean; hirviendo: boolean; segundosParaHervir: number }) {
    if (!this.estado) return;
    this.estado = { ...this.estado, ...parcial };
    this.pararTemporizador();
    if (this.estado.conAgua && !this.estado.hirviendo && this.estado.segundosParaHervir > 0) {
      this.temporizadorHervor = setInterval(() => {
        if (!this.estado) return this.pararTemporizador();
        if (this.estado.segundosParaHervir <= 1) {
          this.estado = { ...this.estado, hirviendo: true, segundosParaHervir: 0 };
          this.pararTemporizador();
        } else {
          this.estado = { ...this.estado, segundosParaHervir: this.estado.segundosParaHervir - 1 };
        }
        this.render();
      }, 1000);
    }
    this.render();
  }

  private pararTemporizador() {
    if (this.temporizadorHervor != null) clearInterval(this.temporizadorHervor);
    this.temporizadorHervor = null;
  }

  /** Llamar al recibir "cocina:iniciado" — arranca el minijuego, sustituye la vista normal de la vasija. */
  mostrarSesion(cfg: ConfigSesionCocinaVista, sesion: EstadoSesionCocinaVista) {
    this.sesionCfg = cfg;
    this.sesion = sesion;
    this.resultado = null;
    this.pararTemporizador();
    this.render();
  }

  /** Llamar al recibir "cocina:progreso". */
  actualizarSesion(sesion: EstadoSesionCocinaVista) {
    if (!this.sesionCfg) return;
    this.sesion = sesion;
    this.render();
  }

  /** Llamar al recibir "cocina:preparado" — el resultado final, sustituye el minijuego hasta que el jugador cierre. */
  mostrarResultado(resultado: ResultadoCocinaVista) {
    this.sesionCfg = null;
    this.sesion = null;
    this.resultado = resultado;
    this.render();
  }

  /** Llamar al recibir "cocina:cancelado" — vuelve a la vista normal de la vasija. */
  ocultarSesion() {
    this.sesionCfg = null;
    this.sesion = null;
    this.resultado = null;
    this.render();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (this.resultado) {
      this.marco.abrir();
      this.renderResultado(this.resultado);
      return;
    }
    if (this.sesionCfg && this.sesion) {
      this.marco.abrir();
      this.renderSesion(this.sesionCfg, this.sesion);
      return;
    }
    if (this.construccionId == null || !this.estado) {
      this.marco.cerrar();
      return;
    }
    this.marco.abrir();
    const id = this.construccionId;
    const e = this.estado;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = e.esVasija ? `🍲 ${nombreVasija(e.vasija)}` : "🔥 Fuego";
    cuerpo.appendChild(titulo);

    if (!e.esVasija) {
      cuerpo.appendChild(crearLineaTexto("Cocina un ingrediente tal cual, sin combinar.", { tenue: true, fontSize: "11px" }));

      const fila = document.createElement("div");
      fila.style.display = "flex";
      fila.style.gap = "6px";
      const input = crearInput({ tipo: "number", placeholder: "id ingrediente" });
      input.style.width = "100px";
      fila.appendChild(input);
      const boton = crearBoton("Cocinar", () => {
        const iid = Number(input.value);
        if (Number.isFinite(iid) && iid > 0) this.opciones.cocinarSimple(id, iid);
        input.value = "";
      });
      fila.appendChild(boton);
      cuerpo.appendChild(fila);
      return;
    }

    cuerpo.appendChild(crearLineaTexto(`Hasta ${e.capacidad} ingredientes distintos — mezclar planta y carne da bonus.`, { tenue: true, fontSize: "11px" }));

    // Cocina v2 (docs/GDD_Cocina.md): cuenco_barro_grande (sartén) y
    // tinaja_batidos no necesitan agua ni hervor — directo a añadir.
    if (e.hierveAgua !== false) {
      if (!e.conAgua) {
        // Líquidos (docs/GDD_Inventario.md §9, pedido 2026-08-30): ya no es
        // agua gratis — hay que meter un recipiente (cantimplora/cubo) CON
        // agua, se vacía entero como ingrediente. Placeholder de testeo:
        // input con el id de instancia a mano, mismo criterio que el resto.
        const filaAgua = document.createElement("div");
        filaAgua.style.display = "flex";
        filaAgua.style.gap = "6px";
        filaAgua.style.marginBottom = "6px";
        const inputRecipiente = crearInput({ tipo: "number", placeholder: "id recipiente con agua" });
        inputRecipiente.style.width = "150px";
        filaAgua.appendChild(inputRecipiente);
        const llenar = crearBoton("💧 Meter agua y poner al fuego", () => {
          const iid = Number(inputRecipiente.value);
          if (Number.isFinite(iid) && iid > 0) this.opciones.llenarAgua(id, iid);
          inputRecipiente.value = "";
        });
        filaAgua.appendChild(llenar);
        cuerpo.appendChild(filaAgua);
        return;
      }
      if (!e.hirviendo) {
        const esperando = document.createElement("div");
        esperando.style.marginBottom = "6px";
        esperando.textContent = `🔥 Calentando... ${e.segundosParaHervir}s`;
        cuerpo.appendChild(esperando);
        return;
      }
    }

    if (e.ingredientes.length === 0) {
      cuerpo.appendChild(crearLineaTexto("(vacía)", { tenue: true }));
    } else {
      for (const ing of e.ingredientes) {
        cuerpo.appendChild(crearLineaTexto(`${ing.itemId} x${ing.cantidad}`));
      }
    }

    const filaAnadir = document.createElement("div");
    filaAnadir.style.display = "flex";
    filaAnadir.style.gap = "6px";
    filaAnadir.style.margin = "8px 0";
    const inputId = crearInput({ tipo: "number", placeholder: "id ingrediente" });
    inputId.style.width = "90px";
    const inputCantidad = crearInput({ tipo: "number", placeholder: "cantidad" });
    inputCantidad.style.width = "70px";
    filaAnadir.appendChild(inputId);
    filaAnadir.appendChild(inputCantidad);
    const botonAnadir = crearBoton("Añadir", () => {
      const iid = Number(inputId.value);
      const cantidad = Number(inputCantidad.value) || 1;
      if (Number.isFinite(iid) && iid > 0) this.opciones.anadir(id, iid, cantidad);
      inputId.value = "";
      inputCantidad.value = "";
    });
    filaAnadir.appendChild(botonAnadir);
    cuerpo.appendChild(filaAnadir);

    const preparar = crearBoton("Preparar plato (arranca el minijuego)", () => this.opciones.preparar(id));
    preparar.disabled = e.ingredientes.length === 0;
    cuerpo.appendChild(preparar);
  }

  /** Minijuego real-time (docs/GDD_Cocina.md, pedido 2026-09-01) — mismo criterio de placeholder que el resto del panel: texto plano, sin barras ni escena, solo lo justo para poder JUGAR y comprobar el protocolo. */
  private renderSesion(cfg: ConfigSesionCocinaVista, sesion: EstadoSesionCocinaVista) {
    const cuerpo = this.marco.cuerpo;
    const id = this.construccionId!;

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "🔥 Cocinando";
    cuerpo.appendChild(titulo);

    const temp = document.createElement("div");
    temp.textContent = `Temperatura: ${Math.round(sesion.temperatura)}° (ventana ${cfg.temperaturaObjetivoMin}–${cfg.temperaturaObjetivoMax}°)`;
    cuerpo.appendChild(temp);

    const enVentana = sesion.temperatura >= cfg.temperaturaObjetivoMin && sesion.temperatura <= cfg.temperaturaObjetivoMax;
    const estadoDiv = document.createElement("div");
    estadoDiv.style.marginBottom = "6px";
    estadoDiv.style.color = enVentana ? "#7ec850" : "#d9a63a";
    estadoDiv.textContent = enVentana ? "✓ dentro de la ventana" : "fuera de la ventana";
    cuerpo.appendChild(estadoDiv);

    const tiempo = document.createElement("div");
    tiempo.style.marginBottom = "8px";
    tiempo.style.opacity = "0.8";
    tiempo.textContent = `Tiempo: ${sesion.segundosTotales.toFixed(1)}s / mínimo ${cfg.duracionMinimaSeg}s — ${sesion.segundosEnVentana.toFixed(1)}s dentro de ventana`;
    cuerpo.appendChild(tiempo);

    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "6px";
    botones.appendChild(crearBoton("🔥 Avivar", () => this.opciones.avivar(id)));
    botones.appendChild(crearBoton("💧 Enfriar", () => this.opciones.enfriar(id)));
    const servir = crearBoton("🍽 Servir", () => this.opciones.servir(id));
    servir.disabled = sesion.segundosTotales < cfg.duracionMinimaSeg;
    botones.appendChild(servir);
    botones.appendChild(crearBoton("✕ Cancelar", () => this.opciones.cancelarSesion(id)));
    cuerpo.appendChild(botones);
  }

  private renderResultado(resultado: ResultadoCocinaVista) {
    const cuerpo = this.marco.cuerpo;
    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = "✅ Plato servido";
    cuerpo.appendChild(titulo);

    const detalle = document.createElement("div");
    detalle.textContent = `${resultado.cantidad}× ${resultado.nombre}${resultado.mezclaBonus ? " (bonus de mezcla)" : ""}`;
    cuerpo.appendChild(detalle);

    if (resultado.pureza != null) {
      const pureza = document.createElement("div");
      pureza.style.opacity = "0.8";
      pureza.textContent = `Pureza del fuego: ${Math.round(resultado.pureza * 100)}%`;
      cuerpo.appendChild(pureza);
    }
    if (resultado.enSuelo) {
      const aviso = document.createElement("div");
      aviso.style.color = "#d9a63a";
      aviso.textContent = "Sin hueco en el inventario — cayó al suelo";
      cuerpo.appendChild(aviso);
    }

    const cerrar = crearBoton("Cerrar", () => this.ocultarSesion());
    cerrar.style.marginTop = "8px";
    cuerpo.appendChild(cerrar);
  }
}
