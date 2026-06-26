import { useState, useCallback, useEffect } from 'react';
import type { EnrichedVerse } from './useVerseDetection';

export interface Session {
  id: string;
  label: string;     // e.g. "Sunday 22 June 2026"
  savedAt: number;   // unix ms
  verses: EnrichedVerse[];
}

const STORAGE_KEY = 'vc-sessions';
const MAX_SESSIONS = 30;

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch { return []; }
}

function saveSessions(sessions: Session[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch {}
}

/** Returns a human-readable label for the current session, e.g. "Sunday, 22 Jun 2026 – 10:30 AM" */
function makeLabel(): string {
  return new Date().toLocaleString('en-US', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function useSessionHistory() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [currentId] = useState<string>(() => `session-${Date.now()}`);

  // Sync from storage whenever another tab writes (desktop edge-case)
  useEffect(() => {
    const handler = () => setSessions(loadSessions());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  /** Call this whenever the current verse list changes — auto-saves/updates the session. */
  const saveCurrentSession = useCallback((verses: EnrichedVerse[]) => {
    if (verses.length === 0) return;
    setSessions((prev) => {
      const existing = prev.find((s) => s.id === currentId);
      const updated: Session = {
        id: currentId,
        label: existing?.label ?? makeLabel(),
        savedAt: Date.now(),
        verses,
      };
      const rest = prev.filter((s) => s.id !== currentId);
      const next = [updated, ...rest].slice(0, MAX_SESSIONS);
      saveSessions(next);
      return next;
    });
  }, [currentId]);

  /** Delete a session by id. */
  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      return next;
    });
  }, []);

  /** Clear all sessions. */
  const clearAll = useCallback(() => {
    saveSessions([]);
    setSessions([]);
  }, []);

  const pastSessions = sessions.filter((s) => s.id !== currentId);

  return { sessions, pastSessions, currentId, saveCurrentSession, deleteSession, clearAll };
}
