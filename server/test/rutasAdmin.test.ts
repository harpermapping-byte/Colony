// Tests de admin/rutasAdmin.ts (pedido 2026-08-30, login de admin por HTTP).
// BD_RUTA=":memory:" ANTES de cualquier import que toque bdCompartida —
// node --test aísla cada archivo de test en su propio proceso (mismo
// criterio que anatomiaBd.test.ts usa `new AlmacenDatos(":memory:")` para
// el motor SQLite directo; aquí en cambio pasa por el singleton
// obtenerBdCompartida() porque rutasAdmin.ts, igual que en producción, lo
// usa a través de ese único punto). Ejecutar: npm test desde server/.
process.env.BD_RUTA = ":memory:";

import { test } from "node:test";
import * as assert from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { manejarPeticionAdmin } from "../src/admin/rutasAdmin";
import { obtenerBdCompartida } from "../src/datos/bdCompartida";
import { hashPassword } from "../src/admin/passwordHash";
import { crearSesionAdmin, resolverSesionAdmin } from "../src/admin/adminAuth";

function crearServidorDePrueba(): Promise<{ url: string; cerrar: () => Promise<void> }> {
  return new Promise((resolve) => {
    const servidor = createServer((req, res) => {
      if (manejarPeticionAdmin(req, res)) return;
      res.writeHead(404).end();
    });
    servidor.listen(0, () => {
      const { port } = servidor.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        cerrar: () => new Promise((r) => servidor.close(() => r())),
      });
    });
  });
}

function postJson(url: string, ruta: string, cuerpo: unknown) {
  return fetch(`${url}${ruta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

test("POST /auth/admin/login: credenciales correctas devuelven token + identidad", async () => {
  const bd = await obtenerBdCompartida();
  await bd.crearCuentaAdmin({ usuario: "Ragnar", passwordHash: hashPassword("test1234"), twitchLogin: null, rol: "jarl", mapaId: "principal" });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await postJson(url, "/auth/admin/login", { usuario: "Ragnar", password: "test1234" });
    assert.strictEqual(r.status, 200);
    const cuerpo = (await r.json()) as { token: string; usuario: string; rol: string; mapaId: string | null };
    assert.strictEqual(cuerpo.usuario, "Ragnar");
    assert.strictEqual(cuerpo.rol, "jarl");
    assert.strictEqual(cuerpo.mapaId, "principal");
    assert.ok(cuerpo.token);
    assert.deepStrictEqual(resolverSesionAdmin(cuerpo.token), { usuario: "Ragnar", rol: "jarl", mapaId: "principal" });
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/login: contraseña incorrecta -> 401", async () => {
  const bd = await obtenerBdCompartida();
  await bd.crearCuentaAdmin({ usuario: "Bjorn", passwordHash: hashPassword("correcta"), twitchLogin: null, rol: "jarl", mapaId: "principal" });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await postJson(url, "/auth/admin/login", { usuario: "Bjorn", password: "incorrecta" });
    assert.strictEqual(r.status, 401);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/login: usuario inexistente -> 401 (mismo código que contraseña incorrecta)", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await postJson(url, "/auth/admin/login", { usuario: "nadie", password: "loquesea" });
    assert.strictEqual(r.status, 401);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/login: cuenta solo-Twitch (password_hash null) rechaza login por contraseña", async () => {
  const bd = await obtenerBdCompartida();
  await bd.crearCuentaAdmin({ usuario: "SoloTwitch", passwordHash: null, twitchLogin: "solotwitch_tv", rol: "superadmin", mapaId: null });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await postJson(url, "/auth/admin/login", { usuario: "SoloTwitch", password: "cualquiera" });
    assert.strictEqual(r.status, 401);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/login: falta usuario o password -> 400", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await postJson(url, "/auth/admin/login", { usuario: "Ragnar" });
    assert.strictEqual(r.status, 400);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/cambiar-password: cambia la contraseña y fuerza relogin (token viejo muere)", async () => {
  const bd = await obtenerBdCompartida();
  await bd.crearCuentaAdmin({ usuario: "Cambia", passwordHash: hashPassword("vieja123"), twitchLogin: null, rol: "jarl", mapaId: "principal" });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const login = await postJson(url, "/auth/admin/login", { usuario: "Cambia", password: "vieja123" });
    const { token } = (await login.json()) as { token: string };

    const cambio = await postJson(url, "/auth/admin/cambiar-password", { token, passwordActual: "vieja123", passwordNueva: "nueva456" });
    assert.strictEqual(cambio.status, 200);

    assert.strictEqual(resolverSesionAdmin(token), null, "el token usado para cambiar la contraseña queda invalidado");

    const loginViejo = await postJson(url, "/auth/admin/login", { usuario: "Cambia", password: "vieja123" });
    assert.strictEqual(loginViejo.status, 401);

    const loginNuevo = await postJson(url, "/auth/admin/login", { usuario: "Cambia", password: "nueva456" });
    assert.strictEqual(loginNuevo.status, 200);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/cambiar-password: contraseña actual incorrecta -> 401, no cambia nada", async () => {
  const bd = await obtenerBdCompartida();
  await bd.crearCuentaAdmin({ usuario: "Protegido", passwordHash: hashPassword("correcta1"), twitchLogin: null, rol: "jarl", mapaId: "principal" });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const login = await postJson(url, "/auth/admin/login", { usuario: "Protegido", password: "correcta1" });
    const { token } = (await login.json()) as { token: string };

    const cambio = await postJson(url, "/auth/admin/cambiar-password", { token, passwordActual: "incorrecta", passwordNueva: "nueva456" });
    assert.strictEqual(cambio.status, 401);
    assert.ok(resolverSesionAdmin(token), "el token sigue vivo, el cambio falló y no debe invalidar nada");
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/cambiar-password: passwordNueva demasiado corta -> 400", async () => {
  const bd = await obtenerBdCompartida();
  await bd.crearCuentaAdmin({ usuario: "Corto", passwordHash: hashPassword("correcta1"), twitchLogin: null, rol: "jarl", mapaId: "principal" });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const login = await postJson(url, "/auth/admin/login", { usuario: "Corto", password: "correcta1" });
    const { token } = (await login.json()) as { token: string };
    const cambio = await postJson(url, "/auth/admin/cambiar-password", { token, passwordActual: "correcta1", passwordNueva: "abc" });
    assert.strictEqual(cambio.status, 400);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/cambiar-password: token inválido -> 401", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await postJson(url, "/auth/admin/cambiar-password", { token: "esto_no_existe", passwordActual: "x", passwordNueva: "nueva456" });
    assert.strictEqual(r.status, 401);
  } finally {
    await cerrar();
  }
});

test("POST /auth/admin/cambiar-password: cuenta solo-Twitch sin contraseña puede ponerse una por primera vez sin passwordActual", async () => {
  const bd = await obtenerBdCompartida();
  const cuenta = await bd.crearCuentaAdmin({ usuario: "PrimeraVez", passwordHash: null, twitchLogin: "primeravez_tv", rol: "superadmin", mapaId: null });
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const token = crearSesionAdmin({ usuario: cuenta.usuario, rol: cuenta.rol, mapaId: cuenta.mapaId });
    const cambio = await postJson(url, "/auth/admin/cambiar-password", { token, passwordNueva: "nuevaClave1" });
    assert.strictEqual(cambio.status, 200);
    const login = await postJson(url, "/auth/admin/login", { usuario: "PrimeraVez", password: "nuevaClave1" });
    assert.strictEqual(login.status, 200);
  } finally {
    await cerrar();
  }
});

test("rutas /auth/admin/* con método GET no se manejan (deja pasar al llamante)", async () => {
  const { url, cerrar } = await crearServidorDePrueba();
  try {
    const r = await fetch(`${url}/auth/admin/login`, { method: "GET" });
    assert.strictEqual(r.status, 404, "el servidor de prueba responde 404 cuando manejarPeticionAdmin no lo maneja (GET no es POST)");
  } finally {
    await cerrar();
  }
});
