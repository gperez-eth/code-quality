const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'TSX',
  javascript: 'JavaScript',
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language;
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/** "26k" — the compact form the scorecards use for large counts. */
export function formatCompact(value: number): string {
  if (value < 1000) return formatNumber(value);
  return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * Timestamps arrive as ISO strings, because that is what the API returns and
 * what the Redux store is allowed to hold — a Date is not serialisable, so it
 * is built here, at the edge, rather than kept in the cache.
 */
export type Timestamp = Date | string | null | undefined;

function toDate(value: Timestamp): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelative(value: Timestamp): string {
  const date = toDate(value);
  if (!date) return 'never';

  const elapsed = date.getTime() - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) return relative.format(Math.round(elapsed / ms), unit);
  }

  return 'just now';
}

const absolute = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function formatDateTime(value: Timestamp): string {
  const date = toDate(value);
  return date ? absolute.format(date) : '—';
}
