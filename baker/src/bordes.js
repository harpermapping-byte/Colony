"use strict";

// Etiquetado de bordes de mapa (GDD sección 1): cada lado declara su tipo y
// nombre, listo para enlazar a un mapa futuro sin tocar nada de lo horneado.
// tipo también sesga la elevación cerca de ese lado (ver PERFIL_BORDE en
// biomas.js): "mar_abierto" empuja hacia el mar, "montana"/"cerrado" hacia
// un muro de roca infranqueable, "tierra_abierta" apenas suaviza extremos.
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
