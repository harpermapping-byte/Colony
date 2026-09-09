import "./ui/temaPaneles.css";
import { iniciarJuego } from "./game";
import { debeSaltarBienvenida, mostrarPantallaBienvenida } from "./inicio/pantallaBienvenida";

const elementoApp = document.getElementById("app");
if (!elementoApp) throw new Error("Falta el elemento #app en index.html");
const contenedor: HTMLElement = elementoApp;

// El juego ocupa toda la ventana (el 800x600 fijo era herencia del canvas
// de Phaser); la cámara ortográfica ajusta su encuadre en cada resize.
contenedor.style.width = "100vw";
contenedor.style.height = "100vh";
contenedor.style.overflow = "hidden";

function arrancarJuego() {
  iniciarJuego(contenedor).catch((err) => {
    // Sin esto, un fallo al conectar (p.ej. F5 justo cuando el servidor
    // todavía está cerrando la sala anterior) dejaba la pantalla en negro
    // sin ningún rastro en consola — nada que depurar, nada que ver.
    console.error("No se pudo iniciar el juego:", err);
    contenedor.innerText = "Error al conectar con el servidor. Espera un par de segundos y recarga la página.";
  });
}

// Pantalla de bienvenida (docs/GDD_Cuentas.md, pedido streamer 2026-09-09) —
// NUNCA bloquea tests/flujos ya existentes, ver debeSaltarBienvenida().
if (debeSaltarBienvenida()) {
  arrancarJuego();
} else {
  mostrarPantallaBienvenida(contenedor, arrancarJuego);
}
