/**
 * Login de admin — PLACEHOLDER de testeo (docs/GDD_Admin.md, pedido
 * 2026-08-30: login dual, usuario/contraseña propios O Twitch ya vinculado
 * — este panel es la mitad usuario/contraseña; la de Twitch reusa el botón
 * "Conectar con Twitch" que ya existe, ver game.ts). Simple formulario:
 * POST /auth/admin/login (rutasAdmin.ts, sin sesión Colyseus todavía en
 * ese punto) y, si sale bien, `onLoginOk(token)` — game.ts guarda el token
 * en sessionStorage y recarga la página para que el join lo mande como
 * `adminSession` (mismo ciclo que el login de Twitch tras el redirect).
 */
export interface OpcionesPanelLoginAdmin {
  contenedor: HTMLElement;
  serverUrlHttp: string;
  onLoginOk(token: string): void;
}

export class PanelLoginAdmin {
  private raiz: HTMLDivElement;
  private enviando = false;

  constructor(private opciones: OpcionesPanelLoginAdmin) {
    this.raiz = document.createElement("div");
    this.raiz.style.position = "absolute";
    this.raiz.style.left = "16px";
    this.raiz.style.top = "56px";
    this.raiz.style.background = "rgba(16,16,24,0.88)";
    this.raiz.style.color = "#e0e0f0";
    this.raiz.style.font = "12px sans-serif";
    this.raiz.style.padding = "8px 10px";
    this.raiz.style.borderRadius = "6px";
    this.raiz.style.border = "1px solid #4a4a6a";
    opciones.contenedor.appendChild(this.raiz);
    this.render();
  }

  private render() {
    this.raiz.innerHTML = "";

    const titulo = document.createElement("div");
    titulo.style.marginBottom = "4px";
    titulo.style.opacity = "0.85";
    titulo.textContent = "Login de admin (jarl/superadmin)";
    this.raiz.appendChild(titulo);

    const inputUsuario = document.createElement("input");
    inputUsuario.placeholder = "usuario";
    inputUsuario.style.display = "block";
    inputUsuario.style.marginBottom = "4px";
    inputUsuario.style.width = "140px";
    this.raiz.appendChild(inputUsuario);

    const inputPassword = document.createElement("input");
    inputPassword.type = "password";
    inputPassword.placeholder = "contraseña";
    inputPassword.style.display = "block";
    inputPassword.style.marginBottom = "4px";
    inputPassword.style.width = "140px";
    this.raiz.appendChild(inputPassword);

    const errorTexto = document.createElement("div");
    errorTexto.style.color = "#ff9090";
    errorTexto.style.marginBottom = "4px";
    errorTexto.style.maxWidth = "160px";
    this.raiz.appendChild(errorTexto);

    const boton = document.createElement("button");
    boton.textContent = "Entrar";
    const enviar = async () => {
      if (this.enviando || !inputUsuario.value || !inputPassword.value) return;
      this.enviando = true;
      errorTexto.textContent = "";
      try {
        const r = await fetch(`${this.opciones.serverUrlHttp}/auth/admin/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usuario: inputUsuario.value, password: inputPassword.value }),
        });
        if (!r.ok) {
          const cuerpo = (await r.json().catch(() => null)) as { error?: string } | null;
          errorTexto.textContent = cuerpo?.error ?? "no se pudo iniciar sesión";
          return;
        }
        const datos = (await r.json()) as { token: string };
        this.opciones.onLoginOk(datos.token);
      } catch {
        errorTexto.textContent = "no se pudo conectar con el servidor";
      } finally {
        this.enviando = false;
      }
    };
    boton.onclick = () => void enviar();
    inputPassword.onkeydown = (e) => { if (e.key === "Enter") void enviar(); };
    this.raiz.appendChild(boton);
  }
}
