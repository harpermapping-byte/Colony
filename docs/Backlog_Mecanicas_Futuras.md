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

## Verbos de interacción a cubrir más adelante (recordatorio, sin diseñar)

- **Plantas**: regar, enfermar, curar, transplantar, morir, cosechar, injertar.
- **Animales**: matar, domesticar, pelar/desollar, secar, cocinar/quemar, criar.
- **Insectos/fauna menor**: capturar (decoración, comida, cebo de pesca, u otros usos).

Todo esto refuerza la regla ya fijada de "todo lo que existe tiene un uso" — se van completando los usos concretos según se construya cada mecánica, no hace falta cerrarlos todos ahora.
