/**
 * Detección interna de formato de entrada.
 * No expone WAV16/24 al usuario: decide automáticamente según cabecera, MIME y extensión.
 */

export type ExportFormat = "wav16" | "wav24" | "mp3";

export type DetectedKind = "mp3" | "wav" | "flac" | "ogg" | "m4a" | "aac" | "unknown";

export interface DetectedFormat {
  kind: DetectedKind;
  exportFormat: ExportFormat;
  /** Etiqueta humana para badge: MP3, WAV, FLAC... */
  label: string;
  /** Bit depth solo para wav (16|24), interno */
  wavBits?: 16 | 24;
}

/** Sniff de cabecera: lee magic bytes del inicio del archivo. */
export function sniffHeader(buf: ArrayBuffer): DetectedKind | null {
  if (buf.byteLength < 12) return null;
  const u8 = new Uint8Array(buf);
  const str = (o: number, l: number) => String.fromCharCode(...u8.slice(o, o + l));

  // WAV: RIFF....WAVE
  if (str(0, 4) === "RIFF" && str(8, 4) === "WAVE") return "wav";
  // FLAC: fLaC
  if (str(0, 4) === "fLaC") return "flac";
  // OGG: OggS
  if (str(0, 4) === "OggS") return "ogg";
  // MP3: ID3 o sync FF Ex
  if (str(0, 3) === "ID3") return "mp3";
  if (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0) return "mp3";
  // M4A/AAC MP4: ftyp
  if (str(4, 4) === "ftyp") {
    const ftyp = str(8, 4).toLowerCase();
    if (ftyp.includes("m4a") || ftyp.includes("mp42") || ftyp.includes("isom")) return "m4a";
    return "m4a";
  }
  return null;
}

function wavBitsFromHeader(buf: ArrayBuffer): 16 | 24 | null {
  // Intenta leer bitsPerSample del chunk fmt (offset 34) si es RIFF/WAVE estándar.
  // Estructura: 0-3 RIFF, 8-11 WAVE, 12-15 fmt , 16-19 chunkSize, 34-35 bitsPerSample
  try {
    if (buf.byteLength < 36) return null;
    const view = new DataView(buf);
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    if (riff !== "RIFF" || wave !== "WAVE") return null;
    const bits = view.getUint16(34, true);
    if (bits === 16 || bits === 24) return bits;
    return null;
  } catch {
    return null;
  }
}

export function inferExportFormat(file: File, headerBuf?: ArrayBuffer): DetectedFormat {
  const mime = (file.type || "").toLowerCase();
  const name = file.name || "";
  const ext = name.split(".").pop()?.toLowerCase() || "";

  const headerKind = headerBuf ? sniffHeader(headerBuf) : null;
  const headerWavBits = headerKind === "wav" && headerBuf ? wavBitsFromHeader(headerBuf) : null;

  // 1) Header tiene prioridad
  if (headerKind === "wav") {
    const bits: 16 | 24 = headerWavBits ?? 16;
    return {
      kind: "wav",
      exportFormat: bits === 24 ? "wav24" : "wav16",
      label: "WAV",
      wavBits: bits,
    };
  }
  if (headerKind === "mp3") return { kind: "mp3", exportFormat: "mp3", label: "MP3" };
  if (headerKind === "flac") return { kind: "flac", exportFormat: "wav16", label: "FLAC" };
  if (headerKind === "ogg") return { kind: "ogg", exportFormat: "wav16", label: "OGG" };
  if (headerKind === "m4a") {
    // m4a/aac → fallback sin pérdidas
    return { kind: "m4a", exportFormat: "wav16", label: "M4A" };
  }

  // 2) MIME
  if (mime.includes("mpeg") || mime.includes("mp3")) return { kind: "mp3", exportFormat: "mp3", label: "MP3" };
  if (mime.includes("wav") || mime.includes("wave") || mime.includes("x-wav"))
    return { kind: "wav", exportFormat: "wav16", label: "WAV", wavBits: 16 };
  if (mime.includes("flac")) return { kind: "flac", exportFormat: "wav16", label: "FLAC" };
  if (mime.includes("ogg") || mime.includes("opus")) return { kind: "ogg", exportFormat: "wav16", label: "OGG" };
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) {
    const isAac = mime.includes("aac") || ext === "aac";
    return { kind: isAac ? "aac" : "m4a", exportFormat: "wav16", label: isAac ? "AAC" : "M4A" };
  }

  // 3) Extensión
  if (ext === "mp3") return { kind: "mp3", exportFormat: "mp3", label: "MP3" };
  if (ext === "wav") return { kind: "wav", exportFormat: "wav16", label: "WAV", wavBits: 16 };
  if (ext === "flac") return { kind: "flac", exportFormat: "wav16", label: "FLAC" };
  if (ext === "ogg" || ext === "opus") return { kind: "ogg", exportFormat: "wav16", label: "OGG" };
  if (ext === "m4a") return { kind: "m4a", exportFormat: "wav16", label: "M4A" };
  if (ext === "aac") return { kind: "aac", exportFormat: "wav16", label: "AAC" };

  // 4) Fallback audio/* desconocido → mp3 (ligero y universal)
  if (mime.startsWith("audio/")) return { kind: "unknown", exportFormat: "mp3", label: "Audio" };

  return { kind: "unknown", exportFormat: "wav16", label: "Audio" };
}
