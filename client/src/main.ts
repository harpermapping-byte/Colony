import { iniciarJuego } from "./game";

const contenedor = document.getElementById("app");
if (!contenedor) throw new Error("Falta el elemento #app en index.html");

// El juego ocupa toda la ventana (el 800x600 fijo era herencia del canvas
// de Phaser); la cámara ortográfica ajusta su encuadre en cada resize.
contenedor.style.width = "100vw";
contenedor.style.height = "100vh";
contenedor.style.overflow = "hidden";

iniciarJuego(contenedor).catch((err) => {
  // Sin esto, un fallo al conectar (p.ej. F5 justo cuando el servidor
  // todavía está cerrando la sala anterior) dejaba la pantalla en negro
  // sin ningún rastro en consola — nada que depurar, nada que ver.
  console.error("No se pudo iniciar el juego:", err);
  contenedor.innerText = "Error al conectar con el servidor. Espera un par de segundos y recarga la página.";
});
