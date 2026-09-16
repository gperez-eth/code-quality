import type { ReactNode } from 'react';
import type { GateStatus, IssueType, Rating, Severity } from '@code-quality/core';
import type { Enums } from '@/lib/api/database.types';

/**
 * Rating badges are the one circular shape in the system: a letter score has
 * to pop out of a grid that is otherwise all right angles.
 */
const RATING_CLASS: Record<Rating, string> = {
  A: 'bg-rating-a',
  B: 'bg-rating-b',
  C: 'bg-rating-c',
  D: 'bg-rating-d',
  E: 'bg-rating-e',
};

const RATING_SIZE = {
  sm: 'w-5 h-5 text-label-sm',
  md: 'w-8 h-8 text-body-lg',
  lg: 'w-11 h-11 text-headline-md',
};

export function RatingBadge({ rating, size = 'md' }: { rating: Rating; size?: keyof typeof RATING_SIZE }) {
  return (
    <span
      className={`${RATING_CLASS[rating]} ${RATING_SIZE[size]} inline-flex items-center justify-center rounded-full font-semibold text-white`}
      title={`Rating ${rating}`}
    >
      {rating}
    </span>
  );
}

/** Colour carries the severity, so the label repeats it for everyone else. */
const SEVERITY_CLASS: Record<Severity, string> = {
  BLOCKER: 'bg-rating-e/12 text-rating-e border-rating-e/30',
  CRITICAL: 'bg-rating-d/12 text-rating-d border-rating-d/30',
  MAJOR: 'bg-rating-c/16 text-[#8a6d00] border-rating-c/40',
  MINOR: 'bg-primary-container/10 text-primary border-primary-container/25',
  INFO: 'bg-surface-container text-on-surface-variant border-outline-variant',
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={`${SEVERITY_CLASS[severity]} inline-flex items-center rounded-sm border px-1.5 py-px text-label-sm uppercase tracking-wide`}
    >
      {severity}
    </span>
  );
}

const TYPE_LABEL: Record<IssueType, string> = {
  BUG: 'Bug',
  VULNERABILITY: 'Vulnerability',
  CODE_SMELL: 'Code Smell',
  SECURITY_HOTSPOT: 'Security Hotspot',
};

const TYPE_ICON: Record<IssueType, string> = {
  BUG: 'bug_report',
  VULNERABILITY: 'lock_open',
  CODE_SMELL: 'sanitizer',
  SECURITY_HOTSPOT: 'security',
};

export function typeLabel(type: IssueType): string {
  return TYPE_LABEL[type];
}

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={`material-symbols-outlined leading-none ${className}`}>
      {name}
    </span>
  );
}

/**
 * Brand marks, inlined.
 *
 * Material Symbols carries no third-party logos — which is why the providers
 * used to show `code` and `merge`, neither of which is anybody's logo. These
 * are the official single-path marks (Simple Icons, CC0), inlined because two
 * paths do not need a dependency and a dependency would not survive the next
 * clear-out. `currentColor` and `1em` mean they take colour and size from the
 * same utility classes as `Icon`, so they are drop-in replacements.
 */
const BRAND_PATH: Record<'GITHUB' | 'GITLAB', string> = {
  GITHUB:
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  GITLAB:
    'm23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z',
};

/** No logo exists for a local folder or an unknown remote, so those keep the font. */
const PROVIDER_GLYPH: Record<Exclude<Enums<'repository_provider'>, keyof typeof BRAND_PATH>, string> = {
  LOCAL: 'folder',
  OTHER: 'commit',
};

/**
 * The provider's mark, wherever one is shown. Typed from the database enum on
 * purpose: adding a provider there becomes a compile error here rather than a
 * blank space in the table.
 */
export function ProviderIcon({
  provider,
  className = '',
}: {
  provider: Enums<'repository_provider'>;
  className?: string;
}) {
  if (provider === 'GITHUB' || provider === 'GITLAB') {
    return (
      <svg
        aria-hidden
        className={`inline-block shrink-0 ${className}`}
        fill="currentColor"
        height="1em"
        viewBox="0 0 24 24"
        width="1em"
      >
        <path d={BRAND_PATH[provider]} />
      </svg>
    );
  }

  return <Icon className={className} name={PROVIDER_GLYPH[provider]} />;
}

export function TypeChip({ type }: { type: IssueType }) {
  return (
    <span className="inline-flex items-center gap-1 text-body-sm text-on-surface-variant">
      <Icon className="text-[14px]" name={TYPE_ICON[type]} />
      {TYPE_LABEL[type]}
    </span>
  );
}

export function GateStatusPill({ status }: { status: GateStatus }) {
  // Neither green nor red. An analysis that measured nothing has no verdict,
  // and dressing that up as a pass is the one thing this badge must not do.
  if (status === 'NOT_COMPUTED') {
    return (
      <span
        className="rounded-full border border-outline-variant bg-surface-container px-3 py-px text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant"
        title="No source files were analysed, so there was nothing to judge"
      >
        Not computed
      </span>
    );
  }

  const passed = status === 'PASSED';

  return (
    <span
      className={`${passed ? 'bg-rating-a' : 'bg-error'} rounded-full px-3 py-px text-label-sm font-semibold uppercase tracking-wide text-white`}
    >
      {passed ? 'Passed' : 'Failed'}
    </span>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function PanelHeader({ children }: { children: ReactNode }) {
  return (
    <header className="flex items-center justify-between border-b border-outline-variant px-3 py-2 text-headline-sm">
      {children}
    </header>
  );
}

/** A number the eye should land on first, with its unit kept quiet. */
export function Stat({ value, label, tone = 'default' }: { value: string; label: string; tone?: 'default' | 'link' }) {
  return (
    <div className="flex flex-col">
      <span className={`text-stat ${tone === 'link' ? 'text-primary' : 'text-on-surface'}`}>{value}</span>
      <span className="text-body-sm text-secondary">{label}</span>
    </div>
  );
}
