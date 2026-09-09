/**
 * Lluvia/nieve como overlay 2D screen-space (docs/GDD_Clima.md, 2026-09-09,
 * pedido del streamer: "que las lluvias nieves y tal estén en capa por
 * encima del canvas"). Antes vivían en `climaVisual.ts` como geometría 3D
 * REAL (`THREE.LineSegments`/`THREE.Points`) sembrada dentro de un radio de
 * MUNDO alrededor de `objetivoCamara` — el problema era estructural, no
 * solo de magnitud: cuánto "radio de mundo" hace falta para cubrir el 100%
 * del frustum de una cámara ortográfica isométrica depende del aspect
 * ratio de la ventana, del ángulo isométrico fijo y del zoom, así que
 * cualquier radio fijo es una aproximación que puede volver a quedarse
 * corta (ya pasó una vez esta misma sesión, 13→20).
 *
 * Este canvas dibuja en coordenadas de PÍXEL DE PANTALLA (0..ancho,
 * 0..alto) — cubre el 100% del viewport por garantía estructural, nunca
 * por aproximación, sin relación con `objetivoCamara` ni con ningún radio
 * de mundo. Polvo (viento) y charcos (decoración de suelo) se quedan en 3D
 * en `climaVisual.ts`: no tienen el problema de cobertura de pantalla
 * completa (el polvo es ambiental de fondo, los charcos son geometría de
 * suelo con perspectiva real que un overlay 2D no puede dar).
 */

interface Gota {
  x: number;
  y: number;
  vel: number;
  largo: number;
}

interface Copo {
  x: number;
  y: number;
  vel: number;
  radio: number;
  fase: number;
  deriva: number;
}

// Densidades de referencia a 1000x700px — `resize()` las escala por área
// real de la ventana, así una pantalla pequeña no desperdicia partículas
// fuera de encuadre y una 4K no se queda corta.
const NUM_LLUVIA_PANTALLA = 260;
const NUM_NIEVE_PANTALLA = 160;
const DENSIDAD_REF = 1000 * 700;

function crearGotas(n: number, ancho: number, alto: number): Gota[] {
  const gotas: Gota[] = [];
  for (let i = 0; i < n; i++) {
    gotas.push({
      x: Math.random() * ancho,
      y: Math.random() * alto,
      vel: 480 + Math.random() * 220, // px/seg, cae rápido y recto
      largo: 10 + Math.random() * 6,
    });
  }
  return gotas;
}

function crearCopos(n: number, ancho: number, alto: number): Copo[] {
  const copos: Copo[] = [];
  for (let i = 0; i < n; i++) {
    copos.push({
      x: Math.random() * ancho,
      y: Math.random() * alto,
      vel: 45 + Math.random() * 35,
      radio: 1.5 + Math.random() * 2,
      fase: Math.random() * Math.PI * 2,
      deriva: 12 + Math.random() * 18,
    });
  }
  return copos;
}

export class EfectosClimaPantalla {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private gotas: Gota[] = [];
  private copos: Copo[] = [];
  private ancho = 0;
  private alto = 0;
  private dpr = 1;

  constructor(contenedor: HTMLElement, antesDe: Node) {
    Object.assign(this.canvas.style, {
      position: "absolute", top: "0", left: "0", right: "0", bottom: "0",
      pointerEvents: "none", display: "none",
    });
    // Mismo orden de apilamiento que `overlayClima`/`labelRenderer` ya
    // usaban (insertBefore, sin z-index explícito): entre la niebla (por
    // detrás) y las etiquetas de nombre/vida (por delante, siempre legibles
    // encima de la lluvia).
    contenedor.insertBefore(this.canvas, antesDe);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("climaPantalla: sin contexto 2D");
    this.ctx = ctx;
  }

  resize(ancho: number, alto: number): void {
    this.ancho = ancho;
    this.alto = alto;
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(ancho * this.dpr);
    this.canvas.height = Math.round(alto * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); // dibujar en px CSS, no en px físicos
    // Re-sembrar con la densidad correcta para el tamaño nuevo — evita
    // huecos al agrandar la ventana o desperdiciar partículas fuera de
    // encuadre al encogerla.
    const escala = (ancho * alto) / DENSIDAD_REF;
    this.gotas = crearGotas(Math.round(NUM_LLUVIA_PANTALLA * escala), ancho, alto);
    this.copos = crearCopos(Math.round(NUM_NIEVE_PANTALLA * escala), ancho, alto);
  }

  /** Avanza la caída y activa/desactiva según el tipo de clima — mismo `tipo` que ya lee `overlayClima`/`EfectosClima`, sin bucle de animación propio (se llama desde `WorldScene.actualizar`, una vez por frame). */
  actualizar(dt: number, tipo: string): void {
    const activo = tipo === "lluvia" || tipo === "nieve";
    this.canvas.style.display = activo ? "block" : "none"; // corta el trabajo entero cuando no aplica
    if (!activo || this.ancho === 0) return;
    this.ctx.clearRect(0, 0, this.ancho, this.alto);
    if (tipo === "lluvia") this.dibujarLluvia(dt);
    else this.dibujarNieve(dt);
  }

  private dibujarLluvia(dt: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(170,200,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); // UN solo path para TODAS las gotas — un único stroke()
    for (const g of this.gotas) {
      g.y += g.vel * dt;
      if (g.y - g.largo > this.alto) {
        g.y = -g.largo;
        g.x = Math.random() * this.ancho;
      }
      ctx.moveTo(g.x, g.y - g.largo);
      ctx.lineTo(g.x, g.y); // estría vertical, se lee mejor cayendo rápido que un punto
    }
    ctx.stroke();
  }

  private dibujarNieve(dt: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    for (const c of this.copos) {
      c.y += c.vel * dt;
      c.x += Math.sin(c.y * 0.02 + c.fase) * c.deriva * dt; // vaivén lateral, copo real
      if (c.y - c.radio > this.alto) {
        c.y = -c.radio;
        c.x = Math.random() * this.ancho;
      }
      ctx.moveTo(c.x + c.radio, c.y);
      ctx.arc(c.x, c.y, c.radio, 0, Math.PI * 2);
    }
    ctx.fill(); // un solo fill() para todos los copos
  }
}
