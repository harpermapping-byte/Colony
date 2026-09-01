/**
 * Panel del minijuego de forja — PLACEHOLDER de testeo (docs/GDD_Crafteo.md
 * §Minijuego de Herrería, mismo criterio que panelCombate.ts: "placeholder
 * sencillas... al final del proyecto se hará toda la UI"). Sin escena 3D de
 * yunque/martillo — solo texto, barras y botones para poder JUGAR el
 * minijuego y comprobar que el protocolo funciona.
 *
 * DOM plano inyectado sobre el canvas, mismo patrón que panelCombate.ts —
 * nada de framework. Puramente reactivo a mensajes (crafteo:herreria:*): a
 * diferencia de panelCombate (Schema replicado, `combates`), una forja es
 * efímera y por sesión — no hay estado que leer salvo lo que ya trae cada
 * mensaje.
 */

export interface SesionForjaVista {
  recetaId: string;
  fase: string; // "CALENTAR" | "FORJAR" | "TEMPLAR" | "TERMINADO"
  temperatura: number;
  combustible: number;
  golpes: number;
  golpesPerfectos: number;
  golpesBuenos: number;
  golpesMalos: number;
  calidad: number;
  cursor: number; // 0..1
}

export interface ConfigForjaVista {
  golpesObjetivo: number;
  combustibleMax: number;
  temperaturaMinimaForja: number;
  temperaturaOptimaMin: number;
  temperaturaOptimaMax: number;
  temperaturaSobrecalentado: number;
}

export interface ResultadoForjaVista {
  itemId: string;
  cantidad: number;
  estrellas: number;
  perfecta: boolean;
  enSuelo: boolean;
}

export interface OpcionesPanelForja {
  contenedor: HTMLElement;
  enviarAvivar(): void;
  enviarGolpear(): void;
  enviarTemplar(): void;
  enviarCancelar(): void;
}

const FASE_TEXTO: Record<string, string> = {
  CALENTAR: "🔥 Calentando el metal",
  FORJAR: "🔨 Forjando en el yunque",
  TEMPLAR: "💧 Templando la hoja",
  TERMINADO: "✅ Terminado",
};

function estrellas(calidad: number): string {
  const n = Math.max(1, Math.min(5, Math.round(calidad * 5)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

export class PanelForja {
  private raiz: HTMLDivElement;
  private cfg: ConfigForjaVista | null = null;

  constructor(private opciones: OpcionesPanelForja) {
    this.raiz = document.createElement("div");
    Object.assign(this.raiz.style, {
      position: "absolute", left: "50%", top: "104px", transform: "translateX(-50%)",
      background: "rgba(24,18,12,0.92)", color: "#f0e8d8", font: "13px sans-serif",
      padding: "12px 16px", borderRadius: "8px", border: "1px solid #8a5a2a",
      display: "none", width: "320px", boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
    } as CSSStyleDeclaration);
    opciones.contenedor.appendChild(this.raiz);
  }

  mostrarSesion(cfg: ConfigForjaVista, sesion: SesionForjaVista) {
    this.cfg = cfg;
    this.raiz.style.display = "block";
    this.renderizarSesion(sesion);
  }

  actualizarSesion(sesion: SesionForjaVista) {
    if (this.raiz.style.display === "none") return;
    this.renderizarSesion(sesion);
  }

  mostrarResultado(resultado: ResultadoForjaVista) {
    this.raiz.style.display = "block";
    this.renderizarResultado(resultado);
  }

  ocultar() {
    this.raiz.style.display = "none";
    this.cfg = null;
  }

  private barra(pct: number, color: string, alto = "14px"): HTMLDivElement {
    const fondo = document.createElement("div");
    Object.assign(fondo.style, {
      position: "relative", height: alto, background: "rgba(255,255,255,0.12)",
      borderRadius: "4px", overflow: "hidden", margin: "3px 0 8px",
    } as CSSStyleDeclaration);
    const relleno = document.createElement("div");
    Object.assign(relleno.style, {
      position: "absolute", left: "0", top: "0", bottom: "0",
      width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width 0.15s linear",
    } as CSSStyleDeclaration);
    fondo.appendChild(relleno);
    return fondo;
  }

  private renderizarSesion(sesion: SesionForjaVista) {
    const cfg = this.cfg!;
    this.raiz.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "8px";
    titulo.textContent = `⚒ ${FASE_TEXTO[sesion.fase] ?? sesion.fase} — ${sesion.recetaId}`;
    this.raiz.appendChild(titulo);

    // Temperatura: barra con marcas de la ventana óptima (verde) superpuestas.
    const etiquetaTemp = document.createElement("div");
    etiquetaTemp.textContent = `🌡 Temperatura: ${Math.round(sesion.temperatura)}° (óptima ${cfg.temperaturaOptimaMin}–${cfg.temperaturaOptimaMax}°)`;
    this.raiz.appendChild(etiquetaTemp);
    const enOptima = sesion.temperatura >= cfg.temperaturaOptimaMin && sesion.temperatura <= cfg.temperaturaOptimaMax;
    const colorTemp = sesion.temperatura > cfg.temperaturaSobrecalentado ? "#c94a3a" : enOptima ? "#7ec850" : sesion.temperatura < cfg.temperaturaMinimaForja ? "#5a8ac9" : "#d9a63a";
    const barraTemp = this.barra((sesion.temperatura / 100) * 100, colorTemp);
    const zonaOptima = document.createElement("div");
    Object.assign(zonaOptima.style, {
      position: "absolute", top: "0", bottom: "0",
      left: `${cfg.temperaturaOptimaMin}%`, width: `${cfg.temperaturaOptimaMax - cfg.temperaturaOptimaMin}%`,
      border: "1px dashed rgba(255,255,255,0.6)", boxSizing: "border-box",
    } as CSSStyleDeclaration);
    barraTemp.appendChild(zonaOptima);
    this.raiz.appendChild(barraTemp);

    // Combustible.
    const etiquetaFuel = document.createElement("div");
    etiquetaFuel.textContent = `🪵 Combustible: ${sesion.combustible}/${cfg.combustibleMax}`;
    this.raiz.appendChild(etiquetaFuel);
    this.raiz.appendChild(this.barra((sesion.combustible / cfg.combustibleMax) * 100, "#b0783a", "8px"));

    // Ritmo (solo relevante en FORJAR) — aguja que el SERVIDOR simula; la
    // zona sombreada es orientativa (la ventana real de "perfecto" se
    // estrecha con el progreso, ver herreria.ts).
    if (sesion.fase === "FORJAR") {
      const etiquetaRitmo = document.createElement("div");
      etiquetaRitmo.textContent = "🎯 Ritmo — golpea con la aguja centrada";
      this.raiz.appendChild(etiquetaRitmo);
      const barraRitmo = this.barra(0, "transparent", "18px");
      const zonaPerfecta = document.createElement("div");
      Object.assign(zonaPerfecta.style, {
        position: "absolute", top: "0", bottom: "0", left: "37%", width: "26%",
        background: "rgba(126,200,80,0.45)",
      } as CSSStyleDeclaration);
      barraRitmo.appendChild(zonaPerfecta);
      const aguja = document.createElement("div");
      Object.assign(aguja.style, {
        position: "absolute", top: "-3px", bottom: "-3px", left: `${sesion.cursor * 100}%`,
        width: "3px", marginLeft: "-1.5px", background: "#f0e8d8", boxShadow: "0 0 4px #fff",
      } as CSSStyleDeclaration);
      barraRitmo.appendChild(aguja);
      this.raiz.appendChild(barraRitmo);
    }

    // Golpes + calidad.
    const golpesDiv = document.createElement("div");
    golpesDiv.style.marginBottom = "4px";
    golpesDiv.textContent = `🔨 Golpes: ${sesion.golpes}/${cfg.golpesObjetivo} (✓${sesion.golpesPerfectos} perfectos, ✓${sesion.golpesBuenos} buenos, ✗${sesion.golpesMalos} malos)`;
    this.raiz.appendChild(golpesDiv);
    const calidadDiv = document.createElement("div");
    calidadDiv.style.marginBottom = "8px";
    calidadDiv.textContent = `Calidad: ${estrellas(sesion.calidad)}`;
    this.raiz.appendChild(calidadDiv);

    // Botones contextuales a la fase.
    const botones = document.createElement("div");
    botones.style.display = "flex";
    botones.style.gap = "8px";
    if (sesion.fase === "CALENTAR" || sesion.fase === "FORJAR") {
      const avivar = document.createElement("button");
      avivar.textContent = "🔥 Avivar";
      avivar.disabled = sesion.combustible <= 0;
      avivar.onclick = () => this.opciones.enviarAvivar();
      botones.appendChild(avivar);
    }
    if (sesion.fase === "FORJAR") {
      const golpear = document.createElement("button");
      golpear.textContent = "🔨 Golpear (ESPACIO)";
      golpear.onclick = () => this.opciones.enviarGolpear();
      botones.appendChild(golpear);
    }
    if (sesion.fase === "TEMPLAR") {
      const templarBtn = document.createElement("button");
      templarBtn.textContent = "💧 Templar";
      templarBtn.onclick = () => this.opciones.enviarTemplar();
      botones.appendChild(templarBtn);
    }
    const cancelar = document.createElement("button");
    cancelar.textContent = "✕ Cancelar";
    cancelar.onclick = () => this.opciones.enviarCancelar();
    botones.appendChild(cancelar);
    this.raiz.appendChild(botones);
  }

  private renderizarResultado(resultado: ResultadoForjaVista) {
    this.raiz.innerHTML = "";
    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "6px";
    titulo.textContent = resultado.perfecta ? "✨ ¡FORJA PERFECTA!" : "✅ Forja terminada";
    this.raiz.appendChild(titulo);

    const detalle = document.createElement("div");
    detalle.style.marginBottom = "4px";
    detalle.textContent = `${estrellas(resultado.estrellas / 5)} — ${resultado.cantidad}× ${resultado.itemId}`;
    this.raiz.appendChild(detalle);

    if (resultado.perfecta) {
      const bonus = document.createElement("div");
      bonus.style.color = "#7ec850";
      bonus.textContent = "Objeto bonificado (+25% ataque/defensa)";
      this.raiz.appendChild(bonus);
    }
    if (resultado.enSuelo) {
      const aviso = document.createElement("div");
      aviso.style.color = "#d9a63a";
      aviso.textContent = "Sin hueco en el inventario — cayó al suelo";
      this.raiz.appendChild(aviso);
    }

    const cerrar = document.createElement("button");
    cerrar.textContent = "Cerrar";
    cerrar.style.marginTop = "8px";
    cerrar.onclick = () => this.ocultar();
    this.raiz.appendChild(cerrar);
  }
}
