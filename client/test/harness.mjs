/**
 * Harness para tests E2E — proporciona iniciarServidor/detenerServidor
 * El servidor ya corre en background, así que estos son no-ops
 */

export async function iniciarServidor() {
  // El servidor ya está corriendo en port 2567
  // Solo devolvemos un objeto placeholder
  return { pid: null };
}

export async function detenerServidor(server) {
  // No hacer nada, el servidor sigue corriendo en background
}
