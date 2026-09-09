/**
 * Visor/escritor de libros (docs/GDD_Libreria.md, pedido 2026-09-01) —
 * "ventanita como los minijuegos donde veas el libro, lo abras con clic y
 * pases páginas con clic también a izquierda o derecha". Marco compartido
 * (`panelBase.ts`, tema madera/pergamino).
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
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto } from "../ui/panelBase";
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

export class PanelLibro {
  private readonly marco;
  private objetivo: Objetivo | null = null;
  private pagina = 0;
  private ultimoError = "";

  constructor(private opciones: OpcionesPanelLibro) {
    this.marco = crearMarcoPanel({ contenedor: opciones.contenedor, titulo: "Libro", icono: "📖", left: "50%", top: "50%", ancho: "380px" });
    this.marco.raiz.style.transform = "translate(-50%, -50%)";
    this.marco.raiz.style.maxHeight = "70vh";
    this.marco.cuerpo.style.font = "13px serif"; // el tema base es sans-serif; un libro se lee mejor con serif, como ya hacía este panel.
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
      this.marco.abrir();
      this.render();
      return;
    }
    const entrada = LIBROS_CONTENIDO[itemId];
    this.objetivo = entrada
      ? { modo: "catalogo", titulo: entrada.titulo, paginas: entrada.paginas }
      : { modo: "catalogo", titulo: itemId, paginas: ["(este libro no tiene contenido todavía)"] };
    this.marco.abrir();
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
    this.marco.cerrar();
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";
    if (!this.objetivo) return;

    if (this.ultimoError) {
      const err = document.createElement("div");
      err.className = "panel-colony-error";
      err.textContent = this.ultimoError;
      cuerpo.appendChild(err);
    }

    if (this.objetivo.modo === "cargandoGenerado") {
      cuerpo.appendChild(crearLineaTexto("Abriendo libro..."));
    } else if (this.objetivo.modo === "escribir") {
      this.renderEscribir(this.objetivo);
    } else {
      this.renderLectura(this.objetivo.titulo, this.objetivo.paginas, this.objetivo.modo === "leerGenerado" ? this.objetivo : null);
    }
  }

  private renderLectura(titulo: string, paginas: string[], propioParaEditar: { instanciaId: number; libroGeneradoId: number } | null) {
    const cuerpo = this.marco.cuerpo;
    const cab = document.createElement("div");
    cab.style.fontWeight = "bold";
    cab.style.fontSize = "15px";
    cab.style.marginBottom = "8px";
    cab.textContent = titulo;
    cuerpo.appendChild(cab);

    this.pagina = Math.max(0, Math.min(this.pagina, paginas.length - 1));
    const texto = document.createElement("div");
    texto.style.minHeight = "140px";
    texto.style.whiteSpace = "pre-wrap";
    texto.style.lineHeight = "1.5";
    texto.textContent = paginas[this.pagina] ?? "";
    cuerpo.appendChild(texto);

    const nav = document.createElement("div");
    nav.style.display = "flex";
    nav.style.justifyContent = "space-between";
    nav.style.alignItems = "center";
    nav.style.marginTop = "10px";
    const btnAnterior = crearBoton("< Anterior", () => { this.pagina--; this.render(); });
    btnAnterior.disabled = this.pagina === 0;
    nav.appendChild(btnAnterior);
    const indicador = document.createElement("span");
    indicador.style.opacity = "0.75";
    indicador.style.fontSize = "11px";
    indicador.textContent = `Página ${this.pagina + 1} / ${paginas.length}`;
    nav.appendChild(indicador);
    const btnSiguiente = crearBoton("Siguiente >", () => { this.pagina++; this.render(); });
    btnSiguiente.disabled = this.pagina >= paginas.length - 1;
    nav.appendChild(btnSiguiente);
    cuerpo.appendChild(nav);

    if (propioParaEditar) {
      const btnEditar = crearBoton("Editar", () => {
        this.objetivo = {
          modo: "escribir",
          instanciaId: propioParaEditar.instanciaId,
          libroGeneradoId: propioParaEditar.libroGeneradoId,
          tituloInicial: titulo,
          paginasInicial: paginas,
        };
        this.render();
      });
      btnEditar.style.marginTop = "8px";
      cuerpo.appendChild(btnEditar);
    }
  }

  private renderEscribir(objetivo: Extract<Objetivo, { modo: "escribir" }>) {
    const cuerpo = this.marco.cuerpo;
    const cab = document.createElement("div");
    cab.style.fontWeight = "bold";
    cab.style.marginBottom = "6px";
    cab.textContent = objetivo.libroGeneradoId ? "Editar libro" : "Escribir libro en blanco";
    cuerpo.appendChild(cab);

    const inputTitulo = crearInput({ placeholder: "Título del libro" });
    inputTitulo.value = objetivo.tituloInicial;
    inputTitulo.style.width = "100%";
    inputTitulo.style.marginBottom = "6px";
    inputTitulo.style.boxSizing = "border-box";
    cuerpo.appendChild(inputTitulo);

    cuerpo.appendChild(crearLineaTexto('Escribe el texto de cada página; separa una página de la siguiente con una línea que ponga sola "---".', { tenue: true, fontSize: "11px" }));

    const textarea = document.createElement("textarea");
    textarea.className = "panel-colony-input";
    textarea.value = objetivo.paginasInicial.join(SEPARADOR_PAGINAS);
    textarea.style.width = "100%";
    textarea.style.minHeight = "180px";
    textarea.style.boxSizing = "border-box";
    textarea.style.font = "12px serif";
    cuerpo.appendChild(textarea);

    const btnGuardar = crearBoton("Guardar", () => {
      const titulo = inputTitulo.value.trim();
      const paginas = textarea.value.split(/\n\s*---\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
      if (!titulo || paginas.length === 0) {
        this.mostrarError("hace falta un título y al menos una página con texto");
        return;
      }
      this.opciones.escribir(objetivo.instanciaId, titulo, paginas);
    });
    btnGuardar.style.marginTop = "8px";
    cuerpo.appendChild(btnGuardar);
  }
}
