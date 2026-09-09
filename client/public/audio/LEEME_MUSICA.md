# Música de fondo — cómo sustituir el placeholder

`musica_fondo.wav` es un PLACEHOLDER generado por código (un pad ambiental
muy simple, en bucle) — solo sirve para comprobar que el hilo musical
funciona de verdad (autoreproducción al entrar, control de volumen en
Ajustes). Sustitúyelo por la música real que quieras que suene de fondo:

1. Consigue tu archivo de audio (mp3, ogg, wav, m4a... cualquier formato
   que reproduzca un `<audio>` de navegador sirve).
2. Ponlo en esta misma carpeta (`client/public/audio/`).
3. Si tu archivo se llama distinto o tiene otra extensión, abre
   `client/src/audio/musicaFondo.ts` y cambia la constante `RUTA_MUSICA` al
   nombre de tu archivo (por ejemplo `"/audio/tema_principal.mp3"`). Si lo
   llamas exactamente `musica_fondo.<tu extensión>` y actualizas solo la
   extensión en esa constante, es el único cambio de código que hace falta.

No hace falta tocar nada más: el bucle (`loop`), el volumen guardado en
Ajustes y el intento de autoreproducción al entrar ya están cableados
contra esa constante.
