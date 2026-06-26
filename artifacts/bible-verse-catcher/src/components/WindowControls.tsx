import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      apiBaseUrl: string | undefined;
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      onMaximizedChange: (cb: (maximized: boolean) => void) => void;
      getConfig: () => Promise<{ deepgramApiKey?: string; groqApiKey?: string }>;
      setConfig: (config: { deepgramApiKey?: string; groqApiKey?: string }) => Promise<void>;
    };
  }
}

export const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

export function WindowControls() {
  const { resolvedTheme } = useTheme();
  const [isMaximized, setIsMaximized] = useState(false);
  const api = window.electronAPI!;

  useEffect(() => {
    api.windowIsMaximized().then(setIsMaximized);
    api.onMaximizedChange(setIsMaximized);
  }, []);

  const isDark = resolvedTheme === 'dark';

  const btnBase =
    'flex items-center justify-center w-12 h-full transition-colors duration-100 select-none cursor-default';

  return (
    <div
      className="flex items-stretch h-full shrink-0"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Minimize */}
      <button
        onClick={() => api.windowMinimize()}
        className={`${btnBase} ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/8'} text-foreground/60 hover:text-foreground`}
        title="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
          <rect width="10" height="1" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        onClick={() => api.windowMaximize()}
        className={`${btnBase} ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/8'} text-foreground/60 hover:text-foreground`}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="0" width="8" height="8" />
            <polyline points="0,2 0,10 8,10" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0" y="0" width="10" height="10" />
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        onClick={() => api.windowClose()}
        className={`${btnBase} hover:bg-red-500 text-foreground/60 hover:text-white`}
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  );
}
