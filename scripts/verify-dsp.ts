/**
 * Verificación del DSP con Node (node-web-audio-api como polyfill de Web Audio).
 *
 * Genera un seno de 440 Hz, lo procesa con la MISMA cadena que usa la app
 * (renderer.ts → dsp.ts) y comprueba:
 *   1. Semitonos independientes: +7 st debe dar ≈ 659.3 Hz sin cambiar la duración.
 *   2. Velocidad 0.8×: duración ≈ 2.5 s y tono ≈ 352 Hz (acoplado, auténtico slowed).
 *   3. Preset completo "Classic Slowed": sin NaN y nivel razonable.
 *   4. Exportación WAV/MP3: archivos válidos (se validan con ffprobe a mano).
 */

import { writeFileSync } from "node:fs";
import {
  OfflineAudioContext,
  AudioBuffer as PolyAudioBuffer,
} from "node-web-audio-api";
import { renderProcessed } from "../src/lib/audio/renderer";
import { buildChain } from "../src/lib/audio/dsp";
import { encodeWav, encodeMp3 } from "../src/lib/audio/encoder";
import { DEFAULT_PARAMS, STYLE_PRESETS } from "../src/lib/audio/presets";

// renderProcessed usa el constructor global, como en el navegador
(globalThis as Record<string, unknown>).OfflineAudioContext = OfflineAudioContext;

const SR = 44100;
const DUR = 2;

function makeSineBuffer(freq: number): PolyAudioBuffer {
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);
  const buf = ctx.createBuffer(2, SR * DUR, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      d[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
    }
  }
  return buf as unknown as PolyAudioBuffer;
}

function makeSilentBuffer(): PolyAudioBuffer {
  const ctx = new OfflineAudioContext(2, SR * DUR, SR);
  const buf = ctx.createBuffer(2, SR * DUR, SR);
  return buf as unknown as PolyAudioBuffer;
}

/** Buffer de seno de `freq` Hz durante `seconds` segundos (para tests largos). */
function makeLongSineBuffer(freq: number, seconds: number): PolyAudioBuffer {
  const n = Math.floor(SR * seconds);
  const ctx = new OfflineAudioContext(2, n, SR);
  const buf = ctx.createBuffer(2, n, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      d[i] = 0.4 * Math.sin((2 * Math.PI * freq * i) / SR);
    }
  }
  return buf as unknown as PolyAudioBuffer;
}

/** RMS en una ventana (piso de ruido). */
function rmsOf(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

function goertzelPower(data: Float32Array, sr: number, freq: number): number {
  const w = (2 * Math.PI * freq) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    const s0 = data[i] + c * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

function dominantFreq(data: Float32Array, sr: number, f0: number, f1: number, step = 2): number {
  let best = -1;
  let bestF = 0;
  for (let f = f0; f <= f1; f += step) {
    const p = goertzelPower(data, sr, f);
    if (p > best) {
      best = p;
      bestF = f;
    }
  }
  return bestF;
}

function centerSlice(buf: PolyAudioBuffer): Float32Array {
  const d = buf.getChannelData(0);
  const skip = Math.floor(SR * 0.3);
  return d.slice(skip, d.length - skip);
}

/** Duración del contenido: último índice con señal apreciable. */
function contentDuration(buf: PolyAudioBuffer): number {
  const d = buf.getChannelData(0);
  for (let i = d.length - 1; i >= 0; i--) {
    if (Math.abs(d[i]) > 0.01) return i / SR;
  }
  return 0;
}

function check(name: string, cond: boolean, detail: string): boolean {
  console.log(`${cond ? "✅" : "❌"} ${name} — ${detail}`);
  return cond;
}

async function main() {
  let ok = true;
  const sine = makeSineBuffer(440);

  // 1) Semitonos independientes (+7 st, tempo intacto)
  const p1 = { ...DEFAULT_PARAMS, speed: 1, semitones: 7, reverbMix: 0, reverbDecay: 0.3, fadeIn: 0, fadeOut: 0, compressor: 0, outputGain: 0 };
  const r1 = await renderProcessed(sine as unknown as AudioBuffer, p1);
  const f1 = dominantFreq(centerSlice(r1), SR, 550, 750);
  ok = check("Semitonos +7", Math.abs(f1 - 659.3) < 12, `dominante ≈ ${f1} Hz (esperado ≈ 659.3)`) && ok;
  ok = check("Tempo intacto con semitonos", Math.abs(contentDuration(r1) - DUR) < 0.15, `contenido ${contentDuration(r1).toFixed(2)} s (esperado ${DUR})`) && ok;

  // 2) Velocidad 0.8× (pitch acoplado, el sound clásico)
  const p2 = { ...DEFAULT_PARAMS, speed: 0.8, semitones: 0, reverbMix: 0, reverbDecay: 0.3, fadeIn: 0, fadeOut: 0, compressor: 0, outputGain: 0 };
  const r2 = await renderProcessed(sine as unknown as AudioBuffer, p2);
  const f2 = dominantFreq(centerSlice(r2), SR, 250, 450);
  ok = check("Velocidad 0.8× (tono acoplado)", Math.abs(f2 - 352) < 10, `dominante ≈ ${f2} Hz (esperado ≈ 352)`) && ok;
  ok = check("Duración 0.8×", Math.abs(contentDuration(r2) - DUR / 0.8) < 0.15, `contenido ${contentDuration(r2).toFixed(2)} s (esperado 2.5)`) && ok;

  // 3) Preset completo "Classic Slowed": cadena completa sin NaN
  const classic = STYLE_PRESETS[0].params;
  const r3 = await renderProcessed(sine as unknown as AudioBuffer, classic);
  const d3 = r3.getChannelData(0);
  let nan = false;
  let peak = 0;
  for (let i = 0; i < d3.length; i++) {
    if (Number.isNaN(d3[i])) nan = true;
    peak = Math.max(peak, Math.abs(d3[i]));
  }
  ok = check("Classic Slowed sin NaN", !nan, `pico ${peak.toFixed(3)}`);
  ok = check("Classic Slowed nivel razonable", peak > 0.01 && peak <= 1.0, `pico ${peak.toFixed(3)}`);

  // 3b) Cambio de estilo "hard" (setPreset) sobre una cadena viva: sin NaN
  const ctxH = new OfflineAudioContext(2, SR, SR);
  const chainH = buildChain(ctxH, STYLE_PRESETS[0].params, false);
  const srcH = ctxH.createBufferSource();
  srcH.buffer = sine;
  srcH.playbackRate.value = STYLE_PRESETS[0].params.speed;
  srcH.connect(chainH.input);
  chainH.output.connect(ctxH.destination);
  chainH.start(0);
  // Cambios de estilo instantáneos (como al pulsar un preset en la app)
  chainH.update(STYLE_PRESETS[5].params, true); // Lo-fi Dream
  chainH.update(STYLE_PRESETS[3].params, true); // Night Drive
  srcH.start(0);
  const rH = await ctxH.startRendering();
  const dH = rH.getChannelData(0);
  let nanH = false;
  let peakH = 0;
  for (let i = 0; i < dH.length; i++) {
    if (Number.isNaN(dH[i])) nanH = true;
    peakH = Math.max(peakH, Math.abs(dH[i]));
  }
  ok = check("Cambio de preset (hard) sin NaN y con señal", !nanH && peakH > 0.01, `pico ${peakH.toFixed(3)}`);

  // 3c) REGRESIÓN: estabilidad a largo plazo. Con semitones 0 el pitch shifter
  //     quedaba atascado en un LFO de 0.01 Hz (periodo 100 s): al ~segundo 50 el
  //     diente de sierra se soltaba y el retardo granular colapsaba, produciendo
  //     una discontinuidad masiva (el "petardeo"/corrupción).
  //     Se renderiza ~58 s con Cinematic (semitones 0) y se mide la mayor
  //     discontinuidad (|d[i]−d[i−1]|) en la zona tardía, donde antes saltaba.
  {
    const long = makeLongSineBuffer(440, 50);
    const cinematic = STYLE_PRESETS.find((s) => s.id === "cinematic")!.params;
    const rL = await renderProcessed(long as unknown as AudioBuffer, cinematic);
    const dL = rL.getChannelData(0);
    let nanL = false;
    for (let i = 0; i < dL.length; i++) if (Number.isNaN(dL[i])) nanL = true;
    // Máxima discontinuidad por ventana de 0.5 s, en la zona relevante
    // (10–52 s: antes del fin de la fuente a ~55.6 s, fuera del fade-in).
    const win = SR * 0.5;
    let maxDiff = 0;
    let maxDiffT = 0;
    for (let start = SR * 10; start < SR * 52; start += win) {
      let md = 0;
      for (let i = Math.max(1, start); i < Math.min(dL.length, start + win); i++) {
        md = Math.max(md, Math.abs(dL[i] - dL[i - 1]));
      }
      if (md > maxDiff) {
        maxDiff = md;
        maxDiffT = start / SR;
      }
    }
    // Con el bug, la zona tardía presentaba un salto de ~0.23 (vs ~0.006 normal
    // en un seno). Un umbral holgado distingue el glitch de la señal limpia.
    const glitchOk = maxDiff < 0.05;
    ok = check(
      "Larga duración Cinematic (semitones 0) sin glitch",
      !nanL && glitchOk,
      `máx discontinuidad ${maxDiff.toFixed(4)} en ~${maxDiffT.toFixed(1)} s`,
    ) && ok;
  }

  // 4b) Piso de ruido por preset: con entrada en silencio, el único sonido que
  //     puede quedar es el vinilo (el wet de un silencio convolucionado es 0).
  //     Verifica que ni el crujido ni la reverb "sisean" de fondo en cascos.
  const silent = makeSilentBuffer();
  for (const id of ["vaporwave", "lofi", "cinematic", "cathedral", "nightdrive"] as const) {
    const preset = STYLE_PRESETS.find((s) => s.id === id)!;
    const r = await renderProcessed(silent as unknown as AudioBuffer, preset.params);
    const d = r.getChannelData(0);
    // Ventana central, fuera de los fades.
    const start = Math.floor(SR * 2);
    const end = Math.max(start + 1, Math.floor(r.length - SR * 2));
    const rmsVal = rmsOf(d.slice(start, end));
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    const withVinyl = id === "vaporwave" || id === "lofi";
    // Con vinilo el siseo debe ser apenas un vaho (RMS muy bajo, sin crackle
    // fuerte); sin vinilo el suelo debe ser digital (0).
    const limit = withVinyl ? 0.008 : 0.0001;
    ok = check(
      `Piso de ruido [${id}]`,
      rmsVal < limit && peak < limit * 6,
      `RMS ${rmsVal.toFixed(5)} / pico ${peak.toFixed(5)}`,
    ) && ok;
  }

  // 4) Encoders: WAV y MP3 a disco para validar con ffprobe
  const wav = encodeWav(r3, 16);
  writeFileSync("/tmp/verify-slowed.wav", Buffer.from(await wav.arrayBuffer()));
  console.log(`💾 WAV escrito: /tmp/verify-slowed.wav (${(wav.size / 1024 / 1024).toFixed(2)} MB)`);

  const mp3 = await encodeMp3(r3, 320);
  writeFileSync("/tmp/verify-slowed.mp3", Buffer.from(await mp3.arrayBuffer()));
  console.log(`💾 MP3 escrito: /tmp/verify-slowed.mp3 (${(mp3.size / 1024).toFixed(0)} KB)`);

  console.log(ok ? "\n🎉 Todos los checks DSP pasaron" : "\n💥 FALLÓ algún check");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("Error en verificación:", e);
  process.exit(1);
});
