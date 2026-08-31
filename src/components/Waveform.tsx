"use client";

import { useCallback, useEffect, useRef } from "react";

interface WaveformProps {
  buffer: AudioBuffer;
  /** Duración efectiva del resultado (con la velocidad aplicada). */
  duration: number;
  getTime: () => number;
  onSeek: (pos: number) => void;
}

/**
 * Forma de onda dibujada en canvas a partir de los picos del AudioBuffer.
 * Se controla con el motor propio (no con un <audio>) para que la posición
 * del cursor coincida exactamente con la cadena de efectos.
 */
export default function Waveform({ buffer, duration, getTime, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<{ min: Float32Array; max: Float32Array } | null>(null);
  const rafRef = useRef(0);
  const durationRef = useRef(duration);
  const getTimeRef = useRef(getTime);
  const bufferRef = useRef(buffer);

  // refs siempre actualizados sin recrear el RAF
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);
  useEffect(() => {
    getTimeRef.current = getTime;
  }, [getTime]);
  useEffect(() => {
    bufferRef.current = buffer;
    peaksRef.current = null;
  }, [buffer]);

  const computePeaks = useCallback(
    (width: number) => {
      if (width <= 0) return;
      const buf = bufferRef.current;
      const numCh = Math.min(2, buf.numberOfChannels);
      const peaks = { min: new Float32Array(width), max: new Float32Array(width) };
      const step = Math.max(1, Math.floor(buf.length / width));
      const data: Float32Array[] = [];
      for (let c = 0; c < numCh; c++) data.push(buf.getChannelData(c));
      for (let x = 0; x < width; x++) {
        let min = 0;
        let max = 0;
        const start = x * step;
        const end = Math.min(buf.length, start + step);
        for (let i = start; i < end; i++) {
          for (let c = 0; c < numCh; c++) {
            const v = data[c][i];
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
        peaks.min[x] = min;
        peaks.max[x] = max;
      }
      peaksRef.current = peaks;
    },
    [],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(0, Math.floor(canvas.clientWidth));
    const h = Math.max(0, Math.floor(canvas.clientHeight));
    if (w === 0 || h === 0) return;
    // Solo invalida picos si cambia el tamaño bitmap real
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      peaksRef.current = null;
    }
    // No recalcular si el ancho no coincide con el cache; ancho estable
    if (!peaksRef.current || peaksRef.current.min.length !== w) computePeaks(w);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const peaks = peaksRef.current;
    const dur = durationRef.current;
    const progress = dur > 0 ? Math.min(1, getTimeRef.current() / dur) : 0;

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(0, h / 2 - 0.5, w, 1);

    if (peaks && peaks.min.length === w) {
      const mid = h / 2;
      const scale = (h / 2 - 4) * 1.25;
      for (let x = 0; x < w; x++) {
        const y1 = mid - peaks.max[x] * scale;
        const y2 = mid - peaks.min[x] * scale;
        ctx.fillStyle = x / w < progress ? "#8b5cf6" : "#3f3f46";
        ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(1, y2 - y1));
      }
      ctx.fillStyle = "#e4e4e7";
      ctx.fillRect(Math.round(progress * w), 0, 2, h);
    }
  }, [computePeaks]);

  useEffect(() => {
    const loop = () => {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio * duration);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className="h-28 w-full cursor-pointer rounded-xl"
    />
  );
}
