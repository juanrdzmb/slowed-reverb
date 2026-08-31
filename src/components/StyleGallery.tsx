"use client";

import { STYLE_PRESETS, type StylePreset } from "@/lib/audio/presets";

interface StyleGalleryProps {
  activeId: string;
  onSelect: (preset: StylePreset) => void;
  disabled?: boolean;
}

export default function StyleGallery({ activeId, onSelect, disabled }: StyleGalleryProps) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
        Estilos
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {STYLE_PRESETS.map((preset) => {
          const active = preset.id === activeId;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(preset)}
              className={`rounded-2xl border p-4 text-left transition-all disabled:opacity-50 ${
                active
                  ? "border-violet-400 bg-violet-500/15 shadow-lg shadow-violet-500/10"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-900"
              }`}
            >
              <span className="text-2xl">{preset.icon}</span>
              <p
                className={`mt-2 text-sm font-semibold ${
                  active ? "text-violet-200" : "text-zinc-100"
                }`}
              >
                {preset.name}
              </p>
              <p className="mt-1 text-xs leading-snug text-zinc-400">{preset.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
