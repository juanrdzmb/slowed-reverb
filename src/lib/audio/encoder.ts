/**
 * Encoders de exportación: WAV PCM sin pérdidas (misma tasa de muestreo que
 * el archivo original) y MP3 320 kbps vía lamejs (en un import dinámico).
 */

export function encodeWav(buffer: AudioBuffer, bitDepth: 16 | 24 = 16): Blob {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const bytesPer = bitDepth / 8;
  const dataSize = len * numCh * bytesPer;
  const ab = new ArrayBuffer(44 + dataSize);
  const view = new DataView(ab);

  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // tamaño del chunk fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * bytesPer, true);
  view.setUint16(32, numCh * bytesPer, true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));

  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      if (bitDepth === 16) {
        view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      } else {
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        view.setUint8(o, v & 0xff);
        view.setUint8(o + 1, (v >> 8) & 0xff);
        view.setUint8(o + 2, (v >> 16) & 0xff);
        o += 3;
      }
    }
  }

  return new Blob([ab], { type: "audio/wav" });
}

export async function encodeMp3(
  buffer: AudioBuffer,
  kbps: number = 320,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const numCh = Math.min(2, buffer.numberOfChannels);
  const enc = new Mp3Encoder(numCh, buffer.sampleRate, kbps);

  const to16 = (f: Float32Array): Int16Array => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };

  const left = to16(buffer.getChannelData(0));
  const right = numCh > 1 ? to16(buffer.getChannelData(1)) : null;

  const blockSize = 1152 * 40;
  const chunks: BlobPart[] = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right ? right.subarray(i, i + blockSize) : undefined;
    const data = numCh > 1 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    if (data.length > 0) chunks.push(new Uint8Array(data));
    if (onProgress && (i / blockSize) % 8 === 0) {
      onProgress(i / left.length);
      // cede el hilo para que la UI siga respondiendo
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));
  onProgress?.(1);

  return new Blob(chunks, { type: "audio/mpeg" });
}

/** Genera y descarga un blob como archivo. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
