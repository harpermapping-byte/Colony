// E2E del sistema de admin (docs/GDD_Admin.md, pedido 2026-08-30: login
// dual jarl/superadmin, 1 jarl por mapa): arranca el servidor Colyseus
// REAL con BD en memoria (así que las cuentas de test de seedAdmin.ts se
// siembran solas), hace login HTTP real, se une con el token como
// adminSession y comprueba que la room reconoce (o no) los poderes de
// jarl según el mapa. Prueba el mecanismo entero de punta a punta —
// login HTTP -> token -> join Colyseus -> autorización real en la room —
// que los tests unitarios de rutasAdmin.ts/RoomExteriorBase.ts no pueden
// cubrir (no levantan una room real).
//   node test/admin.e2e.mjs
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "colyseus.js";

const dirCliente = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirServidor = join(dirCliente, "..", "server");
const PUERTO_WS = 2597;
const URL_HTTP = `http://localhost:${PUERTO_WS}`;

// Mismas constantes que server/src/admin/seedAdmin.ts — el server las
// siembra solo la PRIMERA vez que arranca con admin_cuentas vacía, que es
// justo el caso con BD_RUTA=":memory:" recién creada.
const USUARIO_JARL = "jarl";
const PASSWORD_JARL = "colony-jarl-2026";
const USUARIO_SUPERADMIN = "superadmin";
const PASSWORD_SUPERADMIN = "colony-superadmin-2026";

function lanzar(cmd, args, cwd, extraEnv = {}) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  p.stdout.on("data", (d) => process.stdout.write(`[servidor] ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`[servidor] ${d}`));
  return p;
}

const rutaDemo = join(dirCliente, "..", "assets", "mapas", "demo"); // basename "demo" != "principal" a propósito, ver punto 3
const servidor = lanzar("npx", ["tsx", "src/index.ts"], dirServidor, {
  PORT: String(PUERTO_WS),
  RUTA_MAPA: rutaDemo,
  BD_RUTA: ":memory:",
});
const matar = () => {
  try { process.kill(-servidor.pid, "SIGKILL"); } catch {}
  try { servidor.kill("SIGKILL"); } catch {}
};
process.on("exit", matar);

let fallos = 0;
function comprobar(nombre, ok, detalle) {
  console.log((ok ? "OK " : "FALLO ") + nombre + (detalle ? ` (${detalle})` : ""));
  if (!ok) fallos++;
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function esperarMensaje(room, tipo, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    room.onMessage(tipo, (msg) => { clearTimeout(timer); resolve(msg); });
  });
}

async function loginAdmin(usuario, password) {
  const r = await fetch(`${URL_HTTP}/auth/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, password }),
  });
  return { status: r.status, datos: await r.json().catch(() => null) };
}

try {
  await esperar(3000); // arranque del servidor (+ siembra de cuentas de test)

  // 1) Login del jarl de test sembrado.
  const loginJarl = await loginAdmin(USUARIO_JARL, PASSWORD_JARL);
  comprobar("login jarl de test -> 200 con rol/mapaId", loginJarl.status === 200 && loginJarl.datos.rol === "jarl" && loginJarl.datos.mapaId === "principal", JSON.stringify(loginJarl));
  const tokenJarl = loginJarl.datos?.token;

  // 2) Contraseña incorrecta -> 401.
  const loginMalo = await loginAdmin(USUARIO_JARL, "esto_no_es_la_clave");
  comprobar("login con contraseña incorrecta -> 401", loginMalo.status === 401, JSON.stringify(loginMalo));

  // 3) Unirse al hub de DEMO (asentamiento "demo") con el token del jarl
  // de "principal" — 1 jarl por mapa: en un mapa que no es el suyo NO debe
  // tener poderes de jarl (esJarlAqui:false), y pvp:fijar debe rechazarlo.
  const clienteJarl = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomJarlForaneo = await clienteJarl.joinOrCreate("hub", { name: "JarlDePrincipal", adminSession: tokenJarl });
  const confirmacionForanea = await esperarMensaje(roomJarlForaneo, "admin:sesionConfirmada");
  comprobar(
    "jarl de 'principal' en el mapa 'demo': sesión confirmada pero esJarlAqui=false",
    confirmacionForanea?.rol === "jarl" && confirmacionForanea?.esJarlAqui === false,
    JSON.stringify(confirmacionForanea),
  );
  let errorPvpForaneo = esperarMensaje(roomJarlForaneo, "pvp:error");
  roomJarlForaneo.send("pvp:fijar", { on: true });
  comprobar("pvp:fijar de un jarl EN OTRO mapa se rechaza", (await errorPvpForaneo)?.motivo === "solo el jarl puede cambiar esto");

  // 4) Login + join del superadmin — esJarlAqui debe ser true en CUALQUIER
  // mapa, y pvp:fijar debe funcionar de verdad (recibe el broadcast).
  const loginSuper = await loginAdmin(USUARIO_SUPERADMIN, PASSWORD_SUPERADMIN);
  comprobar("login superadmin de test -> 200 con mapaId null", loginSuper.status === 200 && loginSuper.datos.rol === "superadmin" && loginSuper.datos.mapaId === null, JSON.stringify(loginSuper));
  const tokenSuper = loginSuper.datos?.token;

  const clienteSuper = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomSuper = await clienteSuper.joinOrCreate("hub", { name: "LaSuperadmin", adminSession: tokenSuper });
  const confirmacionSuper = await esperarMensaje(roomSuper, "admin:sesionConfirmada");
  comprobar("superadmin en el mapa 'demo': esJarlAqui=true", confirmacionSuper?.rol === "superadmin" && confirmacionSuper?.esJarlAqui === true, JSON.stringify(confirmacionSuper));

  let pvpActualizado = esperarMensaje(roomSuper, "pvp:actualizado");
  roomSuper.send("pvp:fijar", { on: true });
  comprobar("pvp:fijar del superadmin sí se aplica (broadcast pvp:actualizado)", (await pvpActualizado)?.on === true);
  // Lo deja como estaba para no dejar el mundo en PvP encendido tras el test.
  roomSuper.send("pvp:fijar", { on: false });
  await esperar(100);

  // 5) Gestión de cuentas — solo superadmin (rutasAdmin.ts).
  const rCrearSinPermiso = await fetch(`${URL_HTTP}/auth/admin/crear-cuenta`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenJarl, usuario: "IntentoJarl", password: "clave123456", rol: "jarl" }),
  });
  comprobar("crear-cuenta con token de JARL (no superadmin) -> 403", rCrearSinPermiso.status === 403, `status=${rCrearSinPermiso.status}`);

  const rCrear = await fetch(`${URL_HTTP}/auth/admin/crear-cuenta`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenSuper, usuario: "JarlDeDemo", password: "clave123456", rol: "jarl" }),
  });
  const datosCrear = await rCrear.json();
  comprobar("crear-cuenta con superadmin -> 200, nace sin mapa", rCrear.status === 200 && datosCrear.mapaId === null, JSON.stringify(datosCrear));

  const rAsignar = await fetch(`${URL_HTTP}/auth/admin/asignar-jarl`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenSuper, mapaId: "demo", usuario: "JarlDeDemo" }),
  });
  comprobar("asignar-jarl con superadmin -> 200", rAsignar.status === 200, `status=${rAsignar.status}`);

  // 6) El jarl RECIÉN asignado a "demo" ahora SÍ debe tener poderes ahí —
  // confirma que asignar-jarl (HTTP) se refleja de verdad en el siguiente
  // join (BD -> resolverSesionAdmin -> esJarlConSesionAdmin), no solo en teoría.
  const loginJarlDeDemo = await loginAdmin("JarlDeDemo", "clave123456");
  const clienteJarlDemo = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomJarlDemo = await clienteJarlDemo.joinOrCreate("hub", { name: "JarlDeDemoPJ", adminSession: loginJarlDeDemo.datos.token });
  const confirmacionJarlDemo = await esperarMensaje(roomJarlDemo, "admin:sesionConfirmada");
  comprobar("jarl recién asignado a 'demo' SÍ tiene esJarlAqui=true en 'demo'", confirmacionJarlDemo?.esJarlAqui === true, JSON.stringify(confirmacionJarlDemo));

  // 7) listar-cuentas trae las 3 cuentas y nunca expone el hash.
  const rListar = await fetch(`${URL_HTTP}/auth/admin/listar-cuentas`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenSuper }),
  });
  const datosListar = await rListar.json();
  const usuarios = (datosListar.cuentas ?? []).map((c) => c.usuario);
  comprobar(
    "listar-cuentas trae jarl+superadmin+JarlDeDemo, sin hash",
    [USUARIO_JARL, USUARIO_SUPERADMIN, "JarlDeDemo"].every((u) => usuarios.includes(u)) &&
      datosListar.cuentas.every((c) => !("passwordHash" in c)),
    JSON.stringify(datosListar),
  );

  // 8) Un jugador normal (sin adminSession) no recibe admin:sesionConfirmada
  // ni puede tocar pvp:fijar.
  const clienteNormal = new Client(`ws://localhost:${PUERTO_WS}`);
  const roomNormal = await clienteNormal.joinOrCreate("hub", { name: "JugadorNormal" });
  let confirmacionNormal = esperarMensaje(roomNormal, "admin:sesionConfirmada", 800);
  comprobar("jugador normal no recibe admin:sesionConfirmada", (await confirmacionNormal) === null);
  let errorPvpNormal = esperarMensaje(roomNormal, "pvp:error");
  roomNormal.send("pvp:fijar", { on: true });
  comprobar("pvp:fijar de un jugador normal se rechaza", (await errorPvpNormal)?.motivo === "solo el jarl puede cambiar esto");

  console.log(fallos === 0 ? "\n✅ admin.e2e: todo OK" : `\n❌ admin.e2e: ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
} catch (err) {
  console.error("admin.e2e reventó:", err);
  process.exit(1);
}
