import Link from 'next/link';
import type { Rating } from '@code-quality/core';
import { Icon, RatingBadge } from './primitives';

export interface MetricCardProps {
  title: string;
  icon: string;
  /** The whole codebase. */
  value: string;
  label: string;
  rating?: Rating;
  /** The leak period. Null when this metric cannot be attributed to new code. */
  newCode?: { value: string; label: string; rating?: Rating } | null;
  note?: string;
  href?: string;
}

/**
 * The scorecard the overview is built from: one metric, the whole codebase on
 * top and the leak period underneath on its warm tint, so the two never blur
 * into one number.
 */
export function MetricCard({ title, icon, value, label, rating, newCode, note, href }: MetricCardProps) {
  const headline = (
    <div className="flex items-baseline gap-2">
      <span className={`text-stat ${href ? 'text-primary' : 'text-on-surface'}`}>{value}</span>
      <span className="text-body-md text-secondary">{label}</span>
    </div>
  );

  return (
    <section className="panel flex flex-col">
      <header className="flex items-center justify-between border-b border-outline-variant px-3 py-2">
        <span className="flex items-center gap-1.5 text-headline-sm">
          <Icon className="text-[16px] text-secondary" name={icon} />
          {title}
        </span>
        {rating ? <RatingBadge rating={rating} size="sm" /> : null}
      </header>

      <div className="flex flex-1 flex-col gap-1 px-3 py-3">
        {href ? (
          <Link className="hover:underline" href={href}>
            {headline}
          </Link>
        ) : (
          headline
        )}
        {note ? <p className="text-body-sm text-on-surface-variant">{note}</p> : null}
      </div>

      {newCode !== undefined ? (
        <div className="flex items-center justify-between border-t border-leak-border bg-leak px-3 py-2">
          <span className="text-label-sm tracking-wide text-on-surface-variant uppercase">New code</span>
          {newCode === null ? (
            <span className="text-body-sm text-on-surface-variant" title="Needs a baseline analysis to measure">
              not measured
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="text-body-lg font-medium">{newCode.value}</span>
              <span className="text-body-sm text-secondary">{newCode.label}</span>
              {newCode.rating ? <RatingBadge rating={newCode.rating} size="sm" /> : null}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
