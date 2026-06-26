import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseSpeechRecognitionResult {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  audioLevel: number;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  isSupported: boolean;
  onFinalChunk: (cb: (chunk: string) => void) => void;
  backend?: 'deepgram';
}

export function useSpeechRecognition(): UseSpeechRecognitionResult {
  const [finalText, setFinalText]     = useState('');
  const [interimText, setInterimText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [audioLevel, setAudioLevel]   = useState(0);

  const wsRef        = useRef<WebSocket | null>(null);
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const activeRef    = useRef(false);
  const callbackRef  = useRef<((chunk: string) => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio level analyser
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const rafRef       = useRef<number | null>(null);

  const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  // ── Audio level meter ────────────────────────────────────────────────────────
  const startAnalyser = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        setAudioLevel(Math.min(1, Math.sqrt(sum / data.length) / 255 * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch { /* no meter if AudioContext fails */ }
  }, []);

  const stopAnalyser = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setAudioLevel(0);
  }, []);

  // ── Teardown (full stop — mic + WS) ─────────────────────────────────────────
  const teardown = useCallback(() => {
    activeRef.current = false;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (recorderRef.current?.state !== 'inactive') {
      try { recorderRef.current?.stop(); } catch {}
    }
    recorderRef.current = null;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      try { wsRef.current.close(1000); } catch {}
    }
    wsRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    stopAnalyser();
    setIsListening(false);
    setInterimText('');
  }, [stopAnalyser]);

  // ── Close just the WS + recorder, keep the mic stream ──────────────────────
  const closeWsOnly = useCallback(() => {
    if (recorderRef.current?.state !== 'inactive') {
      try { recorderRef.current?.stop(); } catch {}
    }
    recorderRef.current = null;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      try { wsRef.current.close(1000); } catch {}
    }
    wsRef.current = null;
  }, []);

  // ── Connect (or reconnect) WebSocket for a given stream ─────────────────────
  const connectWs = useCallback((stream: MediaStream) => {
    if (!activeRef.current) return;

    const apiBase = window.electronAPI?.apiBaseUrl;
    // In Electron, the API runs on http://127.0.0.1:PORT — use ws://
    // In the browser (HTTPS), the proxy endpoint is wss://
    const proto = apiBase
      ? 'ws:'
      : (window.location.protocol === 'https:' ? 'wss:' : 'ws:');
    const host = apiBase ? apiBase.replace(/^https?:\/\//, '') : window.location.host;
    const ws = new WebSocket(`${proto}//${host}/api/transcribe`);
    wsRef.current = ws;
    setInterimText('Connecting…');

    ws.onmessage = (ev) => {
      let msg: { type: string; message?: string; channel?: { alternatives?: Array<{ transcript?: string }> }; is_final?: boolean };
      try { msg = JSON.parse(ev.data as string); } catch { return; }

      if (msg.type === 'connected') {
        setInterimText('');
        setError(null);
        // Start recorder — send 100ms chunks for low latency
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm';
        const rec = new MediaRecorder(stream, { mimeType });
        recorderRef.current = rec;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then(buf => ws.send(buf));
          }
        };
        rec.start(100);
        return;
      }

      if (msg.type === 'error') {
        setError(`Deepgram error: ${msg.message ?? 'unknown'}`);
        teardown();
        return;
      }

      if (msg.type !== 'Results') return;

      const text: string = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
      if (!text) return;

      if (msg.is_final) {
        setInterimText('');
        setFinalText(prev => prev ? prev + ' ' + text : text);
        callbackRef.current?.(text);
      } else {
        setInterimText(text);
      }
    };

    ws.onerror = () => {
      // onclose will fire next and handle reconnect
    };

    ws.onclose = (ev) => {
      console.log('[WS] close code:', ev.code, 'reason:', ev.reason);
      if (!activeRef.current) return; // user stopped intentionally
      if (ev.code === 1000) return;   // clean close, also intentional

      // Unexpected drop — stop the current recorder and reconnect after 1.5 s
      console.log('[WS] unexpected close, reconnecting in 1.5s…');
      setInterimText('Reconnecting…');
      if (recorderRef.current?.state !== 'inactive') {
        try { recorderRef.current?.stop(); } catch {}
      }
      recorderRef.current = null;
      wsRef.current = null;

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (activeRef.current) connectWs(stream);
      }, 1500);
    };
  }, [teardown]);

  // ── startListening ───────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (activeRef.current) return;
    setError(null);

    // 1. Get mic
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e: unknown) {
      const denied = e instanceof DOMException && e.name === 'NotAllowedError';
      setError(denied ? 'Microphone permission denied.' : `Could not open mic: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    streamRef.current = stream;
    activeRef.current = true;
    setIsListening(true);

    // 2. Start audio level meter
    startAnalyser(stream);

    // 3. Connect WebSocket
    connectWs(stream);
  }, [startAnalyser, connectWs]);

  // ── stopListening ────────────────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    teardown();
  }, [teardown]);

  // ── cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => () => { teardown(); }, [teardown]);

  const resetTranscript = useCallback(() => {
    setFinalText('');
    setInterimText('');
    setError(null);
  }, []);

  const onFinalChunk = useCallback((cb: (chunk: string) => void) => {
    callbackRef.current = cb;
  }, []);

  return {
    isListening, transcript: finalText, interimTranscript: interimText,
    error, audioLevel, startListening, stopListening, resetTranscript,
    isSupported, onFinalChunk, backend: 'deepgram',
  };
}
