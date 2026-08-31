"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DropZone from "@/components/DropZone";
import Waveform from "@/components/Waveform";
import StyleGallery from "@/components/StyleGallery";
import ControlPanel from "@/components/ControlPanel";
import ExportBar from "@/components/ExportBar";
import Slider from "@/components/ui/Slider";
import { SlowedEngine } from "@/lib/audio/engine";
import { renderProcessed } from "@/lib/audio/renderer";
import { encodeMp3, encodeWav } from "@/lib/audio/encoder";
import { STYLE_PRESETS, type SlowedParams, type StylePreset } from "@/lib/audio/presets";
import { inferExportFormat, type DetectedFormat } from "@/lib/audio/detectFormat";

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};

type ExportState = "idle" | "preparing" | "ready";

interface UiProps {
  fileName: string;
  buffer: AudioBuffer | null;
  loading: boolean;
  error: string;
  playing: boolean;
  pos: number;
  duration: number;
  bypassed: boolean;
  volume: number;
  activeStyle: string;
  params: SlowedParams;
  detected: DetectedFormat | null;
  exportState: ExportState;
  progress: number;
  status: string;
  preparedSize?: number;
  togglePlay: () => void;
  handleSeek: (p: number) => void;
  toggleAB: () => void;
  handleVolume: (v: number) => void;
  applyPreset: (p: StylePreset) => void;
  changeParams: (p: Partial<SlowedParams>) => void;
  onPrepare: () => void;
  onDownload: () => void;
  handleFile: (f: File) => void;
  getTime: () => number;
}

export default function Home() {
  const engineRef = useRef<SlowedEngine | null>(null);
  const presetSwitchRef = useRef(false);
  const [fileName, setFileName] = useState("");
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [params, setParams] = useState<SlowedParams>({ ...STYLE_PRESETS[0].params });
  const [activeStyle, setActiveStyle] = useState("classic");
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [bypassed, setBypassed] = useState(true);
  const [volume, setVolume] = useState(1);
  const [detected, setDetected] = useState<DetectedFormat | null>(null);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [preparedBlob, setPreparedBlob] = useState<Blob | null>(null);
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [preparedName, setPreparedName] = useState<string>("");

  // Reloj de reproducción
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      setPos(engineRef.current?.getTime() ?? 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Sincroniza motor con params
  useEffect(() => {
    if (presetSwitchRef.current) {
      presetSwitchRef.current = false;
      engineRef.current?.setPreset(params);
    } else {
      engineRef.current?.setParams(params);
    }
  }, [params]);

  useEffect(() => {
    engineRef.current?.setVolume(volume);
  }, [volume]);

  const invalidatePrepared = useCallback(() => {
    if (exportState === "ready") {
      setExportState("idle");
      setProgress(0);
      setStatus("");
    }
    if (preparedUrl) {
      URL.revokeObjectURL(preparedUrl);
      setPreparedUrl(null);
    }
    setPreparedBlob(null);
  }, [exportState, preparedUrl]);

  useEffect(() => {
    return () => {
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError("");
      setLoading(true);
      // Limpia preparado previo
      if (preparedUrl) {
        URL.revokeObjectURL(preparedUrl);
        setPreparedUrl(null);
      }
      setPreparedBlob(null);
      setExportState("idle");
      setProgress(0);
      setStatus("");
      try {
        if (!engineRef.current) {
          const created = new SlowedEngine(params);
          created.onEnded = () => {
            setPlaying(false);
            setPos(0);
          };
          engineRef.current = created;
          created.setBypass(true);
        }
        const engine = engineRef.current;
        const ab = await file.arrayBuffer();
        // Detección interna antes de detach
        const header = ab.slice(0, 44);
        const det = inferExportFormat(file, header);
        setDetected(det);
        const buf = await engine.load(ab);
        setBuffer(buf);
        setFileName(file.name);
        setPos(0);
        setPlaying(false);
        setBypassed(true);
        engine.setBypass(true);
      } catch {
        setError("No se pudo decodificar el archivo. Prueba con MP3 o WAV.");
      } finally {
        setLoading(false);
      }
    },
    [params, preparedUrl],
  );

  const togglePlay = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) {
      engine.pause();
      setPlaying(false);
      setPos(engine.getTime());
    } else {
      await engine.play();
      setPlaying(true);
    }
  };

  const handleSeek = (p: number) => {
    engineRef.current?.seek(p);
    setPos(p);
  };

  const applyPreset = (preset: StylePreset) => {
    invalidatePrepared();
    presetSwitchRef.current = true;
    setParams({ ...preset.params });
    setActiveStyle(preset.id);
  };

  const changeParams = (partial: Partial<SlowedParams>) => {
    invalidatePrepared();
    setParams((prev) => ({ ...prev, ...partial }));
    setActiveStyle("custom");
  };

  const toggleAB = () => {
    invalidatePrepared();
    const next = !bypassed;
    setBypassed(next);
    engineRef.current?.setBypass(next);
  };

  const handlePrepare = async () => {
    if (!buffer || !detected) return;
    setExportState("preparing");
    setProgress(0.05);
    setError("");
    try {
      const base = fileName.replace(/\.[^.]+$/, "");
      const suffix = bypassed ? " (original)" : " (slowed + reverb)";
      const ext = detected.exportFormat === "mp3" ? "mp3" : "wav";
      const outName = `${base}${suffix}.${ext}`;
      setPreparedName(outName);
      let blob: Blob;
      if (bypassed) {
        if (detected.exportFormat === "mp3") {
          setStatus("Codificando MP3 320 kbps…");
          blob = await encodeMp3(buffer, 320, (p) => setProgress(p));
        } else {
          setStatus("Generando WAV…");
          const bits: 16 | 24 = detected.exportFormat === "wav24" ? 24 : 16;
          blob = encodeWav(buffer, bits);
          setProgress(1);
        }
      } else {
        setStatus("Renderizando audio…");
        const rendered = await renderProcessed(buffer, params);
        if (detected.exportFormat === "mp3") {
          setStatus("Codificando MP3 320 kbps…");
          blob = await encodeMp3(rendered, 320, (p) => setProgress(p));
        } else {
          setStatus("Generando WAV…");
          const bits: 16 | 24 = detected.exportFormat === "wav24" ? 24 : 16;
          blob = encodeWav(rendered, bits);
          setProgress(1);
        }
      }
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
      const url = URL.createObjectURL(blob);
      setPreparedBlob(blob);
      setPreparedUrl(url);
      setExportState("ready");
      setStatus("Listo para descargar");
      setProgress(1);
    } catch {
      setError("Error al preparar la exportación. Inténtalo de nuevo.");
      setExportState("idle");
      setProgress(0);
      setStatus("");
    }
  };

  const handleDownload = () => {
    if (!preparedBlob || !preparedUrl) return;
    const a = document.createElement("a");
    a.href = preparedUrl;
    a.download = preparedName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // No revocamos inmediatamente para permitir re-descargas; se revoca al cambiar archivo/preset
  };

  const duration = buffer ? (bypassed ? buffer.duration : buffer.duration / params.speed) : 0;
  const getTime = useCallback(() => engineRef.current?.getTime() ?? 0, []);

  return (
    <PlayerUi
      fileName={fileName}
      buffer={buffer}
      loading={loading}
      error={error}
      playing={playing}
      pos={pos}
      duration={duration}
      bypassed={bypassed}
      volume={volume}
      activeStyle={activeStyle}
      params={params}
      detected={detected}
      exportState={exportState}
      progress={progress}
      status={status}
      preparedSize={preparedBlob?.size}
      togglePlay={togglePlay}
      handleSeek={handleSeek}
      toggleAB={toggleAB}
      handleVolume={setVolume}
      applyPreset={applyPreset}
      changeParams={changeParams}
      onPrepare={handlePrepare}
      onDownload={handleDownload}
      handleFile={handleFile}
      getTime={getTime}
    />
  );
}

function PlayerUi(props: UiProps) {
  const {
    fileName,
    buffer,
    loading,
    error,
    playing,
    pos,
    duration,
    bypassed,
    volume,
    activeStyle,
    params,
    detected,
    exportState,
    progress,
    status,
    preparedSize,
    togglePlay,
    handleSeek,
    toggleAB,
    handleVolume,
    applyPreset,
    changeParams,
    onPrepare,
    onDownload,
    handleFile,
    getTime,
  } = props;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <h1 className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl">
          Slowed + Reverb Studio
        </h1>
        <p className="mt-3 text-zinc-400">
          Crea versiones slowed + reverb con calidad de estudio, directamente en tu navegador.
        </p>
      </header>

      {error && (
        <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      {!buffer ? (
        loading ? (
          <p className="py-16 text-center text-zinc-400">Decodificando audio…</p>
        ) : (
          <DropZone onFile={handleFile} />
        )
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="mb-3 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-zinc-300">🎵 {fileName}</span>
              <span className="shrink-0 tabular-nums text-zinc-400">
                {fmtTime(pos)} / {fmtTime(duration)}
              </span>
            </div>
            <Waveform buffer={buffer} duration={duration} getTime={getTime} onSeek={handleSeek} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={togglePlay}
                className="rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition-transform hover:scale-[1.02] active:scale-95"
              >
                {playing ? "⏸ Pausar" : "▶ Reproducir"}
              </button>
              <div className="flex overflow-hidden rounded-xl border border-zinc-700 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => !bypassed && toggleAB()}
                  className={`px-4 py-2.5 transition-colors ${
                    bypassed ? "bg-violet-500/20 text-violet-200" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Original
                </button>
                <button
                  type="button"
                  onClick={() => bypassed && toggleAB()}
                  className={`px-4 py-2.5 transition-colors ${
                    !bypassed ? "bg-violet-500/20 text-violet-200" : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Slowed + Reverb
                </button>
              </div>
              <div className="ml-auto w-36 min-w-[9rem]">
                <Slider
                  label="🔊 Volumen"
                  value={volume}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={handleVolume}
                />
              </div>
              {activeStyle === "custom" && (
                <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-xs text-violet-300">
                  ✨ Estilo personalizado
                </span>
              )}
            </div>
          </div>

          <StyleGallery activeId={activeStyle} onSelect={applyPreset} />
          <ControlPanel params={params} onChange={changeParams} />
          <ExportBar
            detected={detected}
            exportState={exportState}
            progress={progress}
            status={status}
            preparedSize={preparedSize}
            onPrepare={onPrepare}
            onDownload={onDownload}
          />

          <p className="text-center text-xs text-zinc-500">
            La exportación se renderiza a la misma tasa de muestreo que tu archivo original (
            {buffer.sampleRate.toLocaleString("es")} Hz) — sin pérdida de calidad.
            {detected && (
              <span className="ml-1">
                Detectado: {detected.label} → se exportará como {detected.exportFormat === "mp3" ? "MP3" : "WAV"}.
              </span>
            )}
          </p>
        </div>
      )}

      <footer className="mt-12 text-center text-xs text-zinc-600">
        🔒 Todo el procesamiento ocurre en tu navegador. Tu música nunca sale de tu equipo.
      </footer>
    </main>
  );
}
