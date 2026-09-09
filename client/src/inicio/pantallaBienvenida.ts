/**
 * Pantalla de entrada (pedido streamer 2026-09-09: "menú principal + login +
 * creación de personaje") — PLACEHOLDER sencillo, mismo criterio que el
 * resto de paneles del proyecto ("al final del proyecto se hará toda la
 * UI"). Usa el marco compartido de panelBase.ts: X arriba-derecha, clic
 * fuera cierra, Escape cierra — cerrar por CUALQUIER vía sin haberte
 * logueado equivale a "seguir como invitado" (mismo comportamiento de
 * siempre: nombre libre, sin cuenta).
 *
 * 1 cuenta = 1 personaje (el nombre que registras/reclamas ES tu nombre de
 * personaje) — no hay pantalla de "selección de personaje" aparte porque no
 * se pidió multi-personaje por cuenta; el propio formulario de "Crear
 * cuenta" ES la creación de personaje.
 *
 * NO bloquea el arranque del juego por defecto: `debeSaltarBienvenida()`
 * decide si esta pantalla debe mostrarse siquiera — cualquier test
 * automatizado (Playwright fija `navigator.webdriver`), cualquier URL con
 * `?nombre=`/`?twitchSession=`/`?adminSession=` (tests e2e y flujos ya
 * existentes) y cualquier sesión de cuenta ya guardada saltan directo al
 * juego, exactamente igual que antes de que existiera esta pantalla.
 */
import { SERVER_URL } from "../config";
import { crearMarcoPanel, crearBoton, crearInput, crearLineaTexto } from "../ui/panelBase";

const SERVER_URL_HTTP = SERVER_URL.replace(/^ws/, "http");

/** `true` si el join debe seguir su curso normal sin pasar por esta pantalla — ver comentario de arriba. */
export function debeSaltarBienvenida(): boolean {
  if ((navigator as unknown as { webdriver?: boolean }).webdriver) return true; // cualquier test Playwright/Selenium
  const parametros = new URLSearchParams(location.search);
  if (parametros.get("nombre") || parametros.get("twitchSession") || parametros.get("adminSession")) return true;
  if (localStorage.getItem("playerSession")) return true;
  return false;
}

type Modo = "login" | "registro";

interface RespuestaAuth {
  token?: string;
  nombre?: string;
  error?: string;
}

async function llamarAuth(ruta: "login" | "registro", nombre: string, password: string): Promise<RespuestaAuth> {
  try {
    const r = await fetch(`${SERVER_URL_HTTP}/auth/jugador/${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, password }),
    });
    const cuerpo = (await r.json().catch(() => null)) as RespuestaAuth | null;
    if (!r.ok) return { error: cuerpo?.error ?? "no se pudo conectar con el servidor" };
    return cuerpo ?? { error: "respuesta vacía del servidor" };
  } catch {
    return { error: "no se pudo conectar con el servidor" };
  }
}

/** Muestra la pantalla y llama a `alContinuar()` en cuanto se cierra (loguearse, registrarse, o seguir de invitado) — exactamente una vez. */
export function mostrarPantallaBienvenida(contenedor: HTMLElement, alContinuar: () => void): void {
  const marco = crearMarcoPanel({
    contenedor,
    titulo: "Streamer Colony",
    icono: "⚔️",
    ancho: "300px",
    left: "50%",
    top: "50%",
  });
  // Centrado real (crearMarcoPanel solo fija left/top — el centrado con
  // transform es cosa de esta pantalla concreta, no del marco genérico).
  marco.raiz.style.transform = "translate(-50%, -50%)";

  let yaContinuado = false;
  marco.onCambioEstado(() => {
    if (!marco.estaAbierto() && !yaContinuado) {
      yaContinuado = true;
      alContinuar();
    }
  });

  let modo: Modo = "login";
  let enviando = false;

  function render() {
    marco.cuerpo.innerHTML = "";

    marco.cuerpo.appendChild(crearLineaTexto("Mundo medieval persistente — tu personaje se guarda con tu cuenta.", { tenue: true, fontSize: "11px" }));

    const pestanas = document.createElement("div");
    pestanas.style.display = "flex";
    pestanas.style.gap = "6px";
    pestanas.style.margin = "10px 0";
    const botonLogin = crearBoton("Iniciar sesión", () => { modo = "login"; render(); });
    const botonRegistro = crearBoton("Crear cuenta", () => { modo = "registro"; render(); });
    botonLogin.style.flex = "1";
    botonRegistro.style.flex = "1";
    botonLogin.style.opacity = modo === "login" ? "1" : "0.55";
    botonRegistro.style.opacity = modo === "registro" ? "1" : "0.55";
    pestanas.appendChild(botonLogin);
    pestanas.appendChild(botonRegistro);
    marco.cuerpo.appendChild(pestanas);

    const inputNombre = crearInput({ placeholder: modo === "login" ? "nombre de personaje" : "elige un nombre de personaje" });
    inputNombre.style.display = "block";
    inputNombre.style.width = "100%";
    inputNombre.style.marginBottom = "6px";
    inputNombre.style.boxSizing = "border-box";
    marco.cuerpo.appendChild(inputNombre);

    const inputPassword = crearInput({ placeholder: "contraseña", tipo: "password" });
    inputPassword.style.display = "block";
    inputPassword.style.width = "100%";
    inputPassword.style.marginBottom = "8px";
    inputPassword.style.boxSizing = "border-box";
    marco.cuerpo.appendChild(inputPassword);

    const error = document.createElement("div");
    error.className = "panel-colony-error";
    marco.cuerpo.appendChild(error);

    const botonEnviar = crearBoton(modo === "login" ? "Entrar" : "Crear cuenta", () => void enviar());
    botonEnviar.style.width = "100%";
    marco.cuerpo.appendChild(botonEnviar);

    const separador = document.createElement("div");
    separador.style.textAlign = "center";
    separador.style.margin = "10px 0 2px";
    const botonInvitado = crearBoton("Seguir como invitado", () => marco.cerrar());
    botonInvitado.style.width = "100%";
    botonInvitado.style.opacity = "0.75";
    separador.appendChild(botonInvitado);
    marco.cuerpo.appendChild(separador);

    async function enviar() {
      if (enviando) return;
      const nombre = inputNombre.value.trim();
      const password = inputPassword.value;
      if (!nombre || !password) {
        error.textContent = "rellena nombre y contraseña";
        return;
      }
      enviando = true;
      botonEnviar.disabled = true;
      error.textContent = "";
      const respuesta = await llamarAuth(modo, nombre, password);
      enviando = false;
      botonEnviar.disabled = false;
      if (!respuesta.token) {
        error.textContent = respuesta.error ?? "no se pudo continuar";
        return;
      }
      localStorage.setItem("playerSession", respuesta.token);
      localStorage.setItem("playerNombre", respuesta.nombre ?? nombre);
      marco.cerrar();
    }

    inputPassword.onkeydown = (e) => { if (e.key === "Enter") void enviar(); };
    inputNombre.onkeydown = (e) => { if (e.key === "Enter") void enviar(); };
  }

  render();
  marco.abrir();
}
