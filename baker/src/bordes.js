"use strict";

// Etiquetado de bordes de mapa (GDD sección 1): cada lado declara su tipo y
// nombre, listo para enlazar a un mapa futuro sin tocar nada de lo horneado.
function normalizarBordes(configBordes) {
  const porDefecto = { tipo: "cerrado", nombre: null };
  return {
    norte: { ...porDefecto, ...(configBordes?.norte || {}) },
    sur: { ...porDefecto, ...(configBordes?.sur || {}) },
    este: { ...porDefecto, ...(configBordes?.este || {}) },
    oeste: { ...porDefecto, ...(configBordes?.oeste || {}) },
  };
}

module.exports = { normalizarBordes };
