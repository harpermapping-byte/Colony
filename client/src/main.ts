import { iniciarJuego } from "./game";

const contenedor = document.getElementById("app");
if (!contenedor) throw new Error("Falta el elemento #app en index.html");

contenedor.style.width = "800px";
contenedor.style.height = "600px";

iniciarJuego(contenedor);
