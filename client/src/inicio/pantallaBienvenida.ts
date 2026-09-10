/**
 * Pantalla de entrada — PANTALLA COMPLETA (pedido streamer 2026-09-09:
 * "deberia salir al inicio... una pestaña entera toda la pantalla para que
 * te loguees y/o crees cuenta... no puedes jugar sin poner usuario, de esta
 * manera la pantalla tapa todo y mientras va cargando el fondo... desaparece
 * ahi"). Sustituye el panel flotante centrado 300px de la versión anterior.
 *
 * A diferencia de TODOS los demás paneles del proyecto, esta pantalla NO usa
 * `crearMarcoPanel` — sin X, sin clic-fuera, sin Escape. Jugar SIN cuenta ya
 * no es una opción para un navegador real (pedido explícito: "no puedes
 * jugar sin poner usuario"), así que no puede tener ningún gesto que la
 * cierre sin completar login/registro. `debeSaltarBienvenida()` sigue
 * intacta: cualquier sesión de test (Playwright fija `navigator.webdriver`),
 * cualquier URL con `?nombre=`/`?twitchSession=`/`?adminSession=`, y
 * cualquier sesión de cuenta YA guardada en localStorage ni siquiera montan
 * esta pantalla — la suite e2e entera (~50 archivos) sigue sin tocarla.
 *
 * Login de administrador UNIFICADO aquí (pedido streamer: "el login deberia
 * ser para todos, no solo admin, el admin a tener su cuenta o contraseña
 * podria hacerlo") — antes vivía en un panel flotante SIEMPRE VISIBLE
 * (`admin/panelLoginAdmin.ts`), montado dentro del juego y solapado con el
 * resto del HUD. Ahora es una sección opcional plegada dentro de esta misma
 * pantalla: el login de JUGADOR sigue siendo obligatorio (todo admin es
 * TAMBIÉN un jugador con su propio personaje — "1 jarl por mapa" no cambia,
 * ver docs/GDD_Admin.md), la sección de admin solo AÑADE la sesión de
 * jarl/superadmin por encima si se rellena, sin bloquear la entrada como
 * jugador si falla. El panel flotante viejo (`admin/panelLoginAdmin.ts`) se
 * eliminó del repo al quedarse sin ningún consumidor — cero panel de admin
 * en pantalla durante la partida, solo un indicador de sesión ya activa
 * (ver `mostrarEstadoAdmin` en `game.ts`).
 *
 * Twitch (pedido streamer: "lo de conectar twitch debe ir al crear cuenta o
 * loguearse, y si no lo hace se queda en ajustes loguearse con twitch") —
 * enlace de conexión real disponible aquí (mismo endpoint que antes usaba la
 * caja suelta de `game.ts`, ya retirada); quien no lo use aquí lo tiene
 * igual más tarde en el panel de Ajustes (`ajustes/panelAjustes.ts`).
 *
 * "Carga en paralelo" (pedido streamer: "mientras va cargando el fondo...
 * asi desaparece ahi"): en cuanto login/registro resuelve, la pantalla NO
 * desaparece de golpe — se queda tapando todo con un estado "Cargando
 * mundo..." mientras `alContinuar()` (== `arrancarJuego`, en `main.ts`)
 * conecta con Colyseus y monta la escena 3D entera, y solo entonces se
 * retira. Sin esto había un hueco de canvas en negro entre cerrar el login
 * y que apareciera el mundo.
 */
import { SERVER_URL } from "../config";
import { crearBoton, crearInput, crearLineaTexto } from "../ui/panelBase";

const SERVER_URL_HTTP = SERVER_URL.replace(/^ws/, "http");

/**
 * `true` si el join debe seguir su curso normal sin pasar por esta pantalla
 * — ver comentario de arriba.
 *
 * Bug real cerrado (2026-09-09, pedido streamer: "hay que arreglar que
 * funcione la conexión con cuenta de Twitch"): `twitchSession`/
 * `adminSession` en la URL YA NO saltan esta pantalla por sí solos. Antes sí
 * lo hacían (arrastrado de un diseño anterior a que la cuenta de jugador
 * fuera obligatoria) — así que un visitante SIN cuenta que pulsaba
 * "Conectar con Twitch" desde esta misma pantalla volvía del OAuth con
 * `?twitchSession=...` en la URL, la pantalla desaparecía sola SIN haber
 * creado ninguna cuenta, y entraba como invitado anónimo (`Viewer-XXX`) —
 * exactamente lo que "no puedes jugar sin cuenta" prohíbe, y de paso su
 * vínculo de Twitch quedaba huérfano de cualquier cuenta real. Ahora la
 * pantalla sigue mostrándose (con el estado "ya conectado" reflejado, ver
 * `mostrarPantallaBienvenida`) hasta que el jugador rellena nombre/
 * contraseña de verdad — `location.search` no cambia entre medias (SPA sin
 * navegación real), así que `game.ts` sigue leyendo el mismo
 * `twitchSession`/`adminSession` de la URL cuando por fin arranca el juego,
 * sin perder nada del vínculo. Solo `nombre` (bypass de test) y una sesión
 * de JUGADOR ya guardada siguen saltando esta pantalla.
 */
export function debeSaltarBienvenida(): boolean {
  if ((navigator as unknown as { webdriver?: boolean }).webdriver) return true; // cualquier test Playwright/Selenium
  const parametros = new URLSearchParams(location.search);
  if (parametros.get("nombre")) return true;
  if (localStorage.getItem("playerSession")) return true;
  return false;
}

type Modo = "login" | "registro";

interface RespuestaAuthJugador {
  token?: string;
  nombre?: string;
  error?: string;
}
interface RespuestaAuthAdmin {
  token?: string;
  error?: string;
}

async function llamarAuthJugador(ruta: Modo, nombre: string, password: string): Promise<RespuestaAuthJugador> {
  try {
    const r = await fetch(`${SERVER_URL_HTTP}/auth/jugador/${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, password }),
    });
    const cuerpo = (await r.json().catch(() => null)) as RespuestaAuthJugador | null;
    if (!r.ok) return { error: cuerpo?.error ?? "no se pudo conectar con el servidor" };
    return cuerpo ?? { error: "respuesta vacía del servidor" };
  } catch {
    return { error: "no se pudo conectar con el servidor" };
  }
}

async function llamarAuthAdmin(usuario: string, password: string): Promise<RespuestaAuthAdmin> {
  try {
    const r = await fetch(`${SERVER_URL_HTTP}/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password }),
    });
    const cuerpo = (await r.json().catch(() => null)) as RespuestaAuthAdmin | null;
    if (!r.ok) return { error: cuerpo?.error ?? "no se pudo iniciar sesión de admin" };
    return cuerpo ?? { error: "respuesta vacía del servidor" };
  } catch {
    return { error: "no se pudo conectar con el servidor" };
  }
}

/**
 * Muestra la pantalla fullscreen y llama a `alContinuar()` tras
 * loguearse/registrarse (nunca antes — no hay forma de saltársela). Espera
 * su resolución (conexión + carga del mundo) antes de retirar el overlay.
 */
export function mostrarPantallaBienvenida(contenedor: HTMLElement, alContinuar: () => Promise<void>): void {
  const fondo = document.createElement("div");
  fondo.className = "bienvenida-fondo";
  fondo.dataset.testid = "pantalla-bienvenida";
  contenedor.appendChild(fondo);

  const tarjeta = document.createElement("div");
  tarjeta.className = "bienvenida-tarjeta";
  fondo.appendChild(tarjeta);

  let modo: Modo = "login";
  let mostrarAdmin = false;
  let enviando = false;

  // `render()` reconstruye la tarjeta ENTERA en cada cambio (cambiar de
  // pestaña, expandir "¿Eres jarl o admin?"...) — sin guardar el valor
  // tecleado en variables propias, cualquiera de esos gestos recreaba los
  // `<input>` desde cero y BORRABA lo que ya se había escrito (bug real
  // encontrado verificando con Playwright: rellenar nombre/contraseña y
  // luego abrir la sección de admin vaciaba los dos primeros campos antes
  // de poder pulsar "Entrar"). Los 4 campos son opcionales de rellenar en
  // cualquier orden, así que los cuatro necesitan este mismo tratamiento.
  let valorNombre = "";
  let valorPassword = "";
  let valorAdminUsuario = "";
  let valorAdminPassword = "";

  // Vuelta del OAuth de Twitch (ver comentario de `debeSaltarBienvenida`
  // arriba) — `twitchLogin` llega en la URL una única vez, junto con
  // `twitchSession` (que `game.ts` ya lee de `location.search` cuando el
  // juego arranca, sin que esta pantalla tenga que reenviarlo a ningún
  // sitio). Solo se usa aquí para reflejar el estado "ya conectado" en vez
  // de mostrar el enlace como si no se hubiera pulsado.
  const twitchLoginConectado = new URLSearchParams(location.search).get("twitchLogin");

  function render() {
    tarjeta.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.className = "bienvenida-titulo";
    titulo.textContent = "⚔️ Streamer Colony";
    tarjeta.appendChild(titulo);

    tarjeta.appendChild(
      crearLineaTexto(
        "Mundo medieval persistente. Necesitas iniciar sesión o crear una cuenta para jugar — tu personaje se guarda con ella.",
        { tenue: true, fontSize: "13px" },
      ),
    );

    const pestanas = document.createElement("div");
    pestanas.className = "bienvenida-pestanas";
    const botonLogin = crearBoton("Iniciar sesión", () => {
      modo = "login";
      render();
    });
    const botonRegistro = crearBoton("Crear cuenta", () => {
      modo = "registro";
      render();
    });
    botonLogin.style.opacity = modo === "login" ? "1" : "0.55";
    botonRegistro.style.opacity = modo === "registro" ? "1" : "0.55";
    pestanas.appendChild(botonLogin);
    pestanas.appendChild(botonRegistro);
    tarjeta.appendChild(pestanas);

    const inputNombre = crearInput({ placeholder: modo === "login" ? "nombre de personaje" : "elige un nombre de personaje" });
    inputNombre.className += " bienvenida-input";
    inputNombre.dataset.testid = "bienvenida-nombre";
    inputNombre.value = valorNombre;
    inputNombre.oninput = () => { valorNombre = inputNombre.value; };
    tarjeta.appendChild(inputNombre);

    const inputPassword = crearInput({ placeholder: "contraseña", tipo: "password" });
    inputPassword.className += " bienvenida-input";
    inputPassword.dataset.testid = "bienvenida-password";
    inputPassword.value = valorPassword;
    inputPassword.oninput = () => { valorPassword = inputPassword.value; };
    tarjeta.appendChild(inputPassword);

    const error = document.createElement("div");
    error.className = "panel-colony-error";
    tarjeta.appendChild(error);

    const botonEnviar = crearBoton(modo === "login" ? "Entrar" : "Crear cuenta", () => void enviar());
    botonEnviar.className += " bienvenida-boton-principal";
    botonEnviar.dataset.testid = "bienvenida-entrar";
    tarjeta.appendChild(botonEnviar);

    // Twitch (pedido streamer: integrado aquí, con fallback en Ajustes) —
    // INDEPENDIENTE del login de jugador: es un simple redirect OAuth, no
    // bloquea nada, solo vincula la cuenta de Twitch para que el chat te
    // reconozca (y, si esa cuenta ya está vinculada a un admin, añade
    // también la sesión de jarl/superadmin — mismo mecanismo de siempre,
    // ver twitch/rutasOauth.ts). Vuelta del OAuth (ver
    // `twitchLoginConectado` arriba): ya no hace falta volver a pulsar el
    // enlace — el vínculo ya está hecho y se manda solo al terminar de
    // crear/loguear la cuenta de jugador (obligatoria) de abajo.
    const separadorTwitch = document.createElement("div");
    separadorTwitch.className = "bienvenida-separador";
    separadorTwitch.textContent = "o";
    tarjeta.appendChild(separadorTwitch);
    if (twitchLoginConectado) {
      tarjeta.appendChild(crearLineaTexto(`🎮 Twitch conectado como ${twitchLoginConectado}`, { fontSize: "12px" }));
    } else {
      const enlaceTwitch = document.createElement("a");
      enlaceTwitch.href = `${SERVER_URL_HTTP}/auth/twitch/login`;
      enlaceTwitch.className = "bienvenida-enlace-twitch";
      enlaceTwitch.textContent = "🎮 Conectar con Twitch";
      tarjeta.appendChild(enlaceTwitch);
      tarjeta.appendChild(crearLineaTexto("(si no lo haces ahora, puedes conectarlo luego desde Ajustes)", { tenue: true, fontSize: "11px" }));
    }

    // Admin (jarl/superadmin) — sección opcional plegada, unificada aquí en
    // vez del panel flotante siempre-visible que había antes.
    const toggleAdmin = document.createElement("div");
    toggleAdmin.className = "bienvenida-toggle-admin";
    toggleAdmin.textContent = mostrarAdmin ? "▾ ¿Eres jarl o admin?" : "▸ ¿Eres jarl o admin?";
    toggleAdmin.onclick = () => {
      mostrarAdmin = !mostrarAdmin;
      render();
    };
    tarjeta.appendChild(toggleAdmin);

    let inputAdminUsuario: HTMLInputElement | null = null;
    let inputAdminPassword: HTMLInputElement | null = null;
    if (mostrarAdmin) {
      tarjeta.appendChild(
        crearLineaTexto("Usuario/contraseña de admin — se añade a tu sesión de jugador de arriba, no la sustituye.", { tenue: true, fontSize: "11px" }),
      );
      inputAdminUsuario = crearInput({ placeholder: "usuario de admin" });
      inputAdminUsuario.className += " bienvenida-input";
      inputAdminUsuario.value = valorAdminUsuario;
      inputAdminUsuario.oninput = () => { valorAdminUsuario = inputAdminUsuario!.value; };
      tarjeta.appendChild(inputAdminUsuario);
      inputAdminPassword = crearInput({ placeholder: "contraseña de admin", tipo: "password" });
      inputAdminPassword.className += " bienvenida-input";
      inputAdminPassword.value = valorAdminPassword;
      inputAdminPassword.oninput = () => { valorAdminPassword = inputAdminPassword!.value; };
      tarjeta.appendChild(inputAdminPassword);
    }

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

      const respuesta = await llamarAuthJugador(modo, nombre, password);
      if (!respuesta.token) {
        enviando = false;
        botonEnviar.disabled = false;
        error.textContent = respuesta.error ?? "no se pudo continuar";
        return;
      }

      // Admin opcional (solo si el desplegable está abierto Y relleno) — un
      // fallo aquí NO bloquea la entrada como jugador, solo se avisa y sigue.
      if (mostrarAdmin && inputAdminUsuario?.value && inputAdminPassword) {
        const respuestaAdmin = await llamarAuthAdmin(inputAdminUsuario.value.trim(), inputAdminPassword.value);
        if (respuestaAdmin.token) sessionStorage.setItem("adminSession", respuestaAdmin.token);
        else console.warn("[admin] no se pudo iniciar sesión de admin:", respuestaAdmin.error);
      }

      localStorage.setItem("playerSession", respuesta.token);
      localStorage.setItem("playerNombre", respuesta.nombre ?? nombre);

      mostrarCargando();
      await alContinuar();
      fondo.remove();
    }

    inputPassword.onkeydown = (e) => {
      if (e.key === "Enter") void enviar();
    };
    inputNombre.onkeydown = (e) => {
      if (e.key === "Enter") void enviar();
    };
  }

  function mostrarCargando() {
    tarjeta.innerHTML = "";
    const titulo = document.createElement("div");
    titulo.className = "bienvenida-titulo";
    titulo.textContent = "⚔️ Streamer Colony";
    tarjeta.appendChild(titulo);
    const spinner = document.createElement("div");
    spinner.className = "bienvenida-spinner";
    tarjeta.appendChild(spinner);
    tarjeta.appendChild(crearLineaTexto("Cargando mundo...", { fontSize: "13px" }));
  }

  render();
}
