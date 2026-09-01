/**
 * Visor/escritor de libros (docs/GDD_Libreria.md, pedido 2026-09-01) —
 * "ventanita como los minijuegos donde veas el libro, lo abras con clic y
 * pases páginas con clic también a izquierda o derecha". Mismo patrón DOM
 * flotante que el resto de paneles de esta familia (`panelCofre.ts`,
 * `panelReclutador.ts`).
 *
 * Dos fuentes de texto, según el libro:
 * - Catálogo (oficio/mecánica/lore, texto FIJO): se resuelve entero en el
 *   cliente desde `items/catalogo/librosContenido.json` — nunca hace falta
 *   preguntarle nada al servidor para leer un libro de catálogo.
 * - Escrito por un jugador (`libro_en_blanco_jugador` con `libroGeneradoId`
 *   > 0): el texto vive en `libros_generados` (bd.ts) — se pide con
 *   `libro:leerGenerado` y se rellena cuando llega la respuesta.
 *
 * El propio `libro_en_blanco_jugador` SIN escribir (`libroGeneradoId === 0`)
 * abre directo en modo escritura: título + páginas separadas por una línea
 * "---" en un único textarea (mismo criterio "placeholder pulido, no un
 * editor de páginas de verdad" que el resto de paneles de esta pasada).
 */
import librosContenidoJson from "../../../items/catalogo/librosContenido.json";

interface EntradaLibroContenido {
  titulo: string;
  categoria: "oficio" | "mecanica" | "lore";
  oficio?: string;
  paginas: string[];
}
const LIBROS_CONTENIDO = librosContenidoJson as unknown as Record<string, EntradaLibroContenido>;

const ID_LIBRO_EN_BLANCO_JUGADOR = "libro_en_blanco_jugador";
const SEPARADOR_PAGINAS = "\n---\n";

type Objetivo =
  | { modo: "catalogo"; titulo: string; paginas: string[] }
  | { modo: "cargandoGenerado"; instanciaId: number; libroGeneradoId: number }
  | { modo: "leerGenerado"; instanciaId: number; libroGeneradoId: number; titulo: string; paginas: string[] }
  | { modo: "escribir"; instanciaId: number; libroGeneradoId: number | null; tituloInicial: string; paginasInicial: string[] };

export interface OpcionesPanelLibro {
  contenedor: HTMLElement;
  escribir(instanciaId: number, titulo: string, paginas: string[]): void;
  pedirLeerGenerado(libroGeneradoId: number): void;
}

const COLOR_FONDO = "rgba(24,18,10,0.96)";
const COLOR_BORDE = "#8a6a2a";
const COLOR_TEXTO = "#f0e4c8";

export class PanelLibro {
  private raiz: HTMLDivElement;
  private objetivo: Objetivo | null = null;
  private pagina = 0;
  private ultimoError = "";

  constructor(private opciones: OpcionesPanelLibro) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "50%";
    this.raiz.style.top = "50%";
    this.raiz.style.transform = "translate(-50%, -50%)";
    this.raiz.style.background = COLOR_FONDO;
    this.raiz.style.color = COLOR_TEXTO;
    this.raiz.style.font = "13px serif";
    this.raiz.style.padding = "14px 18px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = `1px solid ${COLOR_BORDE}`;
    this.raiz.style.width = "380px";
    this.raiz.style.maxHeight = "70vh";
    this.raiz.style.overflowY = "auto";
    this.raiz.style.display = "none";
    opciones.contenedor.appendChild(this.raiz);
  }

  /** Abre un libro por su itemId+instancia — decide solo si es de catálogo (texto fijo) o un libro_en_blanco_jugador (leído o para escribir). */
  abrir(itemId: string, instanciaId: number, libroGeneradoId: number) {
    this.pagina = 0;
    this.ultimoError = "";
    if (itemId === ID_LIBRO_EN_BLANCO_JUGADOR) {
      if (libroGeneradoId > 0) {
        this.objetivo = { modo: "cargandoGenerado", instanciaId, libroGeneradoId };
        this.opciones.pedirLeerGenerado(libroGeneradoId);
      } else {
        this.objetivo = { modo: "escribir", instanciaId, libroGeneradoId: null, tituloInicial: "", paginasInicial: [] };
      }
      this.render();
      return;
    }
    const entrada = LIBROS_CONTENIDO[itemId];
    this.objetivo = entrada
      ? { modo: "catalogo", titulo: entrada.titulo, paginas: entrada.paginas }
      : { modo: "catalogo", titulo: itemId, paginas: ["(este libro no tiene contenido todavía)"] };
    this.render();
  }

  /** Refleja `libro:leido` — si no coincide con lo que se pidió, se ignora (llegó de otro clic). */
  actualizarGenerado(libroGeneradoId: number, titulo: string, paginas: string[]) {
    if (!this.objetivo) return;
    if (this.objetivo.modo === "cargandoGenerado" && this.objetivo.libroGeneradoId === libroGeneradoId) {
      this.objetivo = { modo: "leerGenerado", instanciaId: this.objetivo.instanciaId, libroGeneradoId, titulo, paginas };
      this.render();
    } else if (this.objetivo.modo === "leerGenerado" && this.objetivo.libroGeneradoId === libroGeneradoId) {
      this.objetivo = { ...this.objetivo, titulo, paginas };
      this.render();
    }
  }

  /** Refleja `libro:escrito` — vuelve a modo lectura con lo recién guardado, sin ida y vuelta extra al servidor. */
  confirmarEscrito(instanciaId: number, libroGeneradoId: number, titulo: string, paginas: string[]) {
    if (!this.objetivo) return;
    if ("instanciaId" in this.objetivo && this.objetivo.instanciaId === instanciaId) {
      this.objetivo = { modo: "leerGenerado", instanciaId, libroGeneradoId, titulo, paginas };
      this.pagina = 0;
      this.render();
    }
  }

  mostrarError(motivo: string) {
    this.ultimoError = motivo;
    this.render();
  }

  cerrar() {
    this.objetivo = null;
    this.raiz.style.display = "none";
  }

  private render() {
    this.raiz.innerHTML = "";
    if (!this.objetivo) {
      this.raiz.style.display = "none";
      return;
    }
    this.raiz.style.display = "block";

    if (this.ultimoError) {
      const err = document.createElement("div");
      err.style.color = "#e08080";
      err.style.fontSize = "11px";
      err.style.marginBottom = "6px";
      err.textContent = this.ultimoError;
      this.raiz.appendChild(err);
    }

    if (this.objetivo.modo === "cargandoGenerado") {
      const cargando = document.createElement("div");
      cargando.textContent = "Abriendo libro...";
      this.raiz.appendChild(cargando);
    } else if (this.objetivo.modo === "escribir") {
      this.renderEscribir(this.objetivo);
    } else {
      this.renderLectura(this.objetivo.titulo, this.objetivo.paginas, this.objetivo.modo === "leerGenerado" ? this.objetivo : null);
    }

    const btnCerrar = document.createElement("button");
    btnCerrar.textContent = "Cerrar";
    btnCerrar.style.marginTop = "10px";
    btnCerrar.onclick = () => this.cerrar();
    this.raiz.appendChild(btnCerrar);
  }

  private renderLectura(titulo: string, paginas: string[], propioParaEditar: { instanciaId: number; libroGeneradoId: number } | null) {
    const cab = document.createElement("div");
    cab.style.fontWeight = "bold";
    cab.style.fontSize = "15px";
    cab.style.marginBottom = "8px";
    cab.textContent = titulo;
    this.raiz.appendChild(cab);

    this.pagina = Math.max(0, Math.min(this.pagina, paginas.length - 1));
    const texto = document.createElement("div");
    texto.style.minHeight = "140px";
    texto.style.whiteSpace = "pre-wrap";
    texto.style.lineHeight = "1.5";
    texto.textContent = paginas[this.pagina] ?? "";
    this.raiz.appendChild(texto);

    const nav = document.createElement("div");
    nav.style.display = "flex";
    nav.style.justifyContent = "space-between";
    nav.style.alignItems = "center";
    nav.style.marginTop = "10px";
    const btnAnterior = document.createElement("button");
    btnAnterior.textContent = "< Anterior";
    btnAnterior.disabled = this.pagina === 0;
    btnAnterior.onclick = () => { this.pagina--; this.render(); };
    nav.appendChild(btnAnterior);
    const indicador = document.createElement("span");
    indicador.style.opacity = "0.75";
    indicador.style.fontSize = "11px";
    indicador.textContent = `Página ${this.pagina + 1} / ${paginas.length}`;
    nav.appendChild(indicador);
    const btnSiguiente = document.createElement("button");
    btnSiguiente.textContent = "Siguiente >";
    btnSiguiente.disabled = this.pagina >= paginas.length - 1;
    btnSiguiente.onclick = () => { this.pagina++; this.render(); };
    nav.appendChild(btnSiguiente);
    this.raiz.appendChild(nav);

    if (propioParaEditar) {
      const btnEditar = document.createElement("button");
      btnEditar.textContent = "Editar";
      btnEditar.style.marginTop = "8px";
      btnEditar.onclick = () => {
        this.objetivo = {
          modo: "escribir",
          instanciaId: propioParaEditar.instanciaId,
          libroGeneradoId: propioParaEditar.libroGeneradoId,
          tituloInicial: titulo,
          paginasInicial: paginas,
        };
        this.render();
      };
      this.raiz.appendChild(btnEditar);
    }
  }

  private renderEscribir(objetivo: Extract<Objetivo, { modo: "escribir" }>) {
    const cab = document.createElement("div");
    cab.style.fontWeight = "bold";
    cab.style.marginBottom = "6px";
    cab.textContent = objetivo.libroGeneradoId ? "Editar libro" : "Escribir libro en blanco";
    this.raiz.appendChild(cab);

    const inputTitulo = document.createElement("input");
    inputTitulo.type = "text";
    inputTitulo.placeholder = "Título del libro";
    inputTitulo.value = objetivo.tituloInicial;
    inputTitulo.style.width = "100%";
    inputTitulo.style.marginBottom = "6px";
    inputTitulo.style.boxSizing = "border-box";
    this.raiz.appendChild(inputTitulo);

    const ayuda = document.createElement("div");
    ayuda.style.opacity = "0.75";
    ayuda.style.fontSize = "11px";
    ayuda.style.marginBottom = "4px";
    ayuda.textContent = 'Escribe el texto de cada página; separa una página de la siguiente con una línea que ponga sola "---".';
    this.raiz.appendChild(ayuda);

    const textarea = document.createElement("textarea");
    textarea.value = objetivo.paginasInicial.join(SEPARADOR_PAGINAS);
    textarea.style.width = "100%";
    textarea.style.minHeight = "180px";
    textarea.style.boxSizing = "border-box";
    textarea.style.font = "12px serif";
    this.raiz.appendChild(textarea);

    const btnGuardar = document.createElement("button");
    btnGuardar.textContent = "Guardar";
    btnGuardar.style.marginTop = "8px";
    btnGuardar.onclick = () => {
      const titulo = inputTitulo.value.trim();
      const paginas = textarea.value.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
      if (!titulo || paginas.length === 0) {
        this.mostrarError("hace falta un título y al menos una página con texto");
        return;
      }
      this.opciones.escribir(objetivo.instanciaId, titulo, paginas);
    };
    this.raiz.appendChild(btnGuardar);
  }
}
