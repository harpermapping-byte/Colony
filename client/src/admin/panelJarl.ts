/**
 * Panel de jarl / superadmin — PLACEHOLDER de testeo (docs/GDD_Admin.md,
 * pedido 2026-08-30: "el panel de superadmin es como el de jarl pero algún
 * comando más"). Herramientas jarl-only que YA existían como mensajes de
 * room sin ningún UI (PvP global, simular eventos/comandos de Twitch de
 * prueba) + cambiar la propia contraseña. Con `esSuperadmin`, añade la
 * gestión de cuentas de admin (crear-cuenta/asignar-jarl/listar-cuentas,
 * rutasAdmin.ts) — comandos que solo tienen sentido para quien ve TODOS
 * los mapas, nunca para un jarl de uno solo.
 *
 * Migrado al marco compartido (pedido streamer 2026-09-09: "TODA pantalla
 * que salga... debe salir así con esta estética") — misma esquina superior
 * derecha de siempre (`crearMarcoPanel`, panelBase.ts), ahora con
 * X/clic-fuera/Escape: se abre solo en cuanto se monta (mismo momento que
 * antes, cuando el servidor confirma la sesión admin) porque antes no
 * existía forma de ocultrarlo — la X es la única capacidad nueva.
 */
import { crearMarcoPanel, crearBoton, crearSubtitulo, type MarcoPanel } from "../ui/panelBase";

export interface OpcionesPanelJarl {
  contenedor: HTMLElement;
  esSuperadmin: boolean;
  serverUrlHttp: string;
  adminToken: string;
  pvpFijar(on: boolean): void;
  simularCanje(tipo: "bueno" | "malo"): void;
  simularComando(comando: string): void;
  forzarDirecto(on: boolean): void;
  renombrarCapital(nombre: string): void;
}

export class PanelJarl {
  private readonly marco: MarcoPanel;
  private pvpOn: boolean | null = null;
  private mensajeCuentas = "";
  // Ciudad capital (docs/GDD_Ciudad_Capital.md, pedido 2026-08-31) — ""
  // tras la primera respuesta del servidor = nunca renombrada (se usa el
  // nombre baked); `null` = todavía no hemos preguntado.
  private nombreCapital: string | null = null;

  constructor(private opciones: OpcionesPanelJarl) {
    this.marco = crearMarcoPanel({
      contenedor: opciones.contenedor,
      titulo: opciones.esSuperadmin ? "Panel de superadmin" : "Panel de jarl",
      icono: opciones.esSuperadmin ? "⭐" : "👑",
      ancho: "240px",
    });
    // misma esquina de siempre — crearMarcoPanel solo posiciona por
    // left/top, así que right se fija a mano tras crear el marco.
    this.marco.raiz.style.right = "16px";
    this.marco.raiz.style.top = "16px";
    this.render();
    this.marco.abrir();
  }

  actualizarPvp(on: boolean) {
    this.pvpOn = on;
    this.render();
  }

  actualizarCapital(nombre: string) {
    this.nombreCapital = nombre;
    this.render();
  }

  private async llamarHttp(ruta: string, cuerpo: Record<string, unknown>): Promise<{ ok: boolean; datos: any }> {
    try {
      const r = await fetch(`${this.opciones.serverUrlHttp}${ruta}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: this.opciones.adminToken, ...cuerpo }),
      });
      const datos = await r.json().catch(() => null);
      return { ok: r.ok, datos };
    } catch {
      return { ok: false, datos: { error: "no se pudo conectar con el servidor" } };
    }
  }

  /** Input de texto con el estilo compartido — panelBase.ts no ofrece variantes con ancho 100%/bloque, así que se arma aquí a mano. */
  private crearInputBloque(placeholder: string, tipo = "text"): HTMLInputElement {
    const input = document.createElement("input");
    input.className = "panel-colony-input";
    input.type = tipo;
    input.placeholder = placeholder;
    input.style.display = "block";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.marginBottom = "4px";
    return input;
  }

  private crearMensaje(): HTMLDivElement {
    const div = document.createElement("div");
    div.style.color = "var(--panel-texto-tenue)";
    div.style.fontSize = "11px";
    div.style.marginBottom = "4px";
    return div;
  }

  private render() {
    const cuerpo = this.marco.cuerpo;
    cuerpo.innerHTML = "";

    // --- PvP global (docs/GDD_PvP.md) ---
    cuerpo.appendChild(crearSubtitulo("⚔️ PvP global"));
    const estadoPvp = this.pvpOn === null ? "?" : this.pvpOn ? "ON" : "OFF";
    const estadoTexto = document.createElement("div");
    estadoTexto.textContent = `Estado: ${estadoPvp}`;
    estadoTexto.style.marginBottom = "4px";
    cuerpo.appendChild(estadoTexto);
    const filaPvp = document.createElement("div");
    filaPvp.style.display = "flex";
    filaPvp.style.gap = "6px";
    filaPvp.appendChild(crearBoton("Activar", () => this.opciones.pvpFijar(true)));
    filaPvp.appendChild(crearBoton("Desactivar", () => this.opciones.pvpFijar(false)));
    cuerpo.appendChild(filaPvp);

    // --- Ciudad capital (docs/GDD_Ciudad_Capital.md) ---
    cuerpo.appendChild(crearSubtitulo("🏰 Ciudad capital"));
    const actual = this.nombreCapital === null ? "cargando…" : this.nombreCapital || "(nombre de nacimiento)";
    const lineaCapital = document.createElement("div");
    lineaCapital.textContent = `Actual: ${actual}`;
    lineaCapital.style.marginBottom = "4px";
    cuerpo.appendChild(lineaCapital);
    const filaCapital = document.createElement("div");
    filaCapital.style.display = "flex";
    filaCapital.style.gap = "6px";
    const inputCapital = document.createElement("input");
    inputCapital.className = "panel-colony-input";
    inputCapital.placeholder = "nuevo nombre";
    inputCapital.style.flex = "1";
    inputCapital.style.minWidth = "0";
    filaCapital.appendChild(inputCapital);
    filaCapital.appendChild(crearBoton("Renombrar", () => { if (inputCapital.value.trim()) this.opciones.renombrarCapital(inputCapital.value.trim()); }));
    cuerpo.appendChild(filaCapital);

    // --- Pruebas de Twitch (docs/GDD_Twitch.md) — mismos comandos que el bot real, sin depender de un directo activo ---
    cuerpo.appendChild(crearSubtitulo("🎮 Pruebas de Twitch"));
    const filaCanje = document.createElement("div");
    filaCanje.style.display = "flex";
    filaCanje.style.gap = "6px";
    filaCanje.style.marginBottom = "4px";
    filaCanje.appendChild(crearBoton("Canje bueno", () => this.opciones.simularCanje("bueno")));
    filaCanje.appendChild(crearBoton("Canje malo", () => this.opciones.simularCanje("malo")));
    cuerpo.appendChild(filaCanje);

    const filaComando = document.createElement("div");
    filaComando.style.display = "flex";
    filaComando.style.gap = "6px";
    filaComando.style.marginBottom = "4px";
    const inputComando = document.createElement("input");
    inputComando.className = "panel-colony-input";
    inputComando.placeholder = "!curar / !comer / !beber / !cagar";
    inputComando.style.flex = "1";
    inputComando.style.minWidth = "0";
    filaComando.appendChild(inputComando);
    filaComando.appendChild(crearBoton("Enviar", () => { if (inputComando.value) this.opciones.simularComando(inputComando.value); }));
    cuerpo.appendChild(filaComando);

    const filaDirecto = document.createElement("div");
    filaDirecto.style.display = "flex";
    filaDirecto.style.gap = "6px";
    filaDirecto.appendChild(crearBoton("Forzar directo ON", () => this.opciones.forzarDirecto(true)));
    filaDirecto.appendChild(crearBoton("OFF", () => this.opciones.forzarDirecto(false)));
    cuerpo.appendChild(filaDirecto);

    // --- Cambiar mi contraseña ---
    cuerpo.appendChild(crearSubtitulo("🔑 Cambiar mi contraseña"));
    const inputActual = this.crearInputBloque("contraseña actual", "password");
    cuerpo.appendChild(inputActual);
    const inputNueva = this.crearInputBloque("contraseña nueva", "password");
    cuerpo.appendChild(inputNueva);
    const mensajePassword = this.crearMensaje();
    cuerpo.appendChild(mensajePassword);
    cuerpo.appendChild(crearBoton("Cambiar", async () => {
      const r = await this.llamarHttp("/auth/admin/cambiar-password", {
        passwordActual: inputActual.value,
        passwordNueva: inputNueva.value,
      });
      mensajePassword.textContent = r.ok ? "Contraseña cambiada — vuelve a loguearte." : (r.datos?.error ?? "error");
    }));

    if (this.opciones.esSuperadmin) this.renderExtrasSuperadmin(cuerpo);
  }

  private renderExtrasSuperadmin(cuerpo: HTMLDivElement) {
    cuerpo.appendChild(crearSubtitulo("Gestión de cuentas de admin:"));

    const inputUsuarioNuevo = this.crearInputBloque("usuario nuevo");
    cuerpo.appendChild(inputUsuarioNuevo);
    const inputPasswordNuevo = this.crearInputBloque("contraseña", "password");
    cuerpo.appendChild(inputPasswordNuevo);

    const selectRol = document.createElement("select");
    selectRol.className = "panel-colony-input";
    for (const rol of ["jarl", "superadmin"]) {
      const opt = document.createElement("option");
      opt.value = rol;
      opt.textContent = rol;
      selectRol.appendChild(opt);
    }
    selectRol.style.display = "block";
    selectRol.style.width = "100%";
    selectRol.style.boxSizing = "border-box";
    selectRol.style.marginBottom = "4px";
    cuerpo.appendChild(selectRol);

    const mensajeCrear = this.crearMensaje();
    cuerpo.appendChild(mensajeCrear);
    cuerpo.appendChild(crearBoton("Crear cuenta", async () => {
      const r = await this.llamarHttp("/auth/admin/crear-cuenta", {
        usuario: inputUsuarioNuevo.value,
        password: inputPasswordNuevo.value,
        rol: selectRol.value,
      });
      mensajeCrear.textContent = r.ok ? `Cuenta "${r.datos.usuario}" creada (sin mapa asignado).` : (r.datos?.error ?? "error");
    }));

    cuerpo.appendChild(crearSubtitulo("Asignar jarl de un mapa (1 jarl por mapa):"));
    const inputMapaId = this.crearInputBloque("mapaId (ej. principal)");
    cuerpo.appendChild(inputMapaId);
    const inputUsuarioAsignar = this.crearInputBloque("usuario");
    cuerpo.appendChild(inputUsuarioAsignar);
    const mensajeAsignar = this.crearMensaje();
    cuerpo.appendChild(mensajeAsignar);
    cuerpo.appendChild(crearBoton("Asignar", async () => {
      const r = await this.llamarHttp("/auth/admin/asignar-jarl", { mapaId: inputMapaId.value, usuario: inputUsuarioAsignar.value });
      mensajeAsignar.textContent = r.ok ? "Asignado." : (r.datos?.error ?? "error");
    }));

    cuerpo.appendChild(crearSubtitulo("Cuentas:"));
    const listaCuentas = document.createElement("div");
    listaCuentas.style.fontSize = "11px";
    listaCuentas.style.whiteSpace = "pre-wrap";
    listaCuentas.style.marginBottom = "4px";
    listaCuentas.textContent = this.mensajeCuentas;
    cuerpo.appendChild(listaCuentas);
    cuerpo.appendChild(crearBoton("Refrescar", async () => {
      const r = await this.llamarHttp("/auth/admin/listar-cuentas", {});
      if (!r.ok) {
        this.mensajeCuentas = r.datos?.error ?? "error";
      } else {
        this.mensajeCuentas = (r.datos.cuentas as Array<{ usuario: string; rol: string; mapaId: string | null }>)
          .map((c) => `${c.usuario} — ${c.rol}${c.mapaId ? ` (${c.mapaId})` : ""}`)
          .join("\n");
      }
      this.render();
    }));
  }
}
