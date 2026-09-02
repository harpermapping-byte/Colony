/**
 * Instrumentos musicales interactivos (docs/GDD_Instrumentos.md, pedido
 * 2026-08-31): descarga+parsea el .mid que pegó el jugador (@tonejs/midi) y
 * lo sintetiza LOCALMENTE con un sintetizador de Tone.js por tipo de
 * instrumento — sin banco de samples externo (sustitución consciente de
 * "webaudiofont" del pedido original: los sintetizadores embebidos de
 * Tone.js sirven exactamente igual para el tono "medieval placeholder" que
 * ya usa todo el arte del proyecto, sin depender de descargar SoundFonts).
 *
 * TODAS las notas de TODAS las pistas del MIDI se reproducen por el MISMO
 * sintetizador — es UN personaje tocando UN instrumento, no una orquesta
 * completa; si el .mid tiene varias pistas (melodía + acompañamiento...)
 * suenan igual, mezcladas, con el timbre de ese instrumento.
 *
 * `clave` identifica la reproducción (sessionId del jugador que toca) para
 * que puedan sonar varias a la vez sin pisarse — cada una con su propio
 * synth y su propio temporizador de fin.
 */
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";

export type TipoInstrumento = "tambor" | "laud" | "flauta" | "campana";

interface ReproduccionActiva {
  synth: Tone.PolySynth<any>;
  temporizador: ReturnType<typeof setTimeout>;
}

const activos = new Map<string, ReproduccionActiva>();

function crearSynth(tipo: TipoInstrumento): Tone.PolySynth<any> {
  switch (tipo) {
    case "tambor":
      // Percusión de parche/madera — ataque seco, cae rápido.
      return new Tone.PolySynth(Tone.MembraneSynth, { octaves: 4, pitchDecay: 0.02 }).toDestination();
    case "campana":
      // Metal inarmónico — el propio timbre por defecto de MetalSynth ya suena a campana/gong.
      return new Tone.PolySynth(Tone.MetalSynth).toDestination();
    case "flauta":
      // Onda seno soplada: ataque suave, sostenido mientras dura la nota.
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.08, decay: 0.1, sustain: 0.8, release: 0.3 },
      }).toDestination();
    case "laud":
    default:
      // Cuerda pulsada aproximada: ataque casi inmediato, decae solo (sin sustain real).
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.5, sustain: 0, release: 0.3 },
      }).toDestination();
  }
}

function detenerClave(clave: string): void {
  const activa = activos.get(clave);
  if (!activa) return;
  clearTimeout(activa.temporizador);
  activa.synth.releaseAll();
  // dispose tras la cola de release, para no cortar en seco la última nota
  setTimeout(() => activa.synth.dispose(), 400);
  activos.delete(clave);
}

/**
 * Descarga, parsea y reproduce un MIDI para `clave` (normalmente el
 * sessionId de quien toca). Sustituye cualquier reproducción previa de esa
 * misma clave. `alTerminar` se llama sola al llegar al final del archivo —
 * nunca si se corta antes con `detenerReproduccion` (movimiento, cierre...).
 */
export async function reproducirMidi(clave: string, tipo: TipoInstrumento, midiUrl: string, alTerminar: () => void): Promise<void> {
  detenerClave(clave);
  await Tone.start(); // el contexto de audio exige un gesto de usuario — ya ocurrió (clic en "Tocar")
  const midi = await Midi.fromUrl(midiUrl);

  const synth = crearSynth(tipo);
  const ahora = Tone.now();
  let notas = 0;
  for (const pista of midi.tracks) {
    for (const nota of pista.notes) {
      synth.triggerAttackRelease(nota.name, Math.max(nota.duration, 0.05), ahora + nota.time, nota.velocity || 0.8);
      notas++;
    }
  }
  if (notas === 0) {
    synth.dispose();
    throw new Error("el MIDI no tiene notas");
  }

  const duracionMs = Math.max(midi.duration, 0.1) * 1000 + 500; // colchón para el release de la última nota
  const temporizador = setTimeout(() => {
    detenerClave(clave);
    alTerminar();
  }, duracionMs);
  activos.set(clave, { synth, temporizador });
}

/** Corta la reproducción de `clave` en seco (sin disparar `alTerminar`) — movimiento, cierre de sesión, "Parar" explícito. */
export function detenerReproduccion(clave: string): void {
  detenerClave(clave);
}
