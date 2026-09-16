/**
 * Letter ratings (A best, E worst) are the core visual primitive of the
 * dashboard: circular badges next to every metric scorecard.
 */
export const RATINGS = ['A', 'B', 'C', 'D', 'E'] as const;

export type Rating = (typeof RATINGS)[number];

/** Hex values come straight from the Stitch design system (Sonar semantics). */
export const RATING_COLORS: Record<Rating, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#ea580c',
  E: '#dc2626',
};

export function isWorseThan(actual: Rating, threshold: Rating): boolean {
  return RATINGS.indexOf(actual) > RATINGS.indexOf(threshold);
}

export function worstOf(ratings: readonly Rating[]): Rating {
  return ratings.reduce<Rating>((worst, r) => (isWorseThan(r, worst) ? r : worst), 'A');
}

/**
 * Reliability and security are rated by the worst issue present, matching the
 * "one blocker drops you to E" behaviour the mockups imply.
 */
export function ratingFromWorstSeverity(counts: {
  blocker: number;
  critical: number;
  major: number;
  minor: number;
}): Rating {
  if (counts.blocker > 0) return 'E';
  if (counts.critical > 0) return 'D';
  if (counts.major > 0) return 'C';
  if (counts.minor > 0) return 'B';
  return 'A';
}

/**
 * Maintainability is rated by the technical debt ratio: remediation cost as a
 * share of the estimated cost to rewrite the codebase from scratch.
 */
export function ratingFromDebtRatio(ratio: number): Rating {
  if (ratio <= 0.05) return 'A';
  if (ratio <= 0.1) return 'B';
  if (ratio <= 0.2) return 'C';
  if (ratio <= 0.5) return 'D';
  return 'E';
}

/** Ratings travel through the database as 1..5 so one numeric column serves all. */
export function ratingValue(rating: Rating): number {
  return RATINGS.indexOf(rating) + 1;
}

export function ratingFromValue(value: number): Rating {
  return RATINGS[Math.max(0, Math.min(RATINGS.length - 1, Math.round(value) - 1))] ?? 'A';
}
