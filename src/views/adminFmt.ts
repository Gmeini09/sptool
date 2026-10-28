// Date formatting for account / admin screens.
export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('de-DE', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = (t: number | null | undefined) => (t ? new Date(t).toLocaleString('de-DE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function fmtAgo(t: number | null | undefined, now = Date.now()) {
  if (!t) return 'nie';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  return `vor ${Math.floor(s / 86400)} T.`;
}
