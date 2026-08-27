const contenedor = document.getElementById("app");
if (!contenedor) throw new Error("Falta el elemento #app en index.html");

// El juego ocupa toda la ventana (el 800x600 fijo era herencia del canvas
// de Phaser); la cámara ortográfica ajusta su encuadre en cada resize.
contenedor.style.width = "100vw";
contenedor.style.height = "100vh";
contenedor.style.overflow = "hidden";

// `?demo=1` arranca la demo local de un jugador (sin servidor Colyseus) —
// mismo mundo y mismo personaje, movimiento simulado en el cliente.
const params = new URLSearchParams(location.search);
if (params.has("demo")) {
  import("./demoLocal").then(({ iniciarDemoLocal }) =>
    iniciarDemoLocal(contenedor, params.get("mapa") || "demo"),
  );
} else {
  import("./game").then(({ iniciarJuego }) => iniciarJuego(contenedor));
}
