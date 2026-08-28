# parcelas/ — herramienta admin de parcelas

Implementa el §1 del `docs/GDD_Construccion.md` (el contrato): las parcelas
orgánicas alrededor de los asentamientos como **máscaras de casillas** en
`assets/mapas/principal/parcelas.json`, y la herramienta admin con la que el
streamer las delimita. Sin dependencias, patrón GUI de `interiores/`.

## Uso

```bash
node parcelas/gui/servidor.js          # GUI en http://localhost:4200
PUERTO=4300 node parcelas/gui/servidor.js
RUTA_MAPA=assets/mapas/demo node parcelas/gui/servidor.js   # otro mapa
node parcelas/src/generar_demo.js      # regenera el parcelas.json demo (determinista)
node --test parcelas/test/parcelas.test.js
```

## GUI (puerto 4200)

- **Lienzo** con pan (arrastrar con botón secundario o con espacio) y zoom
  (rueda, centrado en el cursor). Pinta sectores del mapa **bajo demanda**
  alrededor del viewport (el mapa principal es 3200x3200 — nunca se carga
  entero), cacheando un canvas por sector con los `colorDebug` de
  `baker/catalogo/terrenos.json` (pedidos por HTTP, no duplicados).
- **Pincel/goma** (tamaños 1/3/7) sobre la parcela activa. Las casillas
  vetadas (camino, puente, agua/`requiereNadar`, `transitable: false`, otra
  parcela) no se pintan y se marcan en rojo al pasar el ratón.
- **Varita** (`src/varita.js`): clic + tamaño objetivo → BFS aleatorizado
  (mulberry32) que crece solo por casillas válidas y para en fronteras
  naturales; vista previa con aceptar/descartar.
- **Panel**: lista de parcelas (nombre, asentamiento, casillas, `topeProps`
  editable), crear/renombrar/borrar/seleccionar. **Guardar** hace POST y el
  servidor **re-valida** (vetos + solapes + coherencia de campos cacheados) —
  si algo falla responde el motivo y no escribe.

## Módulos compartidos Node/navegador

- `src/mascara.js` — runs `[[y,x0,x1],...]` ↔ Set de claves numéricas
  `y*anchoMapa+x`, índice de pertenencia `Map<clave, parcelaId>`.
- `src/varita.js` — `crecimientoParcela(...)` + `terrenoVetado(...)` (la
  única definición de los vetos del GDD §1; GUI, servidor, demo y tests usan
  esta misma).
- `gui/servidor.js` exporta `crearLectorMapa` (sectores bajo demanda, espejo
  Node de `client/src/mapa/formatoMapa.ts`) y `validarParcelas` para el
  generador de demo y los tests.

## Demo

`src/generar_demo.js` crea 3 parcelas orgánicas junto a la ciudad
(1600,1600) con semillas fijas → mismo archivo byte a byte en cada
ejecución. `output/` (capturas de prueba) está gitignored.
