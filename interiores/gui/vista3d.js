import * as THREE from "/vendor/three.module.js";

// Vista 3D girable del edificio COMPLETO para el editor de interiores —
// sustituye al plano 2D por plantas: el edificio entero en 3D real, con
// las plantas apiladas por nivel (opcionalmente separadas en vertical para
// ver dentro de cada una), paredes de media altura con sus huecos de
// puerta reales (salaPlanta.puertas, lo mismo que ya calcula edificio.js)
// y cada mueble como caja con su colorDebug. Órbita/zoom con el ratón
// (controles propios mínimos, sin dependencias extra) y clic en una sala
// para saltar a su vista de habitación detallada.
//
// El módulo no sabe nada del estado del editor: recibe el edificio ya
// serializado + callbacks, y devuelve un manejador con destruir() para
// que el editor lo desmonte al cambiar de vista.

const ALTURA_PLANTA = 3.2; // separación vertical entre plantas SIN separar
const SEPARACION_EXTRA = 3.4; // separación adicional al activar "separar plantas"
const ALTO_PARED = 1.05; // media altura: se ve el interior desde arriba en órbita
const GROSOR_PARED = 0.14;

function alturaMueble(item) {
  if ((item.id || "").includes("alfombra")) return 0.05;
  if (item.capa === "suciedad") return 0.06;
  if (item.capa === "iluminacion") return 0.35;
  if (["armario", "estanteria", "baul"].some((k) => (item.id || "").includes(k))) return 1.0;
  if (["mesa", "encimera", "mostrador"].some((k) => (item.id || "").includes(k))) return 0.55;
  if ((item.id || "").includes("cama")) return 0.45;
  return 0.7;
}

function caja(w, h, d, color, opciones = {}) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...opciones });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  return m;
}

export function montarVista3D(contenedor, edificio, { colorParaTipoSala, alSeleccionarSala }) {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x1a1a22);
  escena.add(new THREE.AmbientLight(0xffffff, 0.75));
  const luz = new THREE.DirectionalLight(0xffffff, 1.0);
  luz.position.set(30, 50, 20);
  escena.add(luz);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const camara = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

  // --- Controles superpuestos (separar plantas + ayuda) ---
  const controles = document.createElement("div");
  controles.style.cssText = "position:absolute;top:10px;left:10px;z-index:5;background:#20202acc;border:1px solid #3a3a48;border-radius:6px;padding:8px 10px;font-size:11px;color:#9a9aa8;display:flex;flex-direction:column;gap:5px;";
  controles.innerHTML = `
    <label style="display:flex;align-items:center;gap:5px;cursor:pointer;color:#e8e8ec">
      <input type="checkbox" id="chkSepararPlantas" checked /> separar plantas
    </label>
    <span>arrastra: girar · rueda: zoom · clic en suelo: abrir sala</span>`;

  contenedor.innerHTML = "";
  contenedor.style.position = "relative";
  contenedor.style.display = "block";
  contenedor.style.overflow = "hidden";
  contenedor.appendChild(renderer.domElement);
  contenedor.appendChild(controles);

  // --- Construcción de la geometría del edificio ---
  const raizEdificio = new THREE.Group();
  escena.add(raizEdificio);
  const suelosClicables = [];

  let separado = true;

  function construir() {
    // Vaciar lo anterior (reconstrucción al cambiar "separar plantas")
    while (raizEdificio.children.length) raizEdificio.remove(raizEdificio.children[0]);
    suelosClicables.length = 0;

    const plantasOrdenadas = edificio.plantas.slice().sort((a, b) => a.nivel - b.nivel);
    const pasoVertical = ALTURA_PLANTA + (separado ? SEPARACION_EXTRA : 0);

    plantasOrdenadas.forEach((planta, k) => {
      const yBase = k * pasoVertical;
      const grupoPlanta = new THREE.Group();
      grupoPlanta.position.y = yBase;

      planta.salas.forEach((s, indiceSala) => {
        const r = s.resultado;
        const ox = s.offsetX, oy = s.offsetY;
        const puertas = new Set(s.salaPlanta ? s.salaPlanta.puertas : []);

        // Máscara real de suelo (catalogo/formasSala.json — docs/GDD_Bakeador_Interiores.md
        // sección 2): r.mascara es un string 'ancho*largo' de '1'/'0' (mismo
        // formato que ya consume server/src/mundo/interiorColision.ts para
        // las salas orgánicas de mazmorras), ausente = sala rectangular de
        // siempre (todo el rectángulo es suelo). PORT deliberado, no import
        // — este archivo es ESM de navegador, interiores/src/formasSala.js
        // es CommonJS de Node; mismo criterio que ya usa el resto del
        // proyecto para crearPRNG (ver CLAUDE.md, "cada módulo la porta
        // suelta a propósito, sin dependencia cruzada").
        const mascaraSala = r.mascara;
        const esSueloSala = (x, y) => x >= 0 && y >= 0 && x < r.ancho && y < r.largo && (!mascaraSala || mascaraSala[y * r.ancho + x] === "1");

        // Suelo: un tile por casilla de suelo REAL (antes una única caja
        // r.ancho x r.largo — con una plantilla no rectangular dejaba
        // "suelo" pintado también en los huecos de la máscara).
        const colorSuelo = colorParaTipoSala(s.tipoSalaId);
        for (let ty = 0; ty < r.largo; ty++) {
          for (let tx = 0; tx < r.ancho; tx++) {
            if (!esSueloSala(tx, ty)) continue;
            const suelo = caja(1, 0.14, 1, colorSuelo);
            suelo.position.set(ox + tx + 0.5, 0.07, oy + ty + 0.5);
            suelo.userData = { nivel: planta.nivel, indiceSala };
            grupoPlanta.add(suelo);
            suelosClicables.push(suelo);
          }
        }

        // Paredes de media altura: antes solo recorría los 4 lados de la
        // caja delimitadora (asumía rectángulo completo); ahora recorre
        // CADA celda de suelo real y pone pared en cualquier lado que
        // colinde con una celda que NO es suelo real — con rectángulo eso
        // sigue siendo exactamente el perímetro de siempre; con una
        // plantilla no rectangular añade también los muros internos que
        // crea un mordisco/concavidad (el rincón interior de una L, el
        // hueco central de una U...), saltando los huecos de puerta reales
        // (coordenadas globales de planta en salaPlanta.puertas) igual que
        // antes.
        const colorPared = 0x8a8a92;
        function tramoPared(cx, cz, horizontal, hayPuerta) {
          if (hayPuerta) return;
          const w = horizontal ? 1.0 : GROSOR_PARED;
          const d = horizontal ? GROSOR_PARED : 1.0;
          const m = caja(w, ALTO_PARED, d, colorPared, { roughness: 0.95 });
          m.position.set(cx, 0.14 + ALTO_PARED / 2, cz);
          grupoPlanta.add(m);
        }
        for (let ty = 0; ty < r.largo; ty++) {
          for (let tx = 0; tx < r.ancho; tx++) {
            if (!esSueloSala(tx, ty)) continue;
            if (!esSueloSala(tx, ty - 1)) tramoPared(ox + tx + 0.5, oy + ty, true, puertas.has(`${ox + tx}_${oy + ty - 1}`)); // norte
            if (!esSueloSala(tx, ty + 1)) tramoPared(ox + tx + 0.5, oy + ty + 1, true, puertas.has(`${ox + tx}_${oy + ty + 1}`)); // sur
            if (!esSueloSala(tx - 1, ty)) tramoPared(ox + tx, oy + ty + 0.5, false, puertas.has(`${ox + tx - 1}_${oy + ty}`)); // oeste
            if (!esSueloSala(tx + 1, ty)) tramoPared(ox + tx + 1, oy + ty + 0.5, false, puertas.has(`${ox + tx + 1}_${oy + ty}`)); // este
          }
        }

        // Mobiliario: cada pieza colocada como caja con su colorDebug, y
        // sus objetos de superficie (sobre) como cajitas encima.
        for (const item of r.colocados || []) {
          const h = alturaMueble(item);
          const m = caja(item.ancho * 0.92, h, item.largo * 0.92, item.colorDebug || "#999");
          m.position.set(ox + item.x + item.ancho / 2, 0.14 + h / 2, oy + item.y + item.largo / 2);
          grupoPlanta.add(m);
          for (const sob of item.sobre || []) {
            const ms = caja(0.3, 0.18, 0.3, sob.colorDebug || "#ccc");
            ms.position.set(ox + item.x + item.ancho / 2, 0.14 + h + 0.09, oy + item.y + item.largo / 2);
            grupoPlanta.add(ms);
          }
        }
        // Colgados en pared: cajita a media pared en su lado real.
        for (const c of r.colgados || []) {
          const mc = caja(0.28, 0.28, 0.12, c.colorDebug || "#ccc");
          const zc = 0.14 + ALTO_PARED * 0.7;
          if (c.lado === "sur") mc.position.set(ox + c.x + 0.5, zc, oy + r.largo - 0.08);
          else if (c.lado === "norte") mc.position.set(ox + c.x + 0.5, zc, oy + 0.08);
          else if (c.lado === "este") { mc.rotation.y = Math.PI / 2; mc.position.set(ox + r.ancho - 0.08, zc, oy + c.y + 0.5); }
          else { mc.rotation.y = Math.PI / 2; mc.position.set(ox + 0.08, zc, oy + c.y + 0.5); }
          grupoPlanta.add(mc);
        }
      });

      // Marcador del conector vertical (escalera/trampilla) de esta planta.
      const sc = planta.salaConector;
      if (sc) {
        const salaConector = planta.salas.find((s) => s.offsetX === sc.offsetX && s.offsetY === sc.offsetY && s.tipoSalaId === sc.tipoSalaId);
        if (salaConector) {
          const cono = new THREE.Mesh(
            new THREE.ConeGeometry(0.4, 1.1, 4),
            new THREE.MeshStandardMaterial({ color: 0xffe08a, roughness: 0.6 }),
          );
          cono.position.set(
            salaConector.offsetX + salaConector.resultado.ancho / 2,
            0.14 + ALTO_PARED + 0.8,
            salaConector.offsetY + salaConector.resultado.largo / 2,
          );
          grupoPlanta.add(cono);
        }
      }

      raizEdificio.add(grupoPlanta);
    });
  }

  construir();

  // --- Centro y encuadre inicial a partir del bbox real del edificio ---
  const bbox = new THREE.Box3().setFromObject(raizEdificio);
  const centro = bbox.getCenter(new THREE.Vector3());
  const tam = bbox.getSize(new THREE.Vector3());
  let distancia = Math.max(tam.x, tam.y, tam.z) * 1.25 + 6;
  let yaw = Math.PI / 4;
  let pitch = 0.62;

  function colocarCamara() {
    camara.position.set(
      centro.x + distancia * Math.cos(pitch) * Math.cos(yaw),
      centro.y + distancia * Math.sin(pitch),
      centro.z + distancia * Math.cos(pitch) * Math.sin(yaw),
    );
    camara.lookAt(centro);
  }

  // --- Órbita/zoom con el ratón (mínimo imprescindible, sin OrbitControls) ---
  let arrastrando = false;
  let seMovio = false;
  let ultX = 0, ultY = 0;
  const alBajar = (ev) => { arrastrando = true; seMovio = false; ultX = ev.clientX; ultY = ev.clientY; };
  const alMover = (ev) => {
    if (!arrastrando) return;
    const dx = ev.clientX - ultX, dy = ev.clientY - ultY;
    if (Math.abs(dx) + Math.abs(dy) > 3) seMovio = true;
    ultX = ev.clientX; ultY = ev.clientY;
    yaw += dx * 0.006;
    pitch = Math.min(1.35, Math.max(0.12, pitch + dy * 0.005));
    colocarCamara();
  };
  const alSoltar = () => { arrastrando = false; };
  const alRueda = (ev) => {
    ev.preventDefault();
    distancia = Math.min(200, Math.max(6, distancia * (ev.deltaY > 0 ? 1.1 : 0.9)));
    colocarCamara();
  };

  // Clic (sin arrastre) → raycast a los suelos → seleccionar sala.
  const raycaster = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  const alClic = (ev) => {
    if (seMovio) return; // era un arrastre de órbita, no un clic
    const rect = renderer.domElement.getBoundingClientRect();
    puntero.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(puntero, camara);
    const impactos = raycaster.intersectObjects(suelosClicables, false);
    if (impactos.length > 0 && alSeleccionarSala) {
      const { nivel, indiceSala } = impactos[0].object.userData;
      alSeleccionarSala(nivel, indiceSala);
    }
  };

  renderer.domElement.addEventListener("pointerdown", alBajar);
  window.addEventListener("pointermove", alMover);
  window.addEventListener("pointerup", alSoltar);
  renderer.domElement.addEventListener("wheel", alRueda, { passive: false });
  renderer.domElement.addEventListener("click", alClic);

  controles.querySelector("#chkSepararPlantas").addEventListener("change", (ev) => {
    separado = ev.target.checked;
    construir();
  });

  function ajustarTamano() {
    const w = contenedor.clientWidth || 800;
    const h = contenedor.clientHeight || 600;
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  window.addEventListener("resize", ajustarTamano);
  ajustarTamano();
  colocarCamara();

  let vivo = true;
  function bucle() {
    if (!vivo) return;
    renderer.render(escena, camara);
    requestAnimationFrame(bucle);
  }
  bucle();

  return {
    destruir() {
      vivo = false;
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      window.removeEventListener("resize", ajustarTamano);
      renderer.dispose();
      if (renderer.domElement.parentNode === contenedor) contenedor.removeChild(renderer.domElement);
      if (controles.parentNode === contenedor) contenedor.removeChild(controles);
    },
  };
}

// El script principal del editor no es un módulo — se expone en window.
window.Vista3D = { montar: montarVista3D };
