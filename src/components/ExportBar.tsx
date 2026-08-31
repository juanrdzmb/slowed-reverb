"use client";

import type { DetectedFormat } from "@/lib/audio/detectFormat";

export type ExportFormat = "wav16" | "wav24" | "mp3";
type ExportState = "idle" | "preparing" | "ready";

interface ExportBarProps {
  detected: DetectedFormat | null;
  exportState: ExportState;
  progress: number;
  status: string;
  preparedSize?: number;
  onPrepare: () => void;
  onDownload: () => void;
}

export default function ExportBar({
  detected,
  exportState,
  progress,
  status,
  preparedSize,
  onPrepare,
  onDownload,
}: ExportBarProps) {
  const isPreparing = exportState === "preparing";
  const isReady = exportState === "ready";
  const detectedLabel = detected ? detected.label : "Audio";
  const exportLabel = detected ? (detected.exportFormat === "mp3" ? "MP3" : "WAV") : "Audio";
  // Mensaje de fallback para formatos sin encoder directo
  const fallbackHint =
    detected && detected.kind !== "mp3" && detected.kind !== "wav" && detected.kind !== "unknown"
      ? `Detectado ${detected.label} → se exportará como ${exportLabel} (sin pérdidas)`
      : null;

  const sizeHint =
    preparedSize != null
      ? preparedSize > 1024 * 1024
        ? `${(preparedSize / 1024 / 1024).toFixed(1)} MB`
        : `${Math.round(preparedSize / 1024)} KB`
      : null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">
            Exportación <span className="text-zinc-400">· Detectado: {detectedLabel}</span>
            <span className="ml-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-300">
              → {exportLabel}
            </span>
          </p>
          {fallbackHint ? (
            <p className="mt-1 text-xs text-zinc-500">{fallbackHint}</p>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">
              Se exportará en el mismo formato que subiste ({exportLabel}) sin que tengas que elegir.
            </p>
          )}
        </div>

        {!isReady ? (
          <button
            type="button"
            disabled={isPreparing || !detected}
            onClick={onPrepare}
            className="shrink-0 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPreparing ? "Preparando…" : "Preparar canción"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onDownload}
            className="shrink-0 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition-transform hover:scale-[1.02] active:scale-95"
          >
            ⬇ Descargar {sizeHint ? `· ${sizeHint}` : ""}
          </button>
        )}
      </div>

      {(isPreparing || isReady) && (
        <div className="w-full">
          <p className="mb-1 truncate text-xs text-zinc-400">
            {status}
            {isReady && sizeHint ? ` · ${sizeHint} listo` : ""}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-[width] duration-200 ${
                isReady
                  ? "bg-gradient-to-r from-emerald-500 to-teal-500"
                  : "bg-gradient-to-r from-violet-500 to-indigo-500"
              }`}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          {isReady && (
            <p className="mt-2 text-xs text-zinc-500">
              Ya está lista. Pulsa Descargar cuando quieras. Si cambias de preset o modo, vuelve a Preparar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
