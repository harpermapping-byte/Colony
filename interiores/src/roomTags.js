"use strict";

// Diccionario global de RoomTags — capa de categorización nueva y aditiva
// por encima de `categoria` (tipos_sala.json) y `tiposSalaValidos`
// (elementos.json), que siguen existiendo sin cambios. Un tipo de sala
// declara qué tags lleva (`tipos_sala.json` campo `tags`); un mueble
// declara qué tags admite (`elementos.json` campo `allowedRoomTags`) — así
// una pieza nueva se puede marcar "vale para cualquier COMUN_VIVIENDA" en
// vez de tener que listar cada dormitorio_* uno a uno a mano.

const RoomTags = Object.freeze({
  // Categorías comunes
  COMUN_VIVIENDA: "COMUN_VIVIENDA",
  COMUN_COMEDOR: "COMUN_COMEDOR",
  COMUN_COCINA: "COMUN_COCINA",
  COMUN_ALMACEN: "COMUN_ALMACEN",
  COMUN_BAÑO: "COMUN_BAÑO",
  COMUN_TALLER: "COMUN_TALLER",
  COMUN_TIENDA: "COMUN_TIENDA",
  COMUN_MILITAR: "COMUN_MILITAR",
  COMUN_EXTERIOR_CUBIERTO: "COMUN_EXTERIOR_CUBIERTO",
  // Categorías no comunes / especializadas
  NOCOMUN_BIBLIOTECA: "NOCOMUN_BIBLIOTECA",
  NOCOMUN_IGLESIA_RELIGION: "NOCOMUN_IGLESIA_RELIGION",
  NOCOMUN_SERVICIO_PUBLICO: "NOCOMUN_SERVICIO_PUBLICO",
  NOCOMUN_OFICIAL_GOBIERNO: "NOCOMUN_OFICIAL_GOBIERNO",
  NOCOMUN_GRANJA_ANIMALES: "NOCOMUN_GRANJA_ANIMALES",
  NOCOMUN_ALQUIMIA_MAGIA: "NOCOMUN_ALQUIMIA_MAGIA",
  NOCOMUN_MAZMORRA_TORTURA: "NOCOMUN_MAZMORRA_TORTURA",
  NOCOMUN_CRIPTA_CEMENTERIO: "NOCOMUN_CRIPTA_CEMENTERIO",
  NOCOMUN_MINERIA: "NOCOMUN_MINERIA",
  NOCOMUN_PORTUARIO: "NOCOMUN_PORTUARIO",
});

// Modificadores especiales (calidad/ficción) — no son un tag de SALA, son
// un modificador que puede llevar tanto una sala (riquezaMinima:"noble" ya
// cubre la parte de calidad, esto es la parte narrativa/temática) como un
// MUEBLE (`specialModifier` en elementos.json).
const SpecialModifiers = Object.freeze({
  ESPECIAL_NOBLEZA: "ESPECIAL_NOBLEZA",
  ESPECIAL_ENEMIGO_SALVAJE: "ESPECIAL_ENEMIGO_SALVAJE",
  ESPECIAL_TESORO: "ESPECIAL_TESORO",
});

// Tipo de anclaje de un mueble — dónde y cómo se busca sitio para él
// (colocarElementos.js sección "pipeline de fases"). CHILD_SLOT significa
// que esta pieza NUNCA se coloca por sí sola buscando hueco en la sala:
// solo aparece enganchada a un `childSlots` de un padre ya colocado.
const AnchorType = Object.freeze({
  WALL_BACK: "WALL_BACK",
  CORNER: "CORNER",
  WALL_HIGH_FLOATING: "WALL_HIGH_FLOATING",
  FREE_CENTER: "FREE_CENTER",
  CHILD_SLOT: "CHILD_SLOT",
});

// Fases del pipeline de colocación — 1 se coloca antes que 2, 2 antes que
// 3, en las tres capas de amueblado (GDD sección 1) donde aplique.
const Priority = Object.freeze({
  DOMINANTE: 1,
  SECUNDARIO: 2,
  DECORACION: 3,
});

module.exports = { RoomTags, SpecialModifiers, AnchorType, Priority };
