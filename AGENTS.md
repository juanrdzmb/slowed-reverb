<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# slowed-reverb

Web app para crear canciones **slowed + reverb** con calidad de estudio, 100% en el navegador
(el audio del usuario nunca sale de su equipo).

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS 4 (tema oscuro con acentos violeta; estilo en `globals.css`)
- Web Audio API nativa para todo el DSP (sin librerías de audio en runtime)
- `@breezystack/lamejs` (import dinámico) para exportar MP3 320 kbps
- Dev-only: `node-web-audio-api` + `tsx` para verificar el DSP fuera del navegador

## Comandos

```bash
npm run dev      # desarrollo
npm run build    # build de producción
npm run lint     # eslint
npm run verify   # verificación DSP sin navegador (seno 440 Hz → frecuencia/duración/encoders)
```

## Arquitectura

### Cadena de audio (`src/lib/audio/dsp.ts`)

`entrada → pitch shifter granular (semitonos indep.) → paso-bajo → graves → brillo →
wobble (LFO sobre retardo) → ancho estéreo mid/side → reverb por convolución (dry/wet,
IR generada) + crujido de vinilo → compresor → ganancia → limitador → salida`

- `buildChain(ctx, params, live)` es la ÚNICA implementación: se usa tanto para el
  preview en vivo (`AudioContext`) como para la exportación (`OfflineAudioContext`,
  `renderer.ts`). Lo que se oye es exactamente lo que se descarga.
- El "slowed" clásico se hace con `playbackRate` (tono acoplado al tempo, auténtico).
  Los "semitonos" usan un pitch shifter granular propio (dos delays con crossfade).
- El limitador siempre activo evita clipping con reverb + bass boost altos.

### Módulos de audio

- `presets.ts` — `SlowedParams` + 8 estilos (Classic, Deep, Heavy Reverb, Night Drive,
  Vaporwave, Lo-fi, Nightcore, Cinematic).
- `dsp.ts` — nodos, IR de reverb, buffer de vinilo, pitch shifter, stereo width.
  `chain.update(params, hard)`: rampas suaves para sliders; `hard=true` aplica valores
  instantáneos (cambio de preset). `chain.stop()` detiene osciladores/vinilo al
  descartar la cadena (evita fugas de CPU al recargar archivos).
- `engine.ts` — reproducción en vivo: play/pausa/seek, parámetros en caliente, volumen
  de monitor (`setVolume`, solo escucha: NO afecta a la exportación), A/B original vs
  procesado con crossfade a nivel de salida (`bypassGain` vs `processedGain`, de modo
  que el original se escucha 100% limpio: ni vinilo ni colas de reverb) y **a ritmo 1**
  (en modo original la fuente suena tal cual se subió: la línea de tiempo, la duración
  y el `playbackRate` dependen del modo A/B; `setBypass` recoloca la reproducción en el
  mismo punto de la canción al conmutar), y `setPreset`
  para cambios de estilo con corte limpio (silencia brevemente el camino procesado,
  aplica valores instantáneos y re-entra, sin arrastrar el efecto anterior).
- `renderer.ts` — render offline a la tasa de muestreo del original. La duración del
  buffer renderizado incluye la cola de reverb + 0.5 s de margen (por diseño).
- `encoder.ts` — WAV PCM 16/24-bit sin pérdidas (misma tasa que el original) y
  MP3 320 kbps con progreso y cesión del hilo.

### UI

`src/app/page.tsx` (estado + motor) → `PlayerUi` → `DropZone`, `Waveform` (canvas propio
con picos del buffer; NO wavesurfer, para sincronizar con el motor), `StyleGallery`,
`ControlPanel` (plegable, sliders por grupos), `ExportBar`, `ui/Slider`.

## Gotchas

- `decodeAudioData` desprende el ArrayBuffer original: no reutilizarlo tras `engine.load`.
- El motor se crea tras la primera carga de archivo (reproducción requiere gesto del
  usuario; `AudioContext.resume()` en `play()`).
- Al cambiar `speed` se reinicia la fuente en la misma posición de la canción.
- Tras cargar un archivo se arranca en modo "Original" (A/B); el conmutador
  Original/Slowed está en la fila de controles del reproductor, junto al volumen.
- La exportación respeta el modo A/B: en "Original" codifica el buffer decodificado
  sin procesar (sufijo `(original)`); en "Slowed + Reverb" renderiza los parámetros
  actuales (sufijo `(slowed + reverb)`).
- Los presets se aplican vía `presetSwitchRef` en `page.tsx`: marca el próximo
  cambio de `params` para que el motor use `setPreset` (corte limpio) en lugar de
  `setParams` (rampas suaves, reservadas a los sliders).
- `npm run verify` usa un polyfill de Web Audio: sirve para el DSP/encoders, no para la UI.

