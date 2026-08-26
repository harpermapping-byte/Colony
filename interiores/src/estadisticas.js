"use strict";

// Sistema de funcionalidad/estadísticas — sección 9 del pedido de
// integración. Cada elemento puede declarar `aportes: {estadistica: valor}`
// en elementos.json; esta función solo suma esos aportes sobre lo que
// realmente se colocó en la sala. Totalmente dirigido por datos: añadir una
// estadística nueva (o cambiar cuánto aporta una pieza) es editar el
// catálogo, no tocar este archivo. Una sala vacía (amueblado:"vacio", o un
// tipoSala sin ningún elemento colocado) da correctamente `{}` — el tipo de
// sala nunca deja de ser válido por no tener mobiliario (sección 8).
function calcularEstadisticas(colocados) {
  const totales = {};
  for (const item of colocados) {
    if (!item.aportes) continue;
    for (const [estadistica, valor] of Object.entries(item.aportes)) {
      totales[estadistica] = (totales[estadistica] || 0) + valor;
    }
  }
  return totales;
}

module.exports = { calcularEstadisticas };
