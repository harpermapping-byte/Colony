# Laboratorio de personajes

Visor interactivo de los PJ vóxel con esqueleto: selector de los 3 PJ de
prueba de `../generar_pj.js` (sexo/altura/peso/pelo/barba distintos), lista
de huesos con su jerarquía, sliders de rotación X/Y/Z por hueso, esqueleto
superpuesto (`SkeletonHelper`), ciclo de andar de prueba y carga de
cualquier otro `.glb` exportado por el taller. Usa three.js + `GLTFLoader`
— el mismo motor que el cliente del juego, así que lo que se ve aquí es lo
que verá el juego.

Publicado como Artifact:
https://claude.ai/code/artifact/26eb5dc7-1a48-433d-8067-321364949505

## Cómo se construye

`laboratorio_personajes.html` es un único archivo autocontenido: el bundle
de three.js (esbuild) y los `.glb` de los PJ en base64 van embebidos.

```bash
npm install
npm run build   # genera ../vox/pj*.glb + bundle + laboratorio_personajes.html
npm test        # E2E con Playwright (usa el Chromium del entorno del agente)
```

`test.mjs` recorre los 3 PJ del selector: 15 huesos en cada uno, codo
doblado 90° (verifica que la articulación queda tapada, no hueca), ciclo
de andar y capturas en `capturas/` — sin errores de consola.
