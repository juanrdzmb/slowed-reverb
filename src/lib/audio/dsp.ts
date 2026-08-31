/**
 * Motor DSP: construcción de la cadena de efectos con Web Audio API nativa.
 * La misma función `buildChain` se usa para el preview en vivo (AudioContext)
 * y para la exportación (OfflineAudioContext), garantizando que lo que se
 * escucha es exactamente lo que se descarga.
 */

import type { SlowedParams } from "./presets";

const PITCH_WINDOW = 0.1; // ventana del pitch shifter en segundos

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Respuesta de impulso estéreo (ruido con decaimiento exponencial) para el convolver.
 *  La IR es oscura y a bajo nivel: suena a espacio/ambiente, no a "arena" ni a
 *  siseo blanco en auriculares. Se normaliza por pico para que el control de
 *  nivel real de la reverb sea `reverbMix` (independiente del decay). */
export function makeImpulseResponse(ctx: BaseAudioContext, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(decay * sr));
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    // Tres polos paso-bajo en cascada que se oscurece con el tiempo: cola
    // muy grave y sin siseo blanco. Más oscuro que versión anterior para
    // evitar "arena" en auriculares.
    let lp1 = 0;
    let lp2 = 0;
    let lp3 = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = Math.random() * 2 - 1;
      const k = 0.08 + 0.14 * Math.exp(-3 * t);
      lp1 += k * (n - lp1);
      lp2 += k * (lp1 - lp2);
      lp3 += k * (lp2 - lp3);
      d[i] = lp3 * Math.exp(-3.8 * t);
      peak = Math.max(peak, Math.abs(d[i]));
    }
    // Nivel acotado más bajo: 0.09 evita chorro de ruido incluso con mix alto.
    if (peak > 0) {
      const g = 0.09 / peak;
      for (let i = 0; i < len; i++) d[i] *= g;
    }
  }
  return ir;
}

/**
 * Cache de IRs de reverb, acotado (por contexto y decay). Regenerar la IR de
 * forma síncrona en cada cambio de preset (o paso del slider) y asignarla al
 * ConvolverNode bloquea el hilo principal y puede producir glitches de audio
 * (el "petardeo"). Con cache, repetir el mismo decay —p. ej. volver a Classic
 * tras Cathedral— es gratis.
 */
const IR_CACHE = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();
const IR_CACHE_MAX = 24; // acotado: un preset por decay ≈ 8; el slider no desborda

function getImpulseResponse(ctx: BaseAudioContext, decay: number): AudioBuffer {
  let byDecay = IR_CACHE.get(ctx);
  if (!byDecay) {
    byDecay = new Map();
    IR_CACHE.set(ctx, byDecay);
  }
  // Granularidad de 0.05 s: bastan unos pocos valores por preset y evita
  // generar una IR por cada paso imperceptible del slider de reverbDecay.
  const key = Math.round(decay * 20) / 20;
  let buf = byDecay.get(key);
  if (!buf) {
    if (byDecay.size >= IR_CACHE_MAX) byDecay.clear();
    buf = makeImpulseResponse(ctx, decay);
    byDecay.set(key, buf);
  }
  return buf;
}

/** Genera/recupera la IR de reverb para un decay concreto (pre-warm del cache).
 *  Se llama ANTES de programar el corte limpio de un preset para que el bloqueo
 *  síncrono de generación no interrumpa la automatización del silencio. */
export function warmReverbImpulse(ctx: BaseAudioContext, decay: number): void {
  getImpulseResponse(ctx, decay);
}

/** Buffer de crujido de vinilo (siseo cálido + pops esporádicos y suaves) listo para loopear.
 *  Todo el ruido pasa por paso-bajos muy cerrados y a nivel mínimo: en
 *  auriculares es un vaho, nunca siseo blanco ni chasquidos secos. */
export function makeVinylBuffer(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(3 * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let hiss = 0;
    let popEnv = 0;
    let popLp = 0;
    for (let i = 0; i < len; i++) {
      // Siseo aún más cerrado y bajo (corte ~300 Hz aprox): solo cuerpo.
      hiss += 0.03 * (Math.random() * 2 - 1 - hiss);
      let v = hiss * 0.08;
      // Pops más escasos (~0.3/s por canal) y más contenidos.
      if (popEnv === 0 && Math.random() < 0.000007) {
        popEnv = 0.15 + Math.random() * 0.18;
      }
      if (popEnv > 0) {
        // Pop con cuerpo, envuelto en paso-bajo muy cerrado: "plop" cálido.
        popLp += 0.05 * ((Math.random() * 2 - 1) * popEnv - popLp);
        v += popLp * 0.35;
        popEnv *= 0.996;
        if (popEnv < 0.002) popEnv = 0;
      }
      d[i] = v;
    }
    // Loop sin costura: crossfade de 50 ms entre el final y el principio del
    // buffer. Sin esto, cada 3 s el salto del final al inicio produciría un
    // "tic" periódico (que en una canción completa suena a corrupción).
    const cf = Math.floor(0.05 * sr);
    if (cf < len) {
      for (let i = 0; i < cf; i++) {
        const t = i / cf;
        d[i] = d[i] * t + d[len - cf + i] * (1 - t);
      }
    }
  }
  return buf;
}

interface PitchShifter {
  input: GainNode;
  output: GainNode;
  setRatio(ratio: number, live: boolean, when?: number): void;
  start(when: number): void;
  stop(): void;
}

/**
 * Pitch shifter granular de dos taps con crossfade cosenoidal.
 * Desplaza el tono sin alterar el tempo (para el control de semitonos).
 */
function createPitchShifter(ctx: BaseAudioContext): PitchShifter {
  const W = PITCH_WINDOW;
  const input = ctx.createGain();
  const output = ctx.createGain();

  const delay1 = ctx.createDelay(0.5);
  const delay2 = ctx.createDelay(0.5);
  const depth1 = ctx.createGain();
  const depth2 = ctx.createGain();
  const halfDelay = ctx.createDelay(5); // T/2: desfase del segundo tap
  const tapGain1 = ctx.createGain();
  const tapGain2 = ctx.createGain();
  const saw = ctx.createOscillator();
  const cross = ctx.createOscillator();
  const crossDepth = ctx.createGain();
  const crossDelay = ctx.createDelay(5); // 3T/4: convierte seno en coseno
  const crossInv = ctx.createGain();
  // Camino dry de seguridad: silencioso por defecto. Se activa cuando la
  // granulación está en identidad (semitones 0) para dejar pasar la señal
  // sin pasar por los delays granulares (ver setRatio).
  const bypass = ctx.createGain();
  bypass.gain.value = 0;
  // Silenciador del camino granulado: los tapGain están modulados por un
  // oscilador (no basta ponerlos a 0), así que se apaga la salida entera de
  // la granulación a través de este gain.
  const granOut = ctx.createGain();
  granOut.gain.value = 1;

  saw.type = "sawtooth";
  cross.type = "sine";
  saw.frequency.value = 0.01;
  cross.frequency.value = 0.01;
  crossDepth.gain.value = 0.5;
  crossInv.gain.value = -1;
  halfDelay.delayTime.value = Math.min(5, W / (2 * 0.01));
  crossDelay.delayTime.value = 5;
  delay1.delayTime.value = W / 2;
  delay2.delayTime.value = W / 2;
  depth1.gain.value = W / 2;
  depth2.gain.value = W / 2;
  tapGain1.gain.value = 0.5;
  tapGain2.gain.value = 0.5;

  // LFO de retardo: tap1 recibe la rampa completa, tap2 desfasada T/2
  saw.connect(depth1);
  depth1.connect(delay1.delayTime);
  saw.connect(depth2);
  depth2.connect(halfDelay);
  halfDelay.connect(delay2.delayTime);

  input.connect(delay1);
  delay1.connect(tapGain1);
  input.connect(delay2);
  delay2.connect(tapGain2);
  tapGain2.connect(granOut);
  tapGain1.connect(granOut);
  granOut.connect(output);
  // Camino limpio para identidad (sin transposición): sin delays granulares.
  input.connect(bypass);
  bypass.connect(output);

  // Crossfade: gain1 = 0.5 + 0.5·cos(ωt), gain2 = 0.5 − 0.5·cos(ωt)
  cross.connect(crossDepth);
  crossDepth.connect(crossDelay);
  crossDelay.connect(tapGain1.gain);
  crossDelay.connect(crossInv);
  crossInv.connect(tapGain2.gain);

  function setRatio(ratio: number, live: boolean, when?: number) {
    const now = when ?? ctx.currentTime;
    const tc = live ? 0.03 : 0.05;
    const S = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, tc);

    const isIdentity = Math.abs(ratio - 1) < 1e-6;
    if (isIdentity) {
      // Sin transposición (semitones 0 = casi todos los presets). Antes el
      // granulator se atascaba en un LFO de 0.01 Hz (periodo 100 s): durante
      // los primeros ~50 s el retardo barre hacia el tope y suena "bien", pero
      // al soltarse el diente de sierra el puntero de lectura alcanzaba al de
      // escritura y el audio se "petardeaba"/corrompía. Aquí se silencia la
      // granulación (los delays quedan mudos) y se pasa la señal por un camino
      // dry limpio y sin latencia.
      S(saw.frequency, 0);
      S(cross.frequency, 0);
      S(depth1.gain, 0);
      S(depth2.gain, 0);
      S(granOut.gain, 0);
      S(bypass.gain, 1);
      return;
    }

    // Granulación activa (transposición real): re-activa la ruta granular y
    // apaga el dry. Se mantiene con rampa (setTargetAtTime) también en cambios
    // de preset: el granulator se desliza al nuevo ratio en lugar de saltar en
    // seco (evita el transitorio "roto/ondulante").
    const f = (1 - ratio) / W; // frecuencia de rampa (con signo)
    const freq = Math.max(0.01, Math.min(40, Math.abs(f)));
    const period = 1 / freq;
    const sign = f >= 0 ? 1 : -1;
    S(bypass.gain, 0);
    S(granOut.gain, 1);
    S(saw.frequency, freq);
    S(cross.frequency, freq);
    S(depth1.gain, (sign * W) / 2);
    S(depth2.gain, (sign * W) / 2);
    S(halfDelay.delayTime, Math.min(5, period / 2));
    S(crossDelay.delayTime, Math.min(5, (3 * period) / 4));
  }

  return {
    input,
    output,
    setRatio,
    start(when: number) {
      saw.start(when);
      cross.start(when);
    },
    stop() {
      try {
        saw.stop();
      } catch {
        // no iniciado
      }
      try {
        cross.stop();
      } catch {
        // no iniciado
      }
    },
  };
}

interface StereoWidth {
  input: GainNode;
  output: GainNode;
  setWidth(w: number, live: boolean, when?: number): void;
}

/** Ancho estéreo vía matriz mid/side (1 = original, 0 = mono, 2 = ultra ancho). */
function createStereoWidth(ctx: BaseAudioContext): StereoWidth {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const mL = ctx.createGain();
  const mR = ctx.createGain();
  const sL = ctx.createGain();
  const sR = ctx.createGain();
  const mid = ctx.createGain();
  const side = ctx.createGain();
  const midL = ctx.createGain();
  const midR = ctx.createGain();
  const sideL = ctx.createGain();
  const sideR = ctx.createGain();

  mL.gain.value = 0.5;
  mR.gain.value = 0.5;
  sL.gain.value = 0.5;
  sR.gain.value = -0.5;
  midL.gain.value = 1;
  midR.gain.value = 1;
  sideL.gain.value = 1;
  sideR.gain.value = -1;

  input.connect(splitter);
  splitter.connect(mL, 0);
  splitter.connect(mR, 1);
  mL.connect(mid);
  mR.connect(mid);
  splitter.connect(sL, 0);
  splitter.connect(sR, 1);
  sL.connect(side);
  sR.connect(side);

  mid.connect(midL);
  mid.connect(midR);
  side.connect(sideL);
  side.connect(sideR);
  midL.connect(merger, 0, 0);
  sideL.connect(merger, 0, 0);
  midR.connect(merger, 0, 1);
  sideR.connect(merger, 0, 1);
  merger.connect(output);

  return {
    input,
    output,
    setWidth(w, live, when?: number) {
      const now = when ?? ctx.currentTime;
      const S = (p: AudioParam, v: number) =>
        live ? p.setTargetAtTime(v, now, 0.02) : p.setValueAtTime(v, now);
      S(sideL.gain, w);
      S(sideR.gain, -w);
    },
  };
}

export interface ChainHandle {
  input: GainNode;
  output: GainNode;
  /** Nodo para automatización de fades (fade-in / fade-out). */
  master: GainNode;
  /** Arranca los osciladores y el vinilo (se llama una vez por contexto). */
  start(when: number): void;
  /** Detiene osciladores y vinilo (para descartar la cadena sin fugas). */
  stop(): void;
  /** Aplica los parámetros sobre los nodos existentes sin reconstruir.
   *  `hard` = cambio de estilo: valores instantáneos, sin rampas musicales.
   *  `when` = programa la aplicación en un tiempo futuro (corte limpio: los
   *  saltos de filtros/IR/pitch se aplican dentro del silencio). */
  update(params: SlowedParams, hard?: boolean, when?: number): void;
}

/**
 * Construye la cadena completa:
 * entrada → pitch shifter → paso-bajo → graves → brillo → wobble →
 * ancho estéreo → reverb (dry/wet) + vinilo → compresor → ganancia → limitador → salida
 */
export function buildChain(
  ctx: BaseAudioContext,
  params: SlowedParams,
  live: boolean,
): ChainHandle {
  const input = ctx.createGain();
  const master = ctx.createGain();
  const output = ctx.createGain();

  // Pitch shifter (semitonos independientes del tempo)
  const shifter = createPitchShifter(ctx);

  // Filtros y EQ
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.value = 0.707;
  const bass = ctx.createBiquadFilter();
  bass.type = "lowshelf";
  bass.frequency.value = 120;
  const treble = ctx.createBiquadFilter();
  treble.type = "highshelf";
  treble.frequency.value = 6000;

  // Wobble (chorus: LFO modulando el retardo)
  const wobDelay = ctx.createDelay(0.1);
  wobDelay.delayTime.value = 0.012;
  const wobLfo = ctx.createOscillator();
  wobLfo.type = "sine";
  const wobDepth = ctx.createGain();
  const wobWet = ctx.createGain();
  const wobDry = ctx.createGain();

  // Reverb por convolución
  const preDelay = ctx.createDelay(0.5);
  const convolver = ctx.createConvolver();
  let currentDecay = -1;
  const wet = ctx.createGain();
  const dry = ctx.createGain();

  // Ancho estéreo
  const width = createStereoWidth(ctx);

  // Compresor + limitador de seguridad
  const comp = ctx.createDynamicsCompressor();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;

  // Crujido de vinilo (con paso-bajo dedicado: corta cualquier resto de siseo)
  const vinylSrc = ctx.createBufferSource();
  vinylSrc.buffer = makeVinylBuffer(ctx);
  vinylSrc.loop = true;
  const vinylFilter = ctx.createBiquadFilter();
  vinylFilter.type = "lowpass";
  vinylFilter.frequency.value = 2400;
  vinylFilter.Q.value = 0.707;
  const vinylGain = ctx.createGain();

  // Ganancia de salida
  const outGain = ctx.createGain();

  // Conexiones
  input.connect(shifter.input);
  shifter.output.connect(lowpass);
  lowpass.connect(bass);
  bass.connect(treble);
  treble.connect(wobDry);
  wobDry.connect(width.input);
  treble.connect(wobDelay);
  wobDelay.connect(wobWet);
  wobWet.connect(width.input);
  width.output.connect(dry);
  dry.connect(master);
  width.output.connect(preDelay);
  preDelay.connect(convolver);
  convolver.connect(wet);
  wet.connect(master);
  vinylSrc.connect(vinylFilter);
  vinylFilter.connect(vinylGain);
  vinylGain.connect(master);
  master.connect(comp);
  comp.connect(outGain);
  outGain.connect(limiter);
  limiter.connect(output);

  const apply = (p: SlowedParams, useRamps: boolean, when?: number) => {
    const now = when ?? ctx.currentTime;
    const S = (param: AudioParam, v: number) =>
      useRamps ? param.setTargetAtTime(v, now, 0.02) : param.setValueAtTime(v, now);

    S(lowpass.frequency, p.lowpassHz);
    S(bass.gain, p.bassGain);
    S(treble.gain, p.trebleGain);

    // Reverb: la cola se regenera solo si cambia el decay; el cache evita
    // regenerar repetidamente la misma IR (bloqueo del hilo y glitches).
    if (Math.abs(currentDecay - p.reverbDecay) > 0.01) {
      currentDecay = p.reverbDecay;
      convolver.buffer = getImpulseResponse(ctx, p.reverbDecay);
    }
    S(dry.gain, 1 - p.reverbMix * 0.5);
    S(wet.gain, p.reverbMix);
    S(preDelay.delayTime, p.reverbPreDelay / 1000);

    // Wobble
    S(wobLfo.frequency, p.wobbleRate);
    S(wobDepth.gain, 0.0075 * p.wobbleDepth);
    S(wobWet.gain, p.wobbleDepth * 0.6);
    S(wobDry.gain, 1 - p.wobbleDepth * 0.4);

    // Vinilo, ancho, salida, compresión (vinilo atenuado: antes 0.4 siseaba en cascos)
    S(vinylGain.gain, p.vinylAmount * 0.25);
    S(outGain.gain, dbToGain(p.outputGain));
    S(comp.threshold, -p.compressor * 16);
    S(comp.ratio, 1 + p.compressor * 6);
    S(comp.knee, 6);
    S(comp.attack, 0.01);
    S(comp.release, 0.25);

    width.setWidth(p.stereoWidth, useRamps, when);
    shifter.setRatio(Math.pow(2, p.semitones / 12), useRamps, when);
  };

  apply(params, live);

  return {
    input,
    output,
    master,
    start(when: number) {
      shifter.start(when);
      wobLfo.start(when);
      vinylSrc.start(when);
    },
    update(p: SlowedParams, hard = false, when?: number) {
      apply(p, !hard, when);
    },
    stop() {
      shifter.stop();
      try {
        wobLfo.stop();
      } catch {
        // no iniciado
      }
      try {
        vinylSrc.stop();
      } catch {
        // no iniciado
      }
    },
  };
}

