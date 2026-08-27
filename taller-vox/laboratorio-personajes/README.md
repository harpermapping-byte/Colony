# Laboratorio de personajes

Visor interactivo del personaje vóxel con esqueleto: lista de huesos con su
jerarquía, sliders de rotación X/Y/Z por hueso, esqueleto superpuesto
(`SkeletonHelper`), ciclo de andar de prueba y carga de cualquier otro
`.glb` exportado por el taller. Usa three.js + `GLTFLoader` — el mismo
motor que el cliente del juego, así que lo que se ve aquí es lo que verá
el juego.

Publicado como Artifact:
https://claude.ai/code/artifact/26eb5dc7-1a48-433d-8067-321364949505

## Cómo se construye

`laboratorio_personajes.html` es un único archivo autocontenido: el bundle
de three.js (esbuild) y el `personaje.glb` en base64 van embebidos.

```bash
npm install three esbuild          # junto a ../exportar_personaje_glb.js
node ../exportar_personaje_glb.js 34 personaje.glb
npx esbuild app.mjs --bundle --minify --format=iife --outfile=bundle.js
node build.js                      # template.html + bundle.js + personaje.glb -> laboratorio_personajes.html
```

`test.mjs` es la prueba con Playwright: carga la página, comprueba que el
esqueleto tiene 15 huesos, dobla el codo 90°, arranca el ciclo de andar y
saca capturas — sin errores de consola.
