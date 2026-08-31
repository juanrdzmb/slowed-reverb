"use client";

import { useState } from "react";
import Slider from "@/components/ui/Slider";
import type { SlowedParams } from "@/lib/audio/presets";

interface ControlPanelProps {
  params: SlowedParams;
  onChange: (partial: Partial<SlowedParams>) => void;
}

const hz = (v: number) => (v >= 20000 ? "sin filtro" : `${(v / 1000).toFixed(1)} kHz`);
const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => `${v.toFixed(1)} s`;
const speedFmt = (v: number) => `${v.toFixed(2)}×`;

export default function ControlPanel({ params, onChange }: ControlPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Controles avanzados
        </span>
        <span className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div className="space-y-6 border-t border-zinc-800 px-5 py-5">
          <section>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-violet-400">
              Velocidad y tono
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Slider
                label="Velocidad"
                value={params.speed}
                min={0.5}
                max={1.5}
                step={0.01}
                format={speedFmt}
                onChange={(v) => onChange({ speed: v })}
              />
              <Slider
                label="Semitonos (tono independiente)"
                value={params.semitones}
                min={-12}
                max={12}
                step={0.5}
                format={(v) => `${v > 0 ? "+" : ""}${v} st`}
                onChange={(v) => onChange({ semitones: v })}
              />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-violet-400">
              Filtro y EQ
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Slider
                label="Paso-bajo"
                value={params.lowpassHz}
                min={500}
                max={20000}
                step={100}
                format={hz}
                onChange={(v) => onChange({ lowpassHz: v })}
              />
              <Slider
                label="Graves"
                value={params.bassGain}
                min={-12}
                max={12}
                step={0.5}
                format={db}
                onChange={(v) => onChange({ bassGain: v })}
              />
              <Slider
                label="Brillo"
                value={params.trebleGain}
                min={-12}
                max={12}
                step={0.5}
                format={db}
                onChange={(v) => onChange({ trebleGain: v })}
              />
            </div>
          </section>

          <ReverbSection params={params} onChange={onChange} />
          <TextureSection params={params} onChange={onChange} />
          <OutputSection params={params} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  params: SlowedParams;
  onChange: (partial: Partial<SlowedParams>) => void;
}

function ReverbSection({ params, onChange }: SectionProps) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-violet-400">
        Reverb
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Slider
          label="Mezcla"
          value={params.reverbMix}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => onChange({ reverbMix: v })}
        />
        <Slider
          label="Duración de la cola"
          value={params.reverbDecay}
          min={0.3}
          max={10}
          step={0.1}
          format={sec}
          onChange={(v) => onChange({ reverbDecay: v })}
        />
        <Slider
          label="Pre-delay"
          value={params.reverbPreDelay}
          min={0}
          max={100}
          step={1}
          format={(v) => `${v} ms`}
          onChange={(v) => onChange({ reverbPreDelay: v })}
        />
      </div>
    </section>
  );
}

function TextureSection({ params, onChange }: SectionProps) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-violet-400">
        Espacio y textura
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Slider
          label="Ancho estéreo"
          value={params.stereoWidth}
          min={0}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => onChange({ stereoWidth: v })}
        />
        <Slider
          label="Wobble · velocidad"
          value={params.wobbleRate}
          min={0.1}
          max={4}
          step={0.1}
          format={(v) => `${v.toFixed(1)} Hz`}
          onChange={(v) => onChange({ wobbleRate: v })}
        />
        <Slider
          label="Wobble · profundidad"
          value={params.wobbleDepth}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => onChange({ wobbleDepth: v })}
        />
        <Slider
          label="Crujido de vinilo"
          value={params.vinylAmount}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => onChange({ vinylAmount: v })}
        />
      </div>
    </section>
  );
}

function OutputSection({ params, onChange }: SectionProps) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-violet-400">
        Salida
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Slider
          label="Fade-in"
          value={params.fadeIn}
          min={0}
          max={8}
          step={0.1}
          format={sec}
          onChange={(v) => onChange({ fadeIn: v })}
        />
        <Slider
          label="Fade-out"
          value={params.fadeOut}
          min={0}
          max={8}
          step={0.1}
          format={sec}
          onChange={(v) => onChange({ fadeOut: v })}
        />
        <Slider
          label="Ganancia"
          value={params.outputGain}
          min={-12}
          max={6}
          step={0.5}
          format={db}
          onChange={(v) => onChange({ outputGain: v })}
        />
        <Slider
          label="Compresión"
          value={params.compressor}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => onChange({ compressor: v })}
        />
      </div>
    </section>
  );
}

