/**
 * Panel de jarl / superadmin — PLACEHOLDER de testeo (docs/GDD_Admin.md,
 * pedido 2026-08-30: "el panel de superadmin es como el de jarl pero algún
 * comando más"). Herramientas jarl-only que YA existían como mensajes de
 * room sin ningún UI (PvP global, simular eventos/comandos de Twitch de
 * prueba) + cambiar la propia contraseña. Con `esSuperadmin`, añade la
 * gestión de cuentas de admin (crear-cuenta/asignar-jarl/listar-cuentas,
 * rutasAdmin.ts) — comandos que solo tienen sentido para quien ve TODOS
 * los mapas, nunca para un jarl de uno solo.
 */
export interface OpcionesPanelJarl {
  contenedor: HTMLElement;
  esSuperadmin: boolean;
  serverUrlHttp: string;
  adminToken: string;
  pvpFijar(on: boolean): void;
  simularCanje(tipo: "bueno" | "malo"): void;
  simularComando(comando: string): void;
  forzarDirecto(on: boolean): void;
}

export class PanelJarl {
  private raiz: HTMLDivElement;
  private pvpOn: boolean | null = null;
  private mensajeCuentas = "";

  constructor(private opciones: OpcionesPanelJarl) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.right = "16px";
    this.raiz.style.top = "16px";
    this.raiz.style.background = "rgba(24,18,10,0.9)";
    this.raiz.style.color = "#f0e8d8";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "10px 14px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #8a6a2a";
    this.raiz.style.minWidth = "220px";
    this.raiz.style.maxHeight = "80vh";
    this.raiz.style.overflowY = "auto";
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  actualizarPvp(on: boolean) {
    this.pvpOn = on;
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

  private render() {
    this.raiz.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.fontWeight = "bold";
    titulo.style.marginBottom = "8px";
    titulo.textContent = this.opciones.esSuperadmin ? "⭐ Panel de superadmin" : "👑 Panel de jarl";
    this.raiz.appendChild(titulo);

    // --- PvP global (docs/GDD_PvP.md) ---
    const filaPvp = document.createElement("div");
    filaPvp.style.marginBottom = "8px";
    const estadoPvp = this.pvpOn === null ? "?" : this.pvpOn ? "ON" : "OFF";
    filaPvp.textContent = `PvP global: ${estadoPvp} `;
    const btnPvpOn = document.createElement("button");
    btnPvpOn.textContent = "Activar";
    btnPvpOn.onclick = () => this.opciones.pvpFijar(true);
    filaPvp.appendChild(btnPvpOn);
    const btnPvpOff = document.createElement("button");
    btnPvpOff.textContent = "Desactivar";
    btnPvpOff.style.marginLeft = "4px";
    btnPvpOff.onclick = () => this.opciones.pvpFijar(false);
    filaPvp.appendChild(btnPvpOff);
    this.raiz.appendChild(filaPvp);

    // --- Pruebas de Twitch (docs/GDD_Twitch.md) — mismos comandos que el bot real, sin depender de un directo activo ---
    const separadorTwitch = document.createElement("div");
    separadorTwitch.style.marginTop = "6px";
    separadorTwitch.style.paddingTop = "6px";
    separadorTwitch.style.borderTop = "1px solid #8a6a2a";
    separadorTwitch.style.opacity = "0.85";
    separadorTwitch.textContent = "Pruebas de Twitch:";
    this.raiz.appendChild(separadorTwitch);

    const filaCanje = document.createElement("div");
    filaCanje.style.margin = "4px 0";
    const btnBueno = document.createElement("button");
    btnBueno.textContent = "Simular canje bueno";
    btnBueno.onclick = () => this.opciones.simularCanje("bueno");
    filaCanje.appendChild(btnBueno);
    const btnMalo = document.createElement("button");
    btnMalo.textContent = "malo";
    btnMalo.style.marginLeft = "4px";
    btnMalo.onclick = () => this.opciones.simularCanje("malo");
    filaCanje.appendChild(btnMalo);
    this.raiz.appendChild(filaCanje);

    const filaComando = document.createElement("div");
    filaComando.style.margin = "4px 0";
    const inputComando = document.createElement("input");
    inputComando.placeholder = "!curar / !comer / !beber / !cagar";
    inputComando.style.width = "140px";
    filaComando.appendChild(inputComando);
    const btnComando = document.createElement("button");
    btnComando.textContent = "Enviar";
    btnComando.style.marginLeft = "4px";
    btnComando.onclick = () => { if (inputComando.value) this.opciones.simularComando(inputComando.value); };
    filaComando.appendChild(btnComando);
    this.raiz.appendChild(filaComando);

    const filaDirecto = document.createElement("div");
    filaDirecto.style.margin = "4px 0";
    const btnDirectoOn = document.createElement("button");
    btnDirectoOn.textContent = "Forzar directo ON";
    btnDirectoOn.onclick = () => this.opciones.forzarDirecto(true);
    filaDirecto.appendChild(btnDirectoOn);
    const btnDirectoOff = document.createElement("button");
    btnDirectoOff.textContent = "OFF";
    btnDirectoOff.style.marginLeft = "4px";
    btnDirectoOff.onclick = () => this.opciones.forzarDirecto(false);
    filaDirecto.appendChild(btnDirectoOff);
    this.raiz.appendChild(filaDirecto);

    // --- Cambiar mi contraseña ---
    const separadorPassword = document.createElement("div");
    separadorPassword.style.marginTop = "6px";
    separadorPassword.style.paddingTop = "6px";
    separadorPassword.style.borderTop = "1px solid #8a6a2a";
    separadorPassword.style.opacity = "0.85";
    separadorPassword.textContent = "Cambiar mi contraseña:";
    this.raiz.appendChild(separadorPassword);

    const inputActual = document.createElement("input");
    inputActual.type = "password";
    inputActual.placeholder = "contraseña actual";
    inputActual.style.display = "block";
    inputActual.style.margin = "4px 0";
    inputActual.style.width = "160px";
    this.raiz.appendChild(inputActual);

    const inputNueva = document.createElement("input");
    inputNueva.type = "password";
    inputNueva.placeholder = "contraseña nueva";
    inputNueva.style.display = "block";
    inputNueva.style.margin = "4px 0";
    inputNueva.style.width = "160px";
    this.raiz.appendChild(inputNueva);

    const mensajePassword = document.createElement("div");
    mensajePassword.style.opacity = "0.8";
    this.raiz.appendChild(mensajePassword);

    const btnCambiarPassword = document.createElement("button");
    btnCambiarPassword.textContent = "Cambiar";
    btnCambiarPassword.onclick = async () => {
      const r = await this.llamarHttp("/auth/admin/cambiar-password", {
        passwordActual: inputActual.value,
        passwordNueva: inputNueva.value,
      });
      mensajePassword.textContent = r.ok ? "Contraseña cambiada — vuelve a loguearte." : (r.datos?.error ?? "error");
    };
    this.raiz.appendChild(btnCambiarPassword);

    if (this.opciones.esSuperadmin) this.renderExtrasSuperadmin();
  }

  private renderExtrasSuperadmin() {
    const separador = document.createElement("div");
    separador.style.marginTop = "8px";
    separador.style.paddingTop = "6px";
    separador.style.borderTop = "1px solid #8a6a2a";
    separador.style.fontWeight = "bold";
    separador.textContent = "Gestión de cuentas de admin:";
    this.raiz.appendChild(separador);

    const inputUsuarioNuevo = document.createElement("input");
    inputUsuarioNuevo.placeholder = "usuario nuevo";
    inputUsuarioNuevo.style.display = "block";
    inputUsuarioNuevo.style.margin = "4px 0";
    inputUsuarioNuevo.style.width = "160px";
    this.raiz.appendChild(inputUsuarioNuevo);

    const inputPasswordNuevo = document.createElement("input");
    inputPasswordNuevo.type = "password";
    inputPasswordNuevo.placeholder = "contraseña";
    inputPasswordNuevo.style.display = "block";
    inputPasswordNuevo.style.margin = "4px 0";
    inputPasswordNuevo.style.width = "160px";
    this.raiz.appendChild(inputPasswordNuevo);

    const selectRol = document.createElement("select");
    for (const rol of ["jarl", "superadmin"]) {
      const opt = document.createElement("option");
      opt.value = rol;
      opt.textContent = rol;
      selectRol.appendChild(opt);
    }
    selectRol.style.display = "block";
    selectRol.style.margin = "4px 0";
    this.raiz.appendChild(selectRol);

    const mensajeCrear = document.createElement("div");
    mensajeCrear.style.opacity = "0.8";
    this.raiz.appendChild(mensajeCrear);

    const btnCrear = document.createElement("button");
    btnCrear.textContent = "Crear cuenta";
    btnCrear.onclick = async () => {
      const r = await this.llamarHttp("/auth/admin/crear-cuenta", {
        usuario: inputUsuarioNuevo.value,
        password: inputPasswordNuevo.value,
        rol: selectRol.value,
      });
      mensajeCrear.textContent = r.ok ? `Cuenta "${r.datos.usuario}" creada (sin mapa asignado).` : (r.datos?.error ?? "error");
    };
    this.raiz.appendChild(btnCrear);

    const separadorAsignar = document.createElement("div");
    separadorAsignar.style.marginTop = "6px";
    separadorAsignar.textContent = "Asignar jarl de un mapa (1 jarl por mapa):";
    this.raiz.appendChild(separadorAsignar);

    const inputMapaId = document.createElement("input");
    inputMapaId.placeholder = "mapaId (ej. principal)";
    inputMapaId.style.display = "block";
    inputMapaId.style.margin = "4px 0";
    inputMapaId.style.width = "160px";
    this.raiz.appendChild(inputMapaId);

    const inputUsuarioAsignar = document.createElement("input");
    inputUsuarioAsignar.placeholder = "usuario";
    inputUsuarioAsignar.style.display = "block";
    inputUsuarioAsignar.style.margin = "4px 0";
    inputUsuarioAsignar.style.width = "160px";
    this.raiz.appendChild(inputUsuarioAsignar);

    const mensajeAsignar = document.createElement("div");
    mensajeAsignar.style.opacity = "0.8";
    this.raiz.appendChild(mensajeAsignar);

    const btnAsignar = document.createElement("button");
    btnAsignar.textContent = "Asignar";
    btnAsignar.onclick = async () => {
      const r = await this.llamarHttp("/auth/admin/asignar-jarl", { mapaId: inputMapaId.value, usuario: inputUsuarioAsignar.value });
      mensajeAsignar.textContent = r.ok ? "Asignado." : (r.datos?.error ?? "error");
    };
    this.raiz.appendChild(btnAsignar);

    const separadorLista = document.createElement("div");
    separadorLista.style.marginTop = "6px";
    separadorLista.textContent = "Cuentas:";
    this.raiz.appendChild(separadorLista);

    const listaCuentas = document.createElement("div");
    listaCuentas.style.fontSize = "11px";
    listaCuentas.style.whiteSpace = "pre-wrap";
    listaCuentas.textContent = this.mensajeCuentas;
    this.raiz.appendChild(listaCuentas);

    const btnListar = document.createElement("button");
    btnListar.textContent = "Refrescar";
    btnListar.onclick = async () => {
      const r = await this.llamarHttp("/auth/admin/listar-cuentas", {});
      if (!r.ok) {
        this.mensajeCuentas = r.datos?.error ?? "error";
      } else {
        this.mensajeCuentas = (r.datos.cuentas as Array<{ usuario: string; rol: string; mapaId: string | null }>)
          .map((c) => `${c.usuario} — ${c.rol}${c.mapaId ? ` (${c.mapaId})` : ""}`)
          .join("\n");
      }
      this.render();
    };
    this.raiz.appendChild(btnListar);
  }
}
