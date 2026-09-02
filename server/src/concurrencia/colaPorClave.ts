/**
 * Cola de exclusión mutua por clave — cierra la clase de bugs que encontró
 * el testeo de concurrencia de 2026-09-01 (varios jugadores/sesiones
 * solapando el mismo mensaje sobre el mismo recurso): Colyseus NO serializa
 * handlers `onMessage` async entre sí (ver `Room._onMessage`, llama al
 * callback sin esperarlo) — en cuanto un handler llega a su primer `await`,
 * el bucle de eventos puede procesar el SIGUIENTE mensaje (de otro cliente,
 * o del mismo cliente reenviando) antes de que el primero reanude. Cualquier
 * handler con el patrón "lee estado en memoria → await → escribe estado en
 * memoria" (p. ej. `viva.extra`) pierde la escritura del primero si un
 * segundo mensaje para la MISMA clave se cuela en medio — visto en vivo con
 * `produccion:recolectar` (duplicaba lo cosechado) y cofres recién
 * colocados (perdían el primer ítem metido).
 *
 * Uso: `cola.ejecutar(construccionId, () => manejarAlgo(...))` — llamadas
 * con la MISMA clave se ejecutan una tras otra (nunca solapadas); llamadas
 * con clave distinta no se bloquean entre sí, así que un cofre no frena a
 * otro. No es una cola global de la room (eso sí penalizaría el resto del
 * juego, p. ej. `input` de movimiento a 30hz) — cada clave tiene su propia
 * fila, y las filas vacías no dejan rastro (self-cleaning vía WeakMap-like
 * borrado explícito tras la última promesa).
 */
export class ColaPorClave {
  private colas = new Map<string, Promise<unknown>>();

  ejecutar<T>(clave: string | number, tarea: () => Promise<T>): Promise<T> {
    const k = String(clave);
    const anterior = this.colas.get(k) ?? Promise.resolve();
    // corre DESPUÉS de la anterior, se haya resuelto o rechazado — un
    // rechazo (p. ej. un `throw` de validación) nunca debe atascar la cola
    // para los siguientes mensajes de la misma clave.
    const actual = anterior.then(tarea, tarea);
    // limpia la entrada cuando esta es la última tarea encolada para la
    // clave, para no acumular una fila por cada construcción tocada alguna
    // vez en la vida de la room.
    const marcador = actual.then(
      () => undefined,
      () => undefined,
    );
    this.colas.set(k, marcador);
    marcador.then(() => {
      if (this.colas.get(k) === marcador) this.colas.delete(k);
    });
    return actual;
  }
}
