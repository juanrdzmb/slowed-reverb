/**
 * Parámetros de la cadena de audio y presets de estilo.
 * Todos los valores se aplican tanto al preview en vivo como al
 * renderizado offline (exportación), con la misma implementación.
 */

export interface SlowedParams {
  /** Velocidad de reproducción (1 = original, 0.85 = 15% más lento). El tono baja acoplado. */
  speed: number;
  /** Cambio de tono adicional en semitonos, independiente del tempo. */
  semitones: number;
  /** Filtro paso-bajo en Hz (20000 = sin filtrar). */
  lowpassHz: number;
  /** Refuerzo de graves en dB (lowshelf ~120 Hz). */
  bassGain: number;
  /** Brillo en dB (highshelf ~6 kHz). */
  trebleGain: number;
  /** Mezcla de reverb 0–1. */
  reverbMix: number;
  /** Duración de la cola de reverb en segundos. */
  reverbDecay: number;
  /** Pre-delay del reverb en ms. */
  reverbPreDelay: number;
  /** Velocidad del wobble/chorus en Hz. */
  wobbleRate: number;
  /** Profundidad del wobble 0–1. */
  wobbleDepth: number;
  /** Ancho estéreo 0–2 (1 = original). */
  stereoWidth: number;
  /** Crujido de vinilo 0–1. */
  vinylAmount: number;
  /** Fade-in en segundos. */
  fadeIn: number;
  /** Fade-out en segundos. */
  fadeOut: number;
  /** Ganancia de salida en dB. */
  outputGain: number;
  /** Cantidad de compresión 0–1 (0 = desactivada). */
  compressor: number;
}

export const DEFAULT_PARAMS: SlowedParams = {
  speed: 0.85,
  semitones: 0,
  lowpassHz: 20000,
  bassGain: 0,
  trebleGain: 0,
  reverbMix: 0.3,
  reverbDecay: 2.8,
  reverbPreDelay: 20,
  wobbleRate: 0.8,
  wobbleDepth: 0,
  stereoWidth: 1.1,
  vinylAmount: 0,
  fadeIn: 0,
  fadeOut: 2,
  outputGain: -1,
  compressor: 0.5,
};

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  params: SlowedParams;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "classic",
    name: "Classic Slowed",
    description: "El sound clásico: 15% más lento con reverb suave y graves presentes.",
    icon: "🌙",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.85,
      reverbMix: 0.3,
      reverbDecay: 2.8,
      bassGain: 2.5,
      stereoWidth: 1.1,
      compressor: 0.45,
      outputGain: -1,
    },
  },
  {
    id: "deep",
    name: "Deep Slowed",
    description: "Muy lento y profundo, con cola de reverb larga y cuerpo pesado.",
    icon: "🌊",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.75,
      semitones: 0,
      reverbMix: 0.34,
      reverbDecay: 3.8,
      bassGain: 3.2,
      lowpassHz: 14000,
      stereoWidth: 1.18,
      compressor: 0.4,
      outputGain: -1.4,
      fadeOut: 3,
    },
  },
  {
    id: "cathedral",
    name: "Slowed + Heavy Reverb",
    description: "Reverb de catedral con pre-delay amplio. Máxima atmósfera.",
    icon: "⛪",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.82,
      reverbMix: 0.38,
      reverbDecay: 4.8,
      reverbPreDelay: 35,
      bassGain: 2.2,
      lowpassHz: 13000,
      stereoWidth: 1.18,
      compressor: 0.35,
      outputGain: -1.6,
    },
  },
  {
    id: "nightdrive",
    name: "Night Drive",
    description: "Filtro cálido, graves marcados y estéreo ancho. Perfecto para conducir de noche.",
    icon: "🌃",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.8,
      lowpassHz: 11000,
      bassGain: 3.0,
      reverbMix: 0.32,
      reverbDecay: 3.0,
      stereoWidth: 1.22,
      compressor: 0.4,
      outputGain: -1.2,
      fadeOut: 2.5,
    },
  },
  {
    id: "vaporwave",
    name: "Vaporwave",
    description: "Wobble de cinta, crujido sutil y reverb espacioso. Estética Mallsoft.",
    icon: "📼",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.78,
      lowpassHz: 11000,
      bassGain: 1.8,
      reverbMix: 0.30,
      reverbDecay: 3.6,
      wobbleRate: 0.6,
      wobbleDepth: 0.20,
      vinylAmount: 0.03,
      stereoWidth: 1.18,
      outputGain: -1.0,
    },
  },
  {
    id: "lofi",
    name: "Lo-fi Dream",
    description: "Radio lo-fi: filtro cerrado, vinilo crujiente y vibrato analógico.",
    icon: "💿",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.85,
      lowpassHz: 7000,
      trebleGain: -4,
      bassGain: 1.6,
      reverbMix: 0.20,
      reverbDecay: 2,
      wobbleRate: 1.2,
      wobbleDepth: 0.18,
      vinylAmount: 0.09,
      stereoWidth: 1,
      outputGain: -0.8,
    },
  },
  {
    id: "nightcore",
    name: "Nightcore",
    description: "El efecto inverso: acelerado, brillante y con energía extra.",
    icon: "⚡",
    params: {
      ...DEFAULT_PARAMS,
      speed: 1.25,
      bassGain: 2,
      trebleGain: 2,
      reverbMix: 0.2,
      reverbDecay: 1.8,
      stereoWidth: 1.05,
      fadeOut: 1,
    },
  },
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Reverb enorme con fade-in y fade-out largos. Para trailers y finales épicos.",
    icon: "🎬",
    params: {
      ...DEFAULT_PARAMS,
      speed: 0.9,
      reverbMix: 0.34,
      reverbDecay: 4.6,
      reverbPreDelay: 35,
      bassGain: 1.8,
      stereoWidth: 1.15,
      compressor: 0.35,
      outputGain: -1.3,
      fadeIn: 1.2,
      fadeOut: 5,
    },
  },
];
