/**
 * Cuentas de admin iniciales (docs/GDD_Admin.md, pedido 2026-08-30: "una
 * contraseña que creamos ahora y ya se cambiará, de test") — 1 jarl del
 * mapa "principal" + 1 superadmin, con contraseña de test conocida.
 *
 * Se siembran UNA sola vez: si `admin_cuentas` ya tiene alguna fila (el
 * streamer ya cambió la contraseña, o ya hay más cuentas creadas a mano),
 * esta función no hace NADA — nunca pisa una cuenta existente. Cambiar la
 * contraseña: POST /auth/admin/cambiar-password (rutasAdmin.ts).
 */
import { IAlmacenDatos } from "../datos/bd";
import { hashPassword } from "./passwordHash";

export const USUARIO_JARL_SEED = "jarl";
export const PASSWORD_JARL_SEED = "colony-jarl-2026";
export const USUARIO_SUPERADMIN_SEED = "superadmin";
export const PASSWORD_SUPERADMIN_SEED = "colony-superadmin-2026";
export const MAPA_ID_PRINCIPAL = "principal";

export async function sembrarCuentasAdminIniciales(bd: IAlmacenDatos): Promise<void> {
  const existentes = await bd.listarCuentasAdmin();
  if (existentes.length > 0) return;

  await bd.crearCuentaAdmin({
    usuario: USUARIO_JARL_SEED,
    passwordHash: hashPassword(PASSWORD_JARL_SEED),
    twitchLogin: null,
    rol: "jarl",
    mapaId: MAPA_ID_PRINCIPAL,
  });
  await bd.crearCuentaAdmin({
    usuario: USUARIO_SUPERADMIN_SEED,
    passwordHash: hashPassword(PASSWORD_SUPERADMIN_SEED),
    twitchLogin: null,
    rol: "superadmin",
    mapaId: null,
  });

  console.log(
    `[admin] Cuentas de test creadas — jarl: usuario="${USUARIO_JARL_SEED}" password="${PASSWORD_JARL_SEED}" (mapa "${MAPA_ID_PRINCIPAL}"), ` +
      `superadmin: usuario="${USUARIO_SUPERADMIN_SEED}" password="${PASSWORD_SUPERADMIN_SEED}". ` +
      `CAMBIA estas contraseñas cuanto antes con POST /auth/admin/cambiar-password.`,
  );
}
