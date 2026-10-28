// LoggingService: in-memory ring buffer for the Logs view + persistent file via Tauri.
import { invoke, isTauri } from './tauri';

export type LogLevel = 'DEBUG' | 'INFO' | 'AUDIO' | 'MARKETPLACE' | 'CLOUD' | 'BUILD' | 'INSTALL' | 'BACKUP' | 'UPDATE' | 'WARNING' | 'ERROR';
export const LOG_LEVELS: LogLevel[] = ['DEBUG', 'INFO', 'AUDIO', 'MARKETPLACE', 'CLOUD', 'BUILD', 'INSTALL', 'BACKUP', 'UPDATE', 'WARNING', 'ERROR'];
/** Display labels for the Logs page (the stored/written level stays English). */
export const LOG_LEVEL_LABEL: Record<LogLevel, string> = {
  DEBUG: 'DEBUG', INFO: 'INFO', AUDIO: 'AUDIO', MARKETPLACE: 'MARKTPLATZ', CLOUD: 'CLOUD', BUILD: 'BAUEN',
  INSTALL: 'INSTALLATION', BACKUP: 'BACKUP', UPDATE: 'UPDATE', WARNING: 'WARNUNG', ERROR: 'FEHLER',
};

export interface LogEntry { id: number; time: number; level: LogLevel; message: string; detail?: string }

const MAX = 2000;
const entries: LogEntry[] = [];
const listeners = new Set<() => void>();
let seq = 0;
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Never let secrets reach a log line.
const REDACT = /(password|token|secret|authorization)(["'\s:=]+)([^\s"',]+)/gi;

function flush() {
  flushTimer = null;
  if (!pending.length || !isTauri()) { pending = []; return; }
  const lines = pending;
  pending = [];
  invoke('write_log', { lines }).catch(() => { /* logging must never throw */ });
}

export function log(level: LogLevel, message: string, detail?: unknown) {
  const clean = message.replace(REDACT, '$1$2[redacted]');
  const det = detail == null ? undefined : (detail instanceof Error ? `${detail.name}: ${detail.message}\n${detail.stack ?? ''}` : typeof detail === 'string' ? detail : JSON.stringify(detail));
  const e: LogEntry = { id: ++seq, time: Date.now(), level, message: clean, detail: det?.replace(REDACT, '$1$2[redacted]') };
  entries.push(e);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  pending.push(`${new Date(e.time).toISOString()} [${level}] ${clean}${e.detail ? ' | ' + e.detail : ''}`);
  if (!flushTimer) flushTimer = setTimeout(flush, 500);
  listeners.forEach((l) => l());
  if (level === 'ERROR') console.error(`[SP Tool] ${clean}`, detail ?? '');
}

export const logger = {
  debug: (m: string, d?: unknown) => log('DEBUG', m, d),
  info: (m: string, d?: unknown) => log('INFO', m, d),
  audio: (m: string, d?: unknown) => log('AUDIO', m, d),
  warn: (m: string, d?: unknown) => log('WARNING', m, d),
  error: (m: string, d?: unknown) => log('ERROR', m, d),
};

export function getLogs(): LogEntry[] { return entries; }
export function subscribeLogs(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function clearLogs() { entries.length = 0; listeners.forEach((l) => l()); }

export function formatLogs(list: LogEntry[]): string {
  return list.map((e) => `${new Date(e.time).toISOString()} [${e.level}] ${e.message}${e.detail ? '\n    ' + e.detail.replace(/\n/g, '\n    ') : ''}`).join('\n');
}

// Global crash capture → logs (crash recovery for projects follows in Phase 3)
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => log('ERROR', `Unhandled error: ${ev.message}`, ev.error));
  window.addEventListener('unhandledrejection', (ev) => log('ERROR', 'Unhandled promise rejection', ev.reason));
}
