# GDD — Profesiones: edificios, mesas y mobiliario por oficio

**ESTADO: PROPUESTA DE DISEÑO (2026-08-29), sin aplicar todavía al catálogo.** Este documento fija, para los 38 oficios pactados en `docs/Backlog_Mecanicas_Futuras.md` ("Roles/profesiones y crafteo por planos"): edificio, 2-4 mesas especiales y únicas (básica→avanzada, marcando cuáles deben conectar a la red motriz — `docs/GDD_Motriz.md`), mobiliario funcional y decorativo, y el tipo de NPC. **No se craftea nada todavía** — las recetas/planos concretos ("ya les daremos un uso") son un diseño posterior, oficio a oficio. Pendiente de tu OK antes de volcarlo a `interiores/catalogo/*.json` (son ~300 entradas nuevas entre edificios/mesas/mobiliario — cambio grande, se aplica entero una vez confirmado, no a medias).

Convención de esta tabla: **⚡** = la mesa debería llevar `energia.consume` (docs/GDD_Motriz.md) — se beneficia de estar conectada a un molino vía eje/palancas. "ya" = pieza que YA existe en el catálogo (`interiores/catalogo/elementos.json`, comprobado); todo lo demás es NUEVO. "Edificio: ya" = el `tipos_edificio.json` ya tiene esa entrada con ese `temaTaller`; "NUEVO" = hay que darlo de alta.

Hallazgo al revisar el catálogo actual antes de proponer nada: **`sierra_grande` (con `energia.consume` desde Motriz) pertenece al `temaTaller` "aserradero"** — el edificio-plantilla del jarl de Producción (madera automática, sin jugador) — **no** al `temaTaller` "carpintero" que usa el edificio `carpinteria` (que hoy solo tiene `banco_carpintero`/`estante_herramientas`, sin campo `energia`). Son dos cadenas distintas a propósito: el aserradero produce madera en bruto solo; el carpintero (abajo) la transforma en objetos. No confundir al implementar.

## Tier 1 — ya con gancho `energia` de Motriz puesto

### Herrería — Edificio: `herreria` (ya) — NPC: `herrero` (ya en `oficiosEdificios.json`)
| Mesa | Tier | ⚡ |
|---|---|---|
| `yunque` (ya) | básica | ⚡ ya |
| `fragua` (ya) | básica | no (calor manual/carbón) |
| `martillo_pilon` (NUEVO) | avanzada | ⚡ — martillo mecánico para piezas grandes |
| `mesa_grabado_armas` (NUEVO) | avanzada | no — detalle fino a mano, para herrero de armas |

Mobiliario: `armero` (ya), `fuelle` (ya). Decoración: espadas/escudos de pared, ristra de herraduras, brasero.

### Carpintería — Edificio: `carpinteria` (ya) — NPC: `carpintero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `banco_carpintero` (ya) | básica | no |
| `torno_madera` (NUEVO) | básica-avanzada | ⚡ — tornea patas/postes |
| `mesa_ensamblaje` (NUEVO) | avanzada | no — monta muebles/estructuras |
| `mesa_talla_fina` (NUEVO) | avanzada | no — tallado decorativo a mano |

Mobiliario: `estante_herramientas` (ya). Decoración: virutas de madera, herramientas colgadas, muestrario de maderas.

### Alfarería — Edificio: `alfareria` (ya) — NPC: `alfarero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `torno_alfarero` (ya) | básica | ⚡ ya |
| `horno_ceramica` (ya) | básica | no |
| `mesa_esmaltado` (NUEVO) | avanzada | no |
| `mesa_moldes` (NUEVO) | avanzada | no — piezas en serie |

Decoración: vasijas/jarrones expuestos, estantería de piezas secando.

## Tier 2 — edificio + oficio NPC ya existen, cierran un bucle de recurso ya producido en vivo

### Apicultor — Edificio: NUEVO `cabana_apicultor` (pequeña) — NPC: NUEVO `apicultor`
La colmena (exterior, Producción) ya es la "fuente"; esta cabaña es donde se transforma lo recolectado.
| Mesa | Tier | ⚡ |
|---|---|---|
| `mesa_extraccion_miel` (NUEVO) | básica | no |
| `prensa_cera` (NUEVO) | básica | no |
| `mesa_hidromiel` (NUEVO) | avanzada | no — fermenta miel, cruza con destilería |

Decoración: panales colgados, tarros de miel en fila, ahumador.

### Molinero — Edificio: `molino`/`molino_agua`/`molino_viento` (ya) — NPC: `molinero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `muela_piedra` (ya) | básica | **proponer ⚡** — es literalmente lo que mueve la rueda hidráulica/aspas |
| `criba_grano` (NUEVO) | básica | no |
| `mesa_ensacado` (NUEVO) | avanzada | no |

Mobiliario: `saco_harina` (ya). Decoración: sacos de grano apilados, polvo de harina ambiental.

### Panadero — Edificio: `panaderia` (ya) — NPC: `panadero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `amasadora` (ya) | básica | opcional ⚡ — amasado mecánico |
| `horno_pan` (ya) | básica | no |
| `mesa_formado` (NUEVO) | avanzada | no |
| `mesa_reposteria` (NUEVO) | avanzada | no |

Mobiliario: `estante_pan`, `pala_horno` (ya). Decoración: panes colgados, cesta de hogazas.

### Curtidor — Edificio: `curtiduria` (ya) — NPC: `curtidor` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `tina_curtido` (ya) | básica | no |
| `mesa_raspado` (NUEVO) | básica | no — limpia la piel antes de curtir |
| `mesa_tenido_cuero` (NUEVO) | avanzada | no |

Mobiliario: `bastidor_secado_pieles` (ya). Decoración: pieles curtidas colgadas.

## Tier 3 — edificio + oficio NPC ya existen, sin bucle de recurso previo

### Joyero — Edificio: `joyeria` (ya) — NPC: `joyero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `banco_joyero` (ya) | básica | no |
| `mesa_engarce` (NUEVO) | avanzada | no — engastar gemas |
| `mesa_fundicion_precioso` (NUEVO) | avanzada | ⚡ — crisol pequeño, fuelle mecánico |

Mobiliario: `vitrina_joyas` (ya). Decoración: gemas/anillos expuestos, balanza de precisión.

### Sastre/tejedor — Edificio: `taller_sastre` (ya) — NPC: `sastre` (ya)
Solapa con lo que `ropa/` ya genera proceduralmente — repartir cuando toque diseñar recetas (¿el sastre-jugador desbloquea variantes/calidad, no reinventa el generador?).
| Mesa | Tier | ⚡ |
|---|---|---|
| `telar` (ya) | básica | opcional ⚡ — telar mecánico avanzado |
| `mesa_corte` (NUEVO) | básica | no |
| `mesa_bordado` (NUEVO) | avanzada | no |

Mobiliario: `maniqui_costura`, `rollo_tela` (ya). Decoración: retales de tela, prendas colgadas.

### Tendero — Edificio: `tienda` (ya) — NPC: `tendero` (ya)
**Excepción al patrón**: no fabrica nada (Mercado ya resuelve su mecánica). Mobiliario: `mostrador`, `estanteria_mercancias`, `cofre_monedas_tienda` (ya). Sin mesas de crafteo — como mucho un `mesa_empaquetado` (NUEVO, cosmético) si se quiere el gesto visual.

### Tabernero — Edificio: `taberna`/`posada` (ya) — NPC: `tabernero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `mostrador` (ya) | básica | no |
| `mesa_cocina_taberna` (NUEVO) | básica | no |
| `barril_cerveza_casera` (NUEVO) | avanzada | no — cruza con destilería |

Mobiliario: `estante_jarras`, `tonel_vino` (ya).

## Tier 4 — recolección primaria: SIN mesas de fabricación real (excepción explícita)

Estos oficios recolectan materia prima, no la transforman — su "estación" es un punto de recolección en el bake exterior o, como mucho, un mueble de almacenamiento intermedio. No fuerzo el patrón "2-4 mesas" aquí; forzarlo produciría mesas de relleno sin función real.

| Oficio | Edificio | Punto/mueble | NPC |
|---|---|---|---|
| Minero | NUEVO `entrada_mina` (POI/mazmorra, no edificio de aldea) | veta de mineral (recolectable exterior/subterráneo) | NUEVO `minero` |
| Leñador | — (recolección exterior) | `tronco_apilado` (ya, tag `aserradero` — reusar) | NUEVO `lenador` |
| Agricultura | campos de cultivo (ya, decoración exterior) + `granero` (ya, sin oficio) | — | NUEVO `agricultor` |
| Pesca | `lonja_pescado` (ya) | `red_pesca`, `barril_salazon` (ya) — ver mejora abajo | `pescador` (ya) |
| Caza | — (recolección exterior) | — | NUEVO `cazador` |
| Trampero | — (recolección exterior) | — | NUEVO `trampero` |
| Cría de animales | `establo` (ya, sin oficio) | — | NUEVO `ganadero` |
| Montar a caballo | `establo` (ya) | — | (no es oficio de producción, es transporte/movilidad) |

**Única mejora real de Tier 4** — Pesca ya tiene edificio+mobiliario, se le puede subir a mesas de verdad sin inventar nada de golpe: `mesa_eviscerado` (NUEVO, básica) + `ahumadero_pescado` (NUEVO, avanzada).

## Tier 5 — sin building todavía, o dependen de sistemas no construidos (combate, heridas, barcos)

Propuestas más ligeras (menos detalle de mobiliario/decoración) — están más lejos de implementarse y probablemente cambien al diseñar sus recetas.

| Oficio | Edificio | Mesas (básica→avanzada) | NPC |
|---|---|---|---|
| Herrero de armas | comparte `herreria` (especialización, no building propio) | `mesa_forja_hojas`, `mesa_afilado`⚡ | NUEVO `herrero_armas` |
| Herrero de armaduras | comparte `herreria` | `mesa_remachado`, `yunque_armadura`⚡ | NUEVO `herrero_armaduras` |
| Tallador de piedra/picapedrero | NUEVO `taller_picapedrero` | `mesa_talla_piedra`⚡(opcional), `banco_pulido` | NUEVO `picapedrero` |
| Peletero | comparte `curtiduria` o NUEVO `peleteria` | `mesa_corte_piel`, `mesa_costura_pieles` | NUEVO `peletero` |
| Herbolista | `botica`/`choza_curandero` (ya) | `mortero_grande_boticario` (ya), `secadero_hierbas` (ya), `mesa_destilado_esencias` (NUEVO, avanzada) | NUEVO `herbolista` |
| Vidriero | NUEVO `vidrieria` | `horno_vidrio`⚡, `mesa_soplado`, `mesa_tallado_cristal` | NUEVO `vidriero` |
| Arquero/ballestero (fletcher) | comparte `carpinteria` o NUEVO `taller_arquero` | `mesa_encordado`, `banco_tallado_arcos` | NUEVO `fletcher` |
| Guarnicionero | comparte `curtiduria`/`establo` | `mesa_guarnicionero`, `banco_monturas` | NUEVO `guarnicionero` |
| Destilador/cervecero | `destileria` (ya) | `alambique` (ya, opcional⚡ avanzada), `mesa_mezcla` (NUEVO, básica) | NUEVO `destilador` |
| Constructor | — (es el sistema de construcción ya implementado) | sin mesas — no aplica | (no es oficio de mesa) |
| Cocinero | NUEVO `cocina_comunal` (o cocina de taberna/casa) | `mesa_corte_cocina`, `horno_cocina`, `mesa_especias` | NUEVO `cocinero` |
| Carnicero | NUEVO `carniceria` | `mesa_despiece`, `ahumadero` (avanzada) | NUEVO `carnicero` |
| Curandero/médico | `choza_curandero` (ya, compartido con herbolista — distinguir uso) | `mesa_diagnostico`, `mesa_cirugia` (avanzada) | NUEVO `curandero` |
| Mercader ambulante | `carromato_mercader` (ya) | — no craftea, es logística/venta itinerante | NUEVO `mercader_ambulante` |
| Navegante / Capitán de barco | — (rol de movimiento, no crafteo) | — | NUEVO `navegante`/`capitan` |
| Constructor naval/carpintero de ribera | NUEVO `astillero` (conecta "Puerto/Muelle Comunal" del backlog) | `mesa_calafateo`, `banco_carpintero_ribera` | NUEVO `carpintero_ribera` |
| Guardia/mercenario | `cuartel_guardia`/`arena_combate` (ya) | sin mesas — depende de combate | `guardia` (ya) |
| Explorador/cartógrafo | — (usa `mapa_mesa`, ya en catálogo de interiores) | `mapa_mesa` (ya), `mesa_cartografia` (NUEVO, avanzada) | NUEVO `explorador` |

## Resumen de lo que haría falta dar de alta si se aprueba

- **Edificios nuevos**: `cabana_apicultor`, `entrada_mina`, `taller_picapedrero`, `peleteria` (si no comparte curtiduria), `vidrieria`, `taller_arquero` (si no comparte carpinteria), `cocina_comunal`, `carniceria`, `astillero`.
- **NPCs de oficio nuevos** (`poblacion/catalogo/oficiosEdificios.json`): apicultor, minero, lenador, agricultor, cazador, trampero, ganadero, herrero_armas, herrero_armaduras, picapedrero, peletero, herbolista, vidriero, fletcher, guarnicionero, destilador, cocinero, carnicero, curandero, mercader_ambulante, navegante, capitan, carpintero_ribera, explorador.
- **Mesas/mobiliario nuevo en `elementos.json`**: ~45 piezas nombradas arriba, cada una con `temasProfesion` apuntando a su oficio (patrón ya establecido) y `energia` solo en las marcadas ⚡.
