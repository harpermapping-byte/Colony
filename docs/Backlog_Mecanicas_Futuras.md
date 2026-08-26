# Backlog de mecánicas futuras — esqueleto, no diseño cerrado

Ideas que ya hemos hablado y queremos que no se pierdan, aunque todavía no toque implementarlas. Nivel de detalle desigual a propósito: algunas están casi listas para construir, otras son solo el esqueleto de la idea. Se retoma y se afina cada una cuando le llegue el turno — no bloquea nada del bakeador de exteriores, que sigue siendo la pieza cerrada y ya construida.

## Ciclo de vida y reproducción animal — propuesto, falta confirmar del todo

Plantillas compartidas por familia de animal (mismo patrón que categorías de recurso — pocas plantillas, cada especie apunta a una):

- **Mamífero grande**: cría → joven → adulto (3 fases).
- **Mamífero pequeño**: cría → adulto (2 fases, maduran rápido).
- **Ave**: huevo → polluelo → adulto (3 fases).
- **Reptil**: huevo → cría → adulto (3 fases; algunos siguen creciendo de adultos).
- **Anfibio**: huevo → renacuajo → adulto (3 fases, metamorfosis real).
- **Pez**: alevín → juvenil → adulto (3 fases).
- **Insecto**: 4 fases si metamorfosis completa (huevo→larva→pupa→adulto) o 3 si incompleta (huevo→ninfa→adulto), según la especie.

Todas las especies tienen sexo (macho/hembra). El nombre real de la cría (ternero, cervatillo, cachorro...) se guarda como dato cuando existe en español.

**Pendiente de definir cuando toque**: cómo se dispara la reproducción, tiempos de gestación/incubación, cómo interactúan macho/hembra, qué pasa con las crías hasta hacerse adultas.

## Necesidades de los animales — solo esqueleto, sin diseñar

Hambre, sed, comodidad — mencionado como algo que debe existir para dar profundidad al cuidado/domesticación, sin definir todavía valores, cómo se degradan, ni qué pasa si no se cubren.

## Necesidades y salud de las plantas — solo esqueleto, sin diseñar

Sed, enfermedades, nutrientes del suelo, transplante, muerte, curación — mencionado en el mismo sentido que la fertilidad del suelo ya anotada en `GDD_Bakeador_Exteriores.md` (sección 15). Falta definir mecanismos concretos.

## Injertos y cruces de cultivos — diseño ya cerrado, listo para construir cuando toque esa fase

- Es una mecánica de **granja/cultivo**, no del bakeador de exteriores — necesita un catálogo nuevo, `cultivos.json`, separado de `vegetacion.json` (silvestre, la coloca el bakeador) porque son cosas distintas: lo que planta el jugador a propósito frente a lo que reparte el mundo.
- Cada cultivo tiene 6 atributos numéricos (0 a 1): `rendimiento`, `calidad`, `resistenciaEnfermedad`, `velocidadCrecimiento`, `necesidadAgua`, `tamañoFruto`.
- Al cruzar cultivo A + cultivo B: cada atributo del resultado = media de los dos padres + variación aleatoria (no genética mendeliana compleja).
- **Combinación abierta**: cualquier cultivo con cualquier otro, sin restricción botánica real — fomenta la experimentación.
- El resultado exitoso se registra como **especie nueva y permanente** en `cultivos.json`, con un nombre automático provisional (ej. "Híbrido Tomate×Pera") que se puede **renombrar a mano** en cualquier momento — nunca queda fijado en código, vive solo como dato editable.
- Empieza con sprite placeholder genérico como cualquier otra entrada nueva de catálogo.
- **Pendiente**: probabilidad de éxito del injerto, qué pasa si falla, cómo se traducen los 6 atributos en efectos de juego concretos (precio de venta, tiempo de espera, etc.).

## Combate — sin diseñar

Armas cuerpo a cuerpo y a distancia, salud/aguante, PvE contra fauna peligrosa y monstruos de mazmorra. PvP probablemente limitado o desactivado por defecto dado el enfoque comunitario del proyecto — a decidir cuando toque.

## Oficios de crafteo (herrería, talla, y los que falten) — sin diseñar

Recetas, estaciones de trabajo (yunque, mesa de talla...), progresión de habilidad por oficio, qué herramienta/nivel hace falta para cada receta.

## Cocina — sin diseñar

Recetas combinando categorías de recurso ya existentes (carne, pescado, plantas/hierbas), posibles beneficios temporales al comer.

## Construcción de estructuras (más allá de las parcelas ya definidas) — sin diseñar

Planos/blueprints, materiales requeridos, niveles de mejora de una construcción, quién puede construir dónde (ligado a permisos de parcela).

## Sistema de personaje — sin diseñar

Estadísticas, progresión/experiencia, slots de equipo, apariencia personalizable, límites de inventario. Recordar el principio ya fijado: inventario y equipo son autoritativos en servidor, el cliente solo predice/muestra (ver conversación de arquitectura general).

## Muerte y respawn — sin diseñar

Qué pasa al morir (¿se pierden objetos?, ¿punto de reaparición?, ¿penalización temporal?) — nada decidido todavía.

## Monturas — sin diseñar

Domesticación, control de movimiento, resistencia. Ya hay un gancho preparado: el modificador de velocidad por tipo de terreno del bakeador (GDD sección 2) está pensado desde el principio para que una montura solo necesite su propio multiplicador aparte, sin tocar la tabla de terrenos.

## Pesca — sin diseñar

Cebos (conecta con "capturar insectos" ya anotado como verbo pendiente), cañas/redes, zonas de pesca por bioma (agua dulce vs. mar, ya diferenciadas en el catálogo de recursos como Pescado de Río / Pescado de Mar / Marisco).

## Barcos y navegación marítima — sin diseñar

Construcción de barco, navegar el mar (ya establecido como navegable, con fondo marino investigable como capa aparte), cargar mercancía, descubrir islas, cruzar a otro mapa por un borde de mar abierto.

## Comercio y economía — sin diseñar

Moneda, mercaderes NPC (los que ya aparecen en plantillas de POI como "oasis_mercader"), compraventa entre jugadores, si hay fluctuación de precios.

## Gremios / equipos — sin diseñar

Parcelas compartidas de gremio (mencionado ya en la arquitectura general del proyecto), roles dentro del gremio, construcción colaborativa.

## Roles de Twitch dentro del juego — concepto decidido, beneficios concretos sin definir

Ya está decidido que el login es OAuth de Twitch y que sub/mod/VIP dan ventajas dentro del juego (una de las 5 decisiones fundacionales del proyecto) — falta decidir qué ventaja concreta da cada rol.

## NPCs Gobernadores con IA — concepto decidido, mecánica concreta sin definir

Ya está decidido el modelo híbrido: NPCs base con IA simple/rutinas, y 3-4 NPCs "Gobernador" con integración LLM en tiempo real que generan misiones según la economía de la ciudad y responden al chat. Falta definir cómo mantienen memoria de conversación, límites de coste/latencia, y el contexto exacto que reciben.

## Modo Live — eventos de Twitch en tiempo real — concepto decidido, mapeo concreto sin definir

Ya está decidido que cuando el streamer está en directo, eventos de Twitch (subs, bits, raids) generan eventos en el mundo (clima, spawns de recursos, hordas). Falta el mapeo concreto: qué evento de Twitch dispara exactamente qué efecto y con qué intensidad.

## Facciones y la ciudad enemiga — sin diseñar

Ya está decidido que hay una ciudad neutral y una ciudad enemiga en el mapa. Falta diseñar reputación, conflicto entre ambas, y si el jugador puede elegir bando o interactuar con la facción enemiga de alguna forma.

## Cono/campo de visión real en interiores — concepto para más adelante, no para el bakeador

Al bocetar el bakeador de interiores salió la idea de un cono de visión calculado geométricamente (qué parte de una sala contigua ve el jugador a través de un hueco de puerta, recortado a la silueta real de la abertura en proyección isométrica). Confirmado explícitamente: **esto no es tarea del bakeador** — el bakeador solo genera la estructura estática (salas, paredes, huecos, mobiliario). El campo de visión es cálculo en vivo del cliente/servidor de juego, ligado a posición y orientación del jugador en cada instante, así que pertenece a la fase de "servidor en vivo" (como el clima o las sombras en exteriores). Apuntado aquí para no perder la idea ni el porqué (en proyección en paralelo/isométrica sin fuga de perspectiva, la silueta de lo visible a través de un hueco es idéntica a la silueta del propio hueco, sea cual sea la profundidad — más simple de calcular que en perspectiva real).

## Verbos de interacción a cubrir más adelante (recordatorio, sin diseñar)

- **Plantas**: regar, enfermar, curar, transplantar, morir, cosechar, injertar.
- **Animales**: matar, domesticar, pelar/desollar, secar, cocinar/quemar, criar.
- **Insectos/fauna menor**: capturar (decoración, comida, cebo de pesca, u otros usos).

Todo esto refuerza la regla ya fijada de "todo lo que existe tiene un uso" — se van completando los usos concretos según se construya cada mecánica, no hace falta cerrarlos todos ahora.
