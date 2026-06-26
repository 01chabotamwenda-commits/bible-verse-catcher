import { useState, useEffect, useRef } from 'react';

/**
 * Measures real-time microphone volume (0–1) using the Web Audio API.
 * Only activates when `active` is true. Opens its own short-lived media stream
 * for analysis — the browser reuses the already-granted mic permission, so no
 * second prompt appears.
 */
export function useAudioLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef     = useRef<number | null>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const ctxRef     = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        const ctx      = new AudioContext();
        ctxRef.current = ctx;
        const source   = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize        = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteFrequencyData(data);
          // RMS of frequency bins → 0–1
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length) / 255;
          setLevel(Math.min(1, rms * 2.5)); // scale up so typical speech shows clearly
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // mic unavailable — just stay at 0
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      ctxRef.current?.close();
      ctxRef.current = null;
      setLevel(0);
    };
  }, [active]);

  return level;
}
