/**
 * Hash de contraseñas — PURO (sin BD/red), pedido 2026-08-30 (login de admin
 * por usuario/contraseña, además del OAuth de Twitch ya existente). Sin
 * dependencia nueva: `server/package.json` no trae bcrypt/argon2 (confirmado
 * al investigar), así que se usa `crypto.scrypt` nativo de Node — mismo
 * criterio "sin librerías nuevas si el propio runtime ya lo resuelve" que el
 * resto del proyecto (p.ej. `crypto.randomBytes` ya usado en oauthLogin.ts
 * para los tokens de sesión).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const LONGITUD_HASH = 64;

/** `salt:hash`, ambos en hex — un string único que se guarda tal cual en `admin_cuentas.password_hash`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, LONGITUD_HASH).toString("hex");
  return `${salt}:${hash}`;
}

/** Compara con `timingSafeEqual` (no `===`) para no filtrar cuánto coincide por timing. `false` ante cualquier formato inesperado, nunca lanza. */
export function verificarPassword(password: string, almacenado: string): boolean {
  const [salt, hashGuardado] = almacenado.split(":");
  if (!salt || !hashGuardado) return false;
  const hashGuardadoBuf = Buffer.from(hashGuardado, "hex");
  if (hashGuardadoBuf.length !== LONGITUD_HASH) return false;
  const hashCalculado = scryptSync(password, salt, LONGITUD_HASH);
  return timingSafeEqual(hashCalculado, hashGuardadoBuf);
}
