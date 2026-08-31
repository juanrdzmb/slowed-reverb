/**
 * Motor de reproducción en vivo: buffer → cadena de efectos → salida.
 * Soporta play/pausa/seek, cambio de parámetros en caliente y A/B
 * (escuchar el original vs. el procesado en el mismo punto).
 */

import { buildChain, warmReverbImpulse, type ChainHandle } from "./dsp";
import type { SlowedParams } from "./presets";

export class SlowedEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private chain: ChainHandle | null = null;
  private source: AudioBufferSourceNode | null = null;
  private srcGain: GainNode | null = null;
  private bypassGain: GainNode | null = null;
  private processedGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private volume = 1;
  private params: SlowedParams;
  private playing = false;
  private startedAt = 0;
  private offset = 0;
  private bypassed = false;

  /** Avisan a la UI cuando la reproducción termina de forma natural. */
  onEnded: (() => void) | null = null;

  constructor(params: SlowedParams) {
    this.params = { ...params };
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // Volumen de monitor: solo afecta a la escucha, nunca a la exportación.
      this.monitorGain = this.ctx.createGain();
      this.monitorGain.gain.value = this.volume;
      this.monitorGain.connect(this.ctx.destination);
      // Camino del original (bypass) y camino procesado, con crossfade A/B
      // a nivel de salida: al escuchar el original, TODO lo procesado
      // (reverb, vinilo, wobble…) queda realmente silenciado.
      this.bypassGain = this.ctx.createGain();
      this.bypassGain.gain.value = 0;
      this.bypassGain.connect(this.monitorGain);
      this.processedGain = this.ctx.createGain();
      this.processedGain.gain.value = 1;
      this.processedGain.connect(this.monitorGain);
    }
    return this.ctx;
  }

  async load(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureCtx();
    const buf = await ctx.decodeAudioData(data);
    this.setBuffer(buf);
    return buf;
  }

  setBuffer(buf: AudioBuffer): void {
    this.stopSource();
    const ctx = this.ensureCtx();
    this.buffer = buf;
    const prev = this.chain;
    this.chain = buildChain(ctx, this.params, true);
    this.chain.output.connect(this.processedGain!);
    this.chain.start(ctx.currentTime);
    // La cadena anterior debe salir del grafo Y dejar de generar audio: si no,
    // su fuente de vinilo (en loop) y sus osciladores seguirían consumiendo
    // CPU (y sonando, en el caso del vinilo, por debajo del audio nuevo).
    if (prev) {
      try {
        prev.output.disconnect();
      } catch {
        // ya desconectada
      }
      prev.stop();
    }
    this.processedGain!.gain.cancelScheduledValues(ctx.currentTime);
    this.processedGain!.gain.setValueAtTime(this.bypassed ? 0 : 1, ctx.currentTime);
    this.offset = 0;
    this.playing = false;
    // En parada el camino procesado queda en silencio: sin vinilo ni colas
    // hasta que el usuario pulse play (syncProcessedGain lo reactiva).
    this.syncProcessedGain(0);
  }

  /** Duración de la línea de tiempo actual (sin la cola de reverb).
   *  En modo original la reproducción va a ritmo 1. */
  get duration(): number {
    if (!this.buffer) return 0;
    return this.bypassed ? this.buffer.duration : this.buffer.duration / this.params.speed;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  getTime(): number {
    if (!this.playing || !this.ctx) return this.offset;
    const rate = this.bypassed ? 1 : this.params.speed;
    const t = this.offset + (this.ctx.currentTime - this.startedAt) * rate;
    return Math.min(t, this.duration);
  }

  async play(): Promise<void> {
    if (!this.buffer || this.playing) return;
    const ctx = this.ensureCtx();
    if (ctx.state === "suspended") await ctx.resume();
    this.startSource(this.offset);
    this.syncProcessedGain(0.03); // re-entra el efecto tras la pausa
  }

  pause(): void {
    if (!this.playing) return;
    this.offset = this.getTime();
    this.playing = false;
    // Fade-out del camino procesado ANTES de detener la fuente: corta de forma
    // inaudible la cola de reverb y el vinilo (que si no seguirían sonando
    // tras la pausa, con eco largo en presets tipo Cinematic).
    this.syncProcessedGain(0.12);
    this.stopSource();
  }

  seek(pos: number): void {
    if (!this.buffer) return;
    const p = Math.max(0, Math.min(pos, this.duration));
    if (this.playing) {
      this.startSource(p);
    } else {
      this.offset = p;
    }
  }

  /** Volumen del camino procesado según transporte y modo A/B. En pausa o en
   *  modo Original queda en 0: sin colas de reverb ni vinilo de fondo. */
  private syncProcessedGain(fade = 0): void {
    if (!this.ctx || !this.processedGain) return;
    const t = this.ctx.currentTime;
    const g = this.processedGain.gain;
    const target = this.playing && !this.bypassed ? 1 : 0;
    g.cancelScheduledValues(t);
    if (fade <= 0) {
      g.setValueAtTime(target, t);
    } else {
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(target, t + fade);
    }
  }

  setParams(p: SlowedParams): void {
    this.applyParams(p, false);
  }

  /**
   * Cambio de estilo completo (preset): corte limpio. Se silencia el camino
   * procesado durante un instante, se aplican TODOS los parámetros de golpe
   * (matando la cola de reverb y el estado del wobble/pitch del estilo
   * anterior) y se vuelve a entrar. Así cada estilo se escucha desde cero,
   * sin mezclarse con el anterior.
   */
  setPreset(p: SlowedParams): void {
    this.applyParams(p, true);
  }

  private applyParams(p: SlowedParams, hard: boolean): void {
    const oldSpeed = this.params.speed;
    const speedChanged = Math.abs(p.speed - oldSpeed) > 1e-6;
    const pos = this.getTime(); // tiempo de salida con el speed anterior
    const wasPlaying = this.playing;

    // Pre-warm de la IR de reverb ANTES de tocar nada: si el preset cambia el
    // decay, la generación síncrona de la IR (o su recuperación del cache) se
    // hace aquí, de forma que el bloqueo no interrumpa la programación del
    // corte limpio que viene después.
    if (hard && this.ctx && Math.abs(p.reverbDecay - this.params.reverbDecay) > 0.01) {
      warmReverbImpulse(this.ctx, p.reverbDecay);
    }

    this.params = { ...p };

    if (this.ctx && this.chain) {
      if (hard) {
        const t = this.ctx.currentTime;
        const g = this.processedGain!.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        // Corte limpio: silencio rápido y valores del preset nuevo programados
        // dentro del silencio (t+70ms). Para decays largos (>4s) se alarga el
        // silencio a 320ms para que la cola anterior y los ramps del pitch/wobble
        // no se mezclen con el nuevo preset. En pausa/bypass no re-entra.
        const maxDecay = Math.max(this.params.reverbDecay, p.reverbDecay);
        const reentry = maxDecay > 4 ? 0.32 : 0.22;
        g.linearRampToValueAtTime(0, t + 0.04);
        this.chain.update(this.params, true, t + 0.07);
        // Mata la cola anterior: el wet anterior se va con el processedGain a 0,
        // el nuevo wet ya entra al nivel del preset nuevo dentro del silencio.
        if (!this.bypassed && this.playing) {
          g.setValueAtTime(0, t + 0.1);
          g.linearRampToValueAtTime(1, t + reentry);
        }
      } else {
        this.chain.update(this.params, hard);
      }
    }

    if (!this.buffer || !speedChanged || this.bypassed) return;
    // El cambio de velocidad desplaza la línea de tiempo: conservamos la
    // posición *en la canción* (no el tiempo de salida) para que no se vaya
    // atrás/adelante. pos es tiempo de salida con oldSpeed -> srcPos = pos*oldSpeed.
    const srcPos = pos * oldSpeed;
    const newPos = srcPos / p.speed;
    const clamped = Math.min(Math.max(0, newPos), this.duration);
    if (wasPlaying) {
      this.restartCrossfade(clamped);
    } else {
      this.offset = clamped;
    }
  }

  /** Volumen de escucha 0–1. Solo afecta al preview, no a la exportación. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx && this.monitorGain) {
      this.monitorGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /** true = escuchar el original (a ritmo 1, 100% limpio); false = procesado. */
  setBypass(b: boolean): void {
    const wasBypassed = this.bypassed;
    const pos = this.getTime(); // posición con la velocidad del modo ACTUAL
    this.bypassed = b;
    if (!this.ctx || !this.chain || !this.buffer) return;
    const t = this.ctx.currentTime;
    this.bypassGain!.gain.setTargetAtTime(b ? 1 : 0, t, 0.01);
    // El gain del camino procesado se calcula según transporte y modo A/B:
    // en pausa debe seguir en 0 aunque se pase a modo Slowed (si no, el
    // vinilo sonaría de fondo sin reproducción).
    this.syncProcessedGain(0.02);
    if (b === wasBypassed) return;
    // El rate de la fuente cambia entre modos (1 vs. speed): la línea de
    // tiempo es distinta, así que hay que recolocar la reproducción.
    if (this.playing) {
      // Reinicia en la misma posición de la canción (con crossfade).
      this.restartCrossfade(Math.min(pos, this.duration));
    } else {
      // En pausa: convierte el offset para no "saltar" de punto en la canción.
      const speed = this.params.speed;
      const srcOffset = wasBypassed ? this.offset : this.offset * speed;
      this.offset = b
        ? Math.min(srcOffset, this.duration)
        : Math.min(srcOffset / speed, this.duration);
    }
  }

  get isBypassed(): boolean {
    return this.bypassed;
  }

  /** Reinicia la fuente en `pos` con un crossfade corto para evitar clics. */
  private restartCrossfade(pos: number): void {
    const ctx = this.ctx!;
    const oldSrc = this.source;
    const oldGain = this.srcGain;
    if (oldSrc && oldGain) {
      const now = ctx.currentTime;
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0, now + 0.04);
      oldSrc.onended = null;
      try {
        oldSrc.stop(now + 0.06);
      } catch {
        // ya estaba detenida
      }
    }
    this.source = null;
    this.srcGain = null;
    this.startSource(pos, true);
  }

  private startSource(pos: number, fadeIn = false): void {
    const ctx = this.ensureCtx();
    if (!this.buffer || !this.chain || !this.bypassGain) return;
    this.stopSource();

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    // Modo original: ritmo 1, tal cual se subió. Procesado: speed del efecto.
    src.playbackRate.value = this.bypassed ? 1 : this.params.speed;
    const srcGain = ctx.createGain();
    src.connect(srcGain);
    srcGain.connect(this.chain!.input);
    src.connect(this.bypassGain!);

    if (fadeIn) {
      // Entrada suave al solaparse con la fuente anterior (crossfade).
      const now = ctx.currentTime;
      srcGain.gain.setValueAtTime(0, now);
      srcGain.gain.linearRampToValueAtTime(1, now + 0.04);
    }

    // Fades: se programan al arrancar desde el principio (solo camino
    // procesado; en modo original la cadena está silenciada y no aplican).
    const master = this.chain!.master.gain;
    master.cancelScheduledValues(ctx.currentTime);
    const now = ctx.currentTime;
    if (!this.bypassed && pos < 0.01) {
      const end = now + this.duration;
      if (this.params.fadeIn > 0) {
        master.setValueAtTime(0, now);
        master.linearRampToValueAtTime(1, now + this.params.fadeIn);
      } else {
        master.setValueAtTime(1, now);
      }
      if (this.params.fadeOut > 0) {
        const foStart = Math.max(now, end - this.params.fadeOut);
        master.setValueAtTime(1, foStart);
        master.linearRampToValueAtTime(0, end);
      }
    } else {
      master.setValueAtTime(1, now);
    }

    src.onended = () => {
      // Solo reacciona si sigue siendo la fuente activa: los stop() manuales
      // disparan onended de forma asincrónica y no deben reiniciar el estado.
      if (this.source !== src) return;
      this.playing = false;
      this.offset = 0;
      // Fin natural: apaga el camino procesado (cola de reverb + vinilo) con
      // un fade suave; si no, el vinilo seguiría sonando tras la canción.
      this.syncProcessedGain(0.5);
      try {
        src.disconnect();
        srcGain.disconnect();
      } catch {
        // ya desconectados
      }
      this.onEnded?.();
    };

    const rate = this.bypassed ? 1 : this.params.speed;
    const srcOffset = Math.max(0, Math.min(pos * rate, this.buffer.duration - 0.01));
    src.start(0, srcOffset);
    this.source = src;
    this.srcGain = srcGain;
    this.startedAt = ctx.currentTime;
    this.offset = pos;
    this.playing = true;
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // ya estaba detenida
      }
      this.source.disconnect();
      this.srcGain?.disconnect();
      this.source = null;
      this.srcGain = null;
    }
  }

  dispose(): void {
    this.stopSource();
    this.chain?.stop();
    this.ctx?.close();
    this.ctx = null;
    this.chain = null;
    this.buffer = null;
    this.bypassGain = null;
    this.processedGain = null;
    this.monitorGain = null;
  }
}
