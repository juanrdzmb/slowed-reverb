/**
 * Renderizado offline: aplica la misma cadena de efectos que el preview
 * usando OfflineAudioContext, a la tasa de muestreo del archivo original.
 */

import { buildChain } from "./dsp";
import type { SlowedParams } from "./presets";

export async function renderProcessed(
  buffer: AudioBuffer,
  params: SlowedParams,
): Promise<AudioBuffer> {
  const sr = buffer.sampleRate;
  const speed = Math.max(0.1, params.speed);
  const dur =
    buffer.duration / speed +
    params.reverbDecay + // cola de reverb
    params.fadeOut +
    params.fadeIn / speed +
    0.5;

  const ctx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const chain = buildChain(ctx, params, false);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = speed;
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  chain.start(0);

  // Fades sobre la línea de tiempo de salida
  const master = chain.master.gain;
  const end = dur;
  if (params.fadeIn > 0) {
    master.setValueAtTime(0, 0);
    master.linearRampToValueAtTime(1, Math.min(params.fadeIn, end / 2));
  } else {
    master.setValueAtTime(1, 0);
  }
  if (params.fadeOut > 0) {
    master.setValueAtTime(1, Math.max(0, end - params.fadeOut));
    master.linearRampToValueAtTime(0, end);
  }

  src.start(0);
  return ctx.startRendering();
}
