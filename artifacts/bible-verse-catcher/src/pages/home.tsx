import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
  Mic, MicOff, BookOpen, Trash2, Copy, AlertCircle, Info,
  Download, CheckCircle2, HelpCircle, ScrollText, PanelRightClose,
  Sun, Moon, Settings, ChevronLeft, FileText, Globe, Clock, Key, Eye, EyeOff, Save,
} from 'lucide-react';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useVerseDetection, EnrichedVerse } from '@/hooks/useVerseDetection';
import { useSessionHistory } from '@/hooks/useSessionHistory';
import { copyToClipboard } from '@/utils/clipboard';
import { exportToPdf } from '@/utils/exportPdf';
import { fetchRemoteVerseText, fetchRemoteVerseRange, Translation, TRANSLATION_LABELS } from '@/utils/bibleLookup';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { WindowControls, isElectron } from '@/components/WindowControls';

// ── Persisted settings helpers ────────────────────────────────────────────────

type FontSize = 'sm' | 'md' | 'lg';
type AppView = 'main' | 'settings';

function readSetting<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) ?? fallback; } catch { return fallback; }
}
function writeSetting(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

const FONT_TEXT_CLASS: Record<FontSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

const TRANSLATIONS: Translation[] = ['NIV', 'KJV', 'WEB'];
const TRANSLATION_NOTES: Record<Translation, string> = {
  NIV: 'Local data — instant, no internet needed',
  KJV: 'Fetched from bible-api.com, cached 7 days',
  WEB: 'World English Bible — fetched & cached',
};

// ── Detect if running inside an iframe (Replit preview or similar) ────────────
const IS_IN_IFRAME = typeof window !== 'undefined' && window.self !== window.top;

// ── Theme toggle ──────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="w-8 h-8 flex items-center justify-center rounded-full border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-all duration-150"
      title="Toggle light / dark mode"
    >
      {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── App shell ─────────────────────────────────────────────────────────────────

export default function Home() {
  return <AppShell />;
}

function AppShell() {
  const {
    isListening, transcript, interimTranscript, error, audioLevel,
    startListening, stopListening, resetTranscript, isSupported,
    onFinalChunk, backend,
  } = useSpeechRecognition();

  const { verses, isAiProcessing, processLocalDetection, processAIChunk, exportAll, loadVerses, reset } =
    useVerseDetection();

  const { pastSessions, saveCurrentSession, deleteSession, clearAll } = useSessionHistory();

  const { toast } = useToast();
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [view, setView] = useState<AppView>('main');
  const [fontSize, setFontSize] = useState<FontSize>(() => readSetting('vc-font-size', 'md'));
  const [translation, setTranslation] = useState<Translation>(() => readSetting('vc-translation', 'NIV'));

  // Persist settings
  useEffect(() => { writeSetting('vc-font-size', fontSize); }, [fontSize]);
  useEffect(() => { writeSetting('vc-translation', translation); }, [translation]);

  // Online/offline
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // Auto-save session whenever verses change
  useEffect(() => { saveCurrentSession(verses); }, [verses, saveCurrentSession]);

  // Wire AI pipeline
  useEffect(() => {
    onFinalChunk((chunk) => { processAIChunk(chunk); });
  }, [onFinalChunk, processAIChunk]);

  // Local regex — instant
  const fullText = transcript + ' ' + interimTranscript;
  useEffect(() => {
    if (fullText.trim()) processLocalDetection(fullText);
  }, [fullText, processLocalDetection]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, interimTranscript]);

  // Auto-open transcript panel when speech arrives
  useEffect(() => {
    if (transcript && !transcriptOpen) setTranscriptOpen(true);
  }, [transcript]);

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) toast({ title: 'Copied', description: label, duration: 1500 });
  };

  const handleCopyVerse = async (verse: EnrichedVerse) => {
    const text = verse.verseText ? `${verse.reference} — ${verse.verseText}` : verse.reference;
    await handleCopy(text, verse.reference);
  };

  const handleExportAll = async () => {
    if (verses.length === 0) return;
    const ok = await copyToClipboard(exportAll());
    if (ok) toast({ title: `${verses.length} verse${verses.length !== 1 ? 's' : ''} copied`, description: 'All verses copied to clipboard', duration: 2000 });
  };

  if (!isSupported) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="w-16 h-16 text-destructive mb-6" />
        <h1 className="text-3xl font-serif font-bold text-foreground mb-4">Browser Not Supported</h1>
        <p className="text-muted-foreground max-w-md">
          Verse Catcher needs the Web Speech API. Please use Chrome, Edge, or Safari on desktop.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-background overflow-hidden relative">
      {/* Header */}
      <header
        className="shrink-0 h-11 px-5 border-b border-border flex items-center justify-between bg-card z-10"
        style={isElectron ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : {}}
      >
        <div
          className="flex items-center gap-2"
          style={isElectron ? ({ WebkitAppRegion: 'no-drag' } as React.CSSProperties) : {}}
        >
          <img src="/icon.png" alt="" className="w-6 h-6 rounded" />
          <h1 className="text-base font-serif font-bold text-foreground tracking-wide leading-none">
            Verse Catcher
          </h1>
        </div>
        {isElectron && (
          <div className="h-full flex items-stretch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <WindowControls />
          </div>
        )}
      </header>

      {/* Sub-toolbar */}
      <div className="shrink-0 h-8 px-4 border-b border-border flex items-center gap-2 bg-card/60">
        {/* Status pills */}
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
          error
            ? 'bg-destructive/10 text-destructive border-destructive/20'
            : isOnline
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
            : 'bg-muted text-muted-foreground border-border'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-destructive' : isOnline ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
          {error ? 'Error' : isOnline ? 'Online' : 'Offline'}
        </span>

        <AnimatePresence>
          {isListening && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.15 }}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-destructive/10 text-destructive border-destructive/20"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              Listening
            </motion.span>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isAiProcessing && (
            <motion.span
              initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }} transition={{ duration: 0.15 }}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/20"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              AI scanning
            </motion.span>
          )}
        </AnimatePresence>

        {backend && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-secondary text-muted-foreground border-border">
            {'Deepgram'}
          </span>
        )}

        {!isOnline && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
            ⚠ No internet
          </span>
        )}

        <div className="flex-1" />

        {/* Settings button */}
        <button
          onClick={() => setView(view === 'settings' ? 'main' : 'settings')}
          className={`w-8 h-8 flex items-center justify-center rounded-full border transition-all duration-150 ${
            view === 'settings'
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground'
          }`}
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        <ThemeToggle />
      </div>

      {/* View content */}
      <AnimatePresence mode="wait" initial={false}>
        {view === 'settings' ? (
          <motion.div
            key="settings"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 overflow-y-auto"
          >
            <SettingsScreen
              verses={verses}
              fontSize={fontSize}
              onFontSizeChange={setFontSize}
              translation={translation}
              onTranslationChange={setTranslation}
              pastSessions={pastSessions}
              onLoadSession={(sv) => { loadVerses(sv); setView('main'); }}
              onDeleteSession={deleteSession}
              onClearHistory={clearAll}
              onExportAll={handleExportAll}
              onExportPdf={() => exportToPdf(verses)}
              onBack={() => setView('main')}
            />
          </motion.div>
        ) : (
          <motion.div
            key="main"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 flex min-h-0 overflow-hidden"
          >
            {/* Verses panel */}
            <div className="flex-1 flex flex-col min-h-0 p-5 lg:p-6">
              <div className="shrink-0 flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5" /> Detected Verses
                  {verses.length > 0 && (
                    <span className="ml-1 bg-secondary text-primary text-xs font-bold px-2 py-0.5 rounded-full">
                      {verses.length}
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-1">
                  {verses.length > 0 && (
                    <Button
                      variant="ghost" size="sm" onClick={handleExportAll}
                      className="text-muted-foreground hover:text-foreground h-7 text-xs"
                      title="Copy all verses to clipboard"
                    >
                      <Download className="w-3.5 h-3.5 mr-1.5" /> Export All
                    </Button>
                  )}
                  {verses.length > 0 && (
                    <Button
                      variant="ghost" size="sm" onClick={reset}
                      className="text-muted-foreground hover:text-destructive h-7 text-xs"
                      title="Clear all detected verses"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1 pb-2">
                {verses.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-center px-6 py-12">
                    <BookOpen className="w-10 h-10 mb-3" />
                    <p className="text-sm italic">Verses mentioned by the speaker will appear here instantly.</p>
                    <p className="text-xs mt-2">Try saying "Galatians 6:9" or "Psalm 46:10"</p>
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {verses.map((verse) => (
                      <VerseCard
                        key={verse.reference}
                        verse={verse}
                        onCopy={handleCopyVerse}
                        fontSize={fontSize}
                        translation={translation}
                      />
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>

            {/* Transcript tab */}
            <AnimatePresence initial={false}>
              {!transcriptOpen && (
                <motion.button
                  key="transcript-tab"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setTranscriptOpen(true)}
                  className="shrink-0 w-9 flex flex-col items-center justify-center border-l border-border bg-card hover:bg-muted transition-colors cursor-pointer group"
                  title="Open transcript"
                >
                  <span
                    className="text-[10px] font-semibold tracking-widest text-muted-foreground group-hover:text-primary transition-colors uppercase"
                    style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                  >
                    Transcript
                  </span>
                </motion.button>
              )}
            </AnimatePresence>

            {/* Transcript panel */}
            <AnimatePresence initial={false}>
              {transcriptOpen && (
                <motion.div
                  key="transcript-panel"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 354, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                  className="shrink-0 flex min-h-0 overflow-hidden border-l border-border bg-card"
                  style={{ minWidth: 0 }}
                >
                  <div className="w-[354px] flex flex-col h-full p-5">
                    <div className="shrink-0 flex justify-between items-center mb-4">
                      <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase flex items-center gap-2 whitespace-nowrap">
                        <ScrollText className="w-3.5 h-3.5" /> Live Transcript
                      </h2>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost" size="sm" onClick={resetTranscript}
                          className="text-muted-foreground hover:text-foreground h-7 text-xs whitespace-nowrap"
                          disabled={!transcript && !interimTranscript}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear
                        </Button>
                        <Button
                          variant="ghost" size="sm" onClick={() => setTranscriptOpen(false)}
                          className="text-muted-foreground hover:text-foreground h-7 w-7 p-0"
                          title="Close transcript"
                        >
                          <PanelRightClose className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 bg-background border border-border rounded-lg p-4 overflow-y-auto">
                      {!transcript && !interimTranscript ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                          <Mic className="w-8 h-8 mb-3" />
                          <p className="italic text-sm text-center">Waiting for speech…</p>
                          <p className="text-xs mt-2 text-center">Press Start Listening, then speak naturally</p>
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap text-foreground text-sm leading-relaxed">
                          {transcript}
                          <span className="text-muted-foreground italic">{interimTranscript}</span>
                        </p>
                      )}
                      <div ref={transcriptEndRef} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating mic button — hidden on settings screen */}
      {view === 'main' && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10">
          {IS_IN_IFRAME && !isListening && !error && (
            <div className="bg-card border border-border px-4 py-2 rounded-lg text-xs flex items-center gap-2 shadow max-w-xs text-center text-muted-foreground">
              <Info className="w-4 h-4 shrink-0 text-primary" />
              Microphone may be blocked in this preview. Open the deployed app directly for full functionality.
            </div>
          )}
          {error && (
            <div className="bg-destructive/10 text-destructive border border-destructive/30 px-4 py-2 rounded-lg text-xs flex items-center gap-2 shadow max-w-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Audio level meter — visible only while listening */}
          <AnimatePresence>
            {isListening && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                className="w-48 flex flex-col items-center gap-1.5"
              >
                {/* Bar track */}
                <div className="w-full h-2 bg-muted border border-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-75"
                    style={{
                      width: `${Math.round(audioLevel * 100)}%`,
                      background: audioLevel > 0.75
                        ? '#ef4444'
                        : audioLevel > 0.4
                        ? '#f59e0b'
                        : '#22c55e',
                    }}
                  />
                </div>
                {/* Tick marks */}
                <div className="w-full flex justify-between px-0.5">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-px h-1 rounded-full"
                      style={{ background: audioLevel * 8 > i ? (i > 5 ? '#ef4444' : i > 3 ? '#f59e0b' : '#22c55e') : 'hsl(var(--muted-foreground) / 0.3)' }}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground tracking-wide">
                  {audioLevel < 0.05 ? 'Waiting for sound…' : audioLevel > 0.75 ? 'Loud' : audioLevel > 0.4 ? 'Good' : 'Detected'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          {!isListening && !isOnline && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center px-4 -mb-1">
              Internet required — Deepgram &amp; AI run in the cloud
            </p>
          )}
          <Button
            size="lg"
            disabled={!isListening && !isOnline}
            onClick={isListening ? stopListening : startListening}
            className={`rounded-full h-12 px-8 shadow-xl font-semibold transition-all duration-200 ${
              isListening
                ? 'bg-destructive hover:bg-destructive text-destructive-foreground scale-105'
                : !isOnline
                ? 'opacity-50 cursor-not-allowed bg-primary text-primary-foreground'
                : 'bg-primary hover:bg-primary text-primary-foreground hover:scale-105'
            }`}
          >
            {isListening
              ? <><MicOff className="w-5 h-5 mr-2.5" /> Stop Listening</>
              : <><Mic className="w-5 h-5 mr-2.5" /> Start Listening</>
            }
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Settings screen ────────────────────────────────────────────────────────────

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-3">{title}</p>
      {children}
    </div>
  );
}

function SettingsScreen({
  verses,
  fontSize,
  onFontSizeChange,
  translation,
  onTranslationChange,
  pastSessions,
  onLoadSession,
  onDeleteSession,
  onClearHistory,
  onExportAll,
  onExportPdf,
  onBack,
}: {
  verses: EnrichedVerse[];
  fontSize: FontSize;
  onFontSizeChange: (f: FontSize) => void;
  translation: Translation;
  onTranslationChange: (t: Translation) => void;
  pastSessions: import('@/hooks/useSessionHistory').Session[];
  onLoadSession: (verses: EnrichedVerse[]) => void;
  onDeleteSession: (id: string) => void;
  onClearHistory: () => void;
  onExportAll: () => void;
  onExportPdf: () => void;
  onBack: () => void;
}) {
  // ── API Keys state (Electron only) ─────────────────────────────────────────
  const [deepgramKey, setDeepgramKey] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [showDeepgram, setShowDeepgram] = useState(false);
  const [showGroq, setShowGroq] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI!.getConfig().then((cfg) => {
      setDeepgramKey(cfg.deepgramApiKey ?? '');
      setGroqKey(cfg.groqApiKey ?? '');
    });
  }, []);

  const handleSaveKeys = async () => {
    if (!isElectron) return;
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      await window.electronAPI!.setConfig({
        deepgramApiKey: deepgramKey.trim() || undefined,
        groqApiKey: groqKey.trim() || undefined,
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const fontOptions: Array<{ value: FontSize; label: string; example: string }> = [
    { value: 'sm', label: 'Small', example: 'Aa' },
    { value: 'md', label: 'Medium', example: 'Aa' },
    { value: 'lg', label: 'Large', example: 'Aa' },
  ];

  return (
    <div className="max-w-lg mx-auto px-6 py-8 space-y-8">
      {/* Back button */}
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 -mt-2"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </button>

      {/* Appearance */}
      <SettingsSection title="Appearance">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">Verse text size</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {fontOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onFontSizeChange(opt.value)}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition-all duration-150 ${
                  fontSize === opt.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                }`}
              >
                <span className={`font-serif font-bold leading-none ${
                  opt.value === 'sm' ? 'text-base' : opt.value === 'md' ? 'text-xl' : 'text-2xl'
                }`}>{opt.example}</span>
                <span className="text-[10px] font-medium tracking-wide">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* Translation */}
      <SettingsSection title="Bible Translation">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {TRANSLATIONS.map((t) => (
              <button
                key={t}
                onClick={() => onTranslationChange(t)}
                className={`py-2.5 px-3 rounded-xl border-2 text-sm font-bold tracking-wide transition-all duration-150 ${
                  translation === t
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                }`}
              >
                {TRANSLATION_LABELS[t]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {TRANSLATION_NOTES[translation]}
          </p>
        </div>
      </SettingsSection>

      {/* Export */}
      <SettingsSection title="Export Current Session">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              variant="outline" className="flex-1 h-10 gap-2 text-sm"
              onClick={onExportPdf}
              disabled={verses.length === 0}
            >
              <FileText className="w-4 h-4" />
              Export as PDF
            </Button>
            <Button
              variant="outline" className="flex-1 h-10 gap-2 text-sm"
              onClick={onExportAll}
              disabled={verses.length === 0}
            >
              <Download className="w-4 h-4" />
              Copy All
            </Button>
          </div>
          <p className="text-xs text-muted-foreground pl-0.5">
            {verses.length === 0
              ? 'No verses in the current session yet.'
              : `${verses.length} verse${verses.length !== 1 ? 's' : ''} in this session.`}
          </p>
        </div>
      </SettingsSection>

      {/* Session history */}
      <SettingsSection title="Session History">
        {pastSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground border border-dashed border-border rounded-xl">
            <Clock className="w-7 h-7 mb-2" />
            <p className="text-sm">No saved sessions yet.</p>
            <p className="text-xs mt-1">Sessions are saved automatically as you detect verses.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pastSessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-muted/40 transition-colors"
              >
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{session.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.verses.length} verse{session.verses.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 px-2.5 text-xs text-primary hover:text-primary hover:bg-primary/10"
                    onClick={() => onLoadSession(session.verses)}
                  >
                    Load
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteSession(session.id)}
                    title="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="pt-2 flex justify-end">
              <Button
                variant="ghost" size="sm"
                className="text-xs text-muted-foreground hover:text-destructive h-7"
                onClick={onClearHistory}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Clear All History
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>

      {/* API Keys — Electron desktop only */}
      {isElectron && (
        <SettingsSection title="API Keys">
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Key className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
              Keys are stored locally on your machine and passed to the bundled API server on startup. After saving, the server restarts automatically.
            </p>

            {/* Deepgram */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Deepgram API Key</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showDeepgram ? 'text' : 'password'}
                    value={deepgramKey}
                    onChange={(e) => setDeepgramKey(e.target.value)}
                    placeholder="dg_…"
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeepgram((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    title={showDeepgram ? 'Hide' : 'Show'}
                  >
                    {showDeepgram ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground pl-0.5">Used for real-time speech transcription · <a href="https://console.deepgram.com" target="_blank" rel="noreferrer" className="underline hover:text-foreground">console.deepgram.com</a></p>
            </div>

            {/* Groq */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Groq API Key</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showGroq ? 'text' : 'password'}
                    value={groqKey}
                    onChange={(e) => setGroqKey(e.target.value)}
                    placeholder="gsk_…"
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGroq((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    title={showGroq ? 'Hide' : 'Show'}
                  >
                    {showGroq ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground pl-0.5">Used for AI verse detection · <a href="https://console.groq.com" target="_blank" rel="noreferrer" className="underline hover:text-foreground">console.groq.com</a></p>
            </div>

            {/* Save button */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleSaveKeys}
                disabled={isSaving}
                className="h-9 px-4 text-sm gap-2"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? 'Saving…' : 'Save & Restart Server'}
              </Button>
              {saveStatus === 'saved' && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved — server restarting
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Failed to save
                </span>
              )}
            </div>
          </div>
        </SettingsSection>
      )}

      {/* About */}
      <SettingsSection title="About">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="Verse Catcher" className="w-10 h-10 rounded-lg" />
            <div>
              <p className="text-sm font-semibold text-foreground">Verse Catcher</p>
              <p className="text-xs text-muted-foreground">Real-time AI-powered sermon verse detection</p>
            </div>
          </div>
          <div className="pt-1 space-y-1 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5"><Globe className="w-3 h-3" /> Bible text: NIV (local) · KJV &amp; WEB via bible-api.com</p>
            <p className="flex items-center gap-1.5">🎙 Speech: Deepgram streaming · Groq Whisper · Web Speech API</p>
            <p className="flex items-center gap-1.5">🤖 AI detection: Groq llama-3.3-70b-versatile</p>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

// ── Verse card ─────────────────────────────────────────────────────────────────

function VerseCard({
  verse,
  onCopy,
  fontSize,
  translation,
}: {
  verse: EnrichedVerse;
  onCopy: (verse: EnrichedVerse) => void;
  fontSize: FontSize;
  translation: Translation;
}) {
  const [remoteText, setRemoteText] = useState<string | null | 'loading'>(null);

  useEffect(() => {
    if (verse.isPartial || verse.verse == null) return;
    if (translation === 'NIV') { setRemoteText(null); return; }

    setRemoteText('loading');
    const fetcher = verse.verseEnd != null
      ? fetchRemoteVerseRange(verse.book, verse.chapter, verse.verse, verse.verseEnd, translation)
      : fetchRemoteVerseText(verse.book, verse.chapter, verse.verse, translation);

    fetcher.then((text) => setRemoteText(text)).catch(() => setRemoteText(null));
  }, [verse, translation]);

  const displayText = translation === 'NIV'
    ? verse.verseText
    : remoteText === 'loading' ? null : remoteText;

  const isLoadingRemote = translation !== 'NIV' && remoteText === 'loading';

  const textClass = FONT_TEXT_CLASS[fontSize];

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      data-testid={`card-verse-${verse.reference.replace(/\s/g, '-')}`}
    >
      <Card
        className={`overflow-hidden bg-card transition-all duration-150 group cursor-pointer active:scale-[0.99] border-l-[3px] ${
          verse.verified
            ? 'border-border border-l-emerald-500 hover:border-l-emerald-400'
            : 'border-border border-l-amber-500 hover:border-l-amber-400'
        }`}
        onClick={() => onCopy(verse)}
      >
        <div className="p-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-serif text-lg font-bold text-primary leading-tight">
              {verse.reference}
            </h3>
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
              {verse.verified ? (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-emerald-500 text-white border-emerald-500" title="Verified in local data">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>{translation === 'NIV' ? 'NIV' : translation}</span>
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border bg-amber-500 text-white border-amber-500" title="Not in local data">
                  <HelpCircle className="w-3 h-3" />
                  <span>Unverified</span>
                </span>
              )}
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                  verse.source === 'ai'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-secondary-foreground border-border'
                }`}
                title={verse.source === 'ai' ? 'Detected by Groq AI' : 'Detected by local regex'}
              >
                {verse.source === 'ai' ? 'AI' : 'RX'}
              </span>
              <Copy className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {verse.isPartial ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Chapter overview — click a verse to copy:</p>
              <div className="space-y-1.5">
                {verse.suggestions.slice(0, 4).map((s) => (
                  <div
                    key={s.verse}
                    className={`${textClass} p-2.5 rounded-lg bg-background hover:bg-secondary transition-colors cursor-pointer border border-border hover:border-primary`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopy({ ...verse, reference: s.reference, verseText: s.text, verse: s.verse, isPartial: false });
                    }}
                  >
                    <span className="font-bold text-primary mr-2">{s.verse}</span>
                    <span className="text-foreground leading-relaxed">{s.text}</span>
                  </div>
                ))}
                {verse.suggestions.length === 0 && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 italic">
                    <Info className="w-3.5 h-3.5" /> No local data for this chapter
                  </div>
                )}
              </div>
            </div>
          ) : isLoadingRemote ? (
            <p className={`${textClass} text-muted-foreground italic animate-pulse`}>
              Fetching {translation} translation…
            </p>
          ) : displayText ? (
            <p className={`${textClass} text-foreground leading-relaxed font-serif`}>
              {displayText}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              {verse.verse != null
                ? `${verse.book} ${verse.chapter}:${verse.verse} — text not in local data`
                : 'Verse text unavailable'}
            </p>
          )}

          <p className="text-[10px] text-muted-foreground mt-2.5">
            Click to copy {displayText ? 'reference + text' : 'reference'}
          </p>
        </div>
      </Card>
    </motion.div>
  );
}
