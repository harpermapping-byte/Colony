import { iniciarJuego } from "./game";

const contenedor = document.getElementById("app");
if (!contenedor) throw new Error("Falta el elemento #app en index.html");

// El juego ocupa toda la ventana (el 800x600 fijo era herencia del canvas
// de Phaser); la cámara ortográfica ajusta su encuadre en cada resize.
contenedor.style.width = "100vw";
contenedor.style.height = "100vh";
contenedor.style.overflow = "hidden";

iniciarJuego(contenedor);
