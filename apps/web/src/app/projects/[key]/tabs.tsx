'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The tabs the design calls for. The greyed ones are screens 03-07, not built. */
const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Issues', segment: '/issues' },
  { label: 'Measures', segment: undefined },
  { label: 'Code', segment: undefined },
  { label: 'Activity', segment: undefined },
];

export function ProjectTabs({ projectKey }: { projectKey: string }) {
  const pathname = usePathname();
  const base = `/projects/${encodeURIComponent(projectKey)}`;

  return (
    <nav className="flex h-[42px] items-center gap-3">
      {TABS.map((tab) => {
        if (tab.segment === undefined) {
          return (
            <span
              className="flex h-full cursor-not-allowed items-center border-b-2 border-transparent px-1 text-label-md text-on-surface-variant/40"
              key={tab.label}
              title="Not built yet"
            >
              {tab.label}
            </span>
          );
        }

        const href = `${base}${tab.segment}`;
        const active = pathname === href;

        return (
          <Link
            aria-current={active ? 'page' : undefined}
            className={`flex h-full items-center border-b-2 px-1 text-label-md transition-colors ${
              active
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
            href={href}
            key={tab.label}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
