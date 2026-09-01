# docs/archivo/ — GDDs completados, sin pendientes reales

Pedido del streamer (2026-09-01): "actualiza todos los GDD y aquellos completados quítalos para no acumular archivos", con "archivar, no borrar" como criterio elegido — mover aquí en vez de eliminar, para no perder el porqué de ninguna decisión de diseño (siguen siendo memoria del proyecto, regla de `CLAUDE.md`).

**Criterio para mover un GDD aquí** (los dos a la vez, no basta uno solo):
1. El sistema que documenta está implementado y verificado de punta a punta, sin ninguna sección de "pendiente"/"fuera de alcance"/"a confirmar" con un ítem real y abierto (los ya tachados/resueltos no cuentan en contra).
2. Ningún otro documento de `docs/` lo cita como base técnica activa (un GDD que otro sistema reusa como contrato — p. ej. "mismo patrón que `docs/GDD_X.md` §4" — se queda en `docs/`, aunque esté cerrado, porque sigue siendo referencia viva).

Auditoría 2026-09-01 sobre los 55 documentos de `docs/` (3 pasadas de investigación independientes, una por lote): de todos los revisados, **solo `GDD_Pesca.md`** cumplía limpiamente los dos criterios — el resto tenía o pendientes reales sin cerrar, o citas activas desde otros sistemas ya construidos (varios de ellos citados literalmente en el "Mapa del repo" de `CLAUDE.md`). El criterio se aplicó deliberadamente conservador: ante la duda, un GDD se queda en `docs/`.

Un archivo aquí puede volver a `docs/` sin más trámite si alguna vez se retoma o se le añade encima — archivar no es una decisión permanente, solo una forma de no acumular ruido en el índice principal mientras el sistema siga cerrado.
