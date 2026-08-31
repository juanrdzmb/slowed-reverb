"use client";

import { useCallback, useRef, useState } from "react";

interface DropZoneProps {
  onFile: (file: File) => void;
}

export default function DropZone({ onFile }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`group flex cursor-pointer flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed p-16 text-center transition-colors ${
        dragging
          ? "border-violet-400 bg-violet-500/10"
          : "border-zinc-700 bg-zinc-900/50 hover:border-violet-500/60 hover:bg-zinc-900"
      }`}
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-4xl shadow-lg shadow-violet-500/25 transition-transform group-hover:scale-105">
        🎵
      </div>
      <div>
        <p className="text-lg font-semibold text-zinc-100">
          Arrastra tu canción aquí
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          o haz clic para elegir un archivo · MP3, WAV, FLAC, OGG, M4A
        </p>
      </div>
      <p className="text-xs text-zinc-500">
        🔒 Tu audio se procesa en tu navegador: nunca se sube a ningún servidor
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
