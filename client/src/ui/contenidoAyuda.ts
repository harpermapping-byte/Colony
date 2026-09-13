/**
 * Contenido de la Guía rápida + Novedades (docs/GDD_UI_Paneles.md, pedido
 * streamer 2026-09-13: "un panel con un resumen de qué se puede hacer... y
 * un changelog que iremos actualizando, seguimos fase BETA... y en
 * Tutoriales que cuente un poco de cada mecánica"). Texto PARA EL JUGADOR
 * (breve, sin jerga de desarrollo) — la memoria técnica del proyecto sigue
 * viviendo en CLAUDE.md/docs/, esto es la versión "de cara al público" de
 * una pequeña parte de ella.
 *
 * `HISTORIAL_CAMBIOS` es el changelog: cada sesión que cierre una pasada
 * jugable de verdad añade UNA entrada nueva AL PRINCIPIO del array (más
 * reciente primero) — nunca se reescribe una entrada ya publicada, se
 * añade una nueva.
 */

export interface SeccionGuia {
  icono: string;
  titulo: string;
  texto: string;
}

export const SECCIONES_GUIA: SeccionGuia[] = [
  { icono: "🚶", titulo: "Moverte", texto: "WASD para andar, mantén Shift para correr — gasta estamina, pero se recupera sola en cuanto paras (más rápido quieto del todo, más despacio si sigues caminando). En el agua nadas solo; pulsa Q para bucear y E para volver a la superficie." },
  { icono: "🪓", titulo: "Recolectar", texto: "Clic o E sobre un árbol, roca, mineral o planta para recogerlo — necesitas la herramienta correspondiente EQUIPADA en la mano (hacha, pico...). La madera y el mineral caen al suelo cerca de ti: recógelos de ahí." },
  { icono: "🌾", titulo: "Agricultura", texto: "Clic en el suelo abre el menú para labrar, plantar semillas y cosechar. Las macetas y jardineras necesitan tierra (cávala con una pala) y agua (riega con un cubo o regadera llenos)." },
  { icono: "🔨", titulo: "Oficios y crafteo", texto: "Habla (tecla H) con el Maestro de Oficios de tu aldea para elegir hasta 2 oficios de los 10 disponibles. Craftea en la mesa correspondiente a cada oficio — cuanto más craftees, más sube tu nivel y más recetas desbloqueas." },
  { icono: "🏠", titulo: "Construcción", texto: "Pulsa B para abrir el modo construcción: coloca muebles, mesas de oficio y decoración en tu parcela. El jarl del pueblo reparte y gestiona las parcelas disponibles." },
  { icono: "⚔️", titulo: "Combate", texto: "Ataca fauna peligrosa, bandidos o enemigos de mazmorra — la pelea se resuelve en una arena táctica por turnos, moviéndote por casillas y usando golpes especiales según tu arma." },
  { icono: "🏹", titulo: "Caza", texto: "Haz clic sobre un animal para perseguirlo — corres más que la mayoría de las presas, síguelas hasta atraparlas y sueltan carne/materiales al caer." },
  { icono: "💰", titulo: "Economía", texto: "Gana Farycoins vendiendo en tu propio tenderete, comerciando con NPCs o craftea objetos de valor para revender. El jarl cobra un pequeño impuesto sobre las propiedades." },
  { icono: "🐴", titulo: "Mascotas y monturas", texto: "Doma animales para tenerlos como mascota — algunas especies pueden montarse o tirar de un carro. Los barcos te llevan por el agua y entre islas." },
  { icono: "🏰", titulo: "Gremios", texto: "Únete a un gremio o funda el tuyo: banco e inventario compartidos con el resto de miembros." },
  { icono: "💬", titulo: "Hablar con NPCs", texto: "Pulsa H junto a un aldeano para hablar con él — cada uno tiene su propia historia, oficio y personalidad, y recuerda lo que le has contado." },
  { icono: "🚪", titulo: "Viajar", texto: "Cruza las puertas marcadas de aldeas, ciudades, edificios y mazmorras para entrar en ellas — acércate y pulsa F, o haz clic en el cartel de la puerta si lo ves." },
  { icono: "❤️", titulo: "Vitales", texto: "Vigila tus barras de vida, estamina, hambre y sed (arriba a la izquierda). Come, bebe y duerme para mantenerlas llenas — si llegan a 0 empiezas a debilitarte." },
  { icono: "🎨", titulo: "Tu personaje", texto: "Al crear tu cuenta eliges sexo, morfología, peinado, piel y ojos — y lo que equipes (ropa, armas, herramientas) se ve puesto de verdad en tu personaje." },
];

export interface EntradaChangelog {
  fecha: string;
  cambios: string[];
}

/** Más reciente PRIMERO — añadir entradas nuevas al principio del array. */
export const HISTORIAL_CAMBIOS: EntradaChangelog[] = [
  {
    fecha: "2026-09-13",
    cambios: [
      "La estamina ya se recupera sola al parar de correr (antes se quedaba vacía).",
      "Los aldeanos ahora se ven trabajando de verdad (herrero martilleando, tabernero sirviendo...) y a veces charlan entre ellos.",
      "Nuevo mapa del mundo, reiniciado de cero con aldeas, una capital y un castillo nuevos.",
    ],
  },
  {
    fecha: "2026-09-12",
    cambios: [
      "El suelo tiene ahora mucho más detalle y variedad (briznas, guijarros...).",
      "Los nombres de NPCs, animales y jugadores solo se ven de cerca, o al hacer clic sobre ellos — el clic abre una ficha con su oficio, familia y ciudad.",
      "Más decoración real en calles y plazas de las ciudades (bancos, farolas, carretas, puestos de mercado...).",
    ],
  },
  {
    fecha: "2026-09-11",
    cambios: [
      "Nuevo mobiliario del carpintero: camas de varios tamaños, sofás, expositores que enseñan lo que guardan y lámparas que iluminan de verdad.",
      "Las macetas y jardineras ya necesitan tierra y riego reales para poder plantar.",
      "Panel de crafteo real en las mesas de oficio, con recetas, nivel e ingredientes visibles.",
      "Huellas en la nieve al caminar, y bordes verticales realistas en orillas de ríos y lagos.",
    ],
  },
  {
    fecha: "2026-09-10",
    cambios: [
      "Creador de personaje completo al registrar tu cuenta (sexo, morfología, pelo, piel, ojos).",
      "Los jugadores nuevos ya salen vestidos con ropa inicial en vez de desnudos.",
      "Las puertas de aldeas y ciudades ya se pueden cruzar de verdad.",
    ],
  },
  {
    fecha: "2026-09-09",
    cambios: [
      "Cuentas de jugador con usuario y contraseña, con creador de personaje propio.",
      "Menús rediseñados con un dock de iconos y un panel de Ajustes con volumen, calidad gráfica y teclas personalizables.",
      "Cazar animales ya es una persecución real, no un teletransporte instantáneo.",
      "Lluvia, nieve y niebla mejoradas para cubrir toda la pantalla.",
    ],
  },
];
