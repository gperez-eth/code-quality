'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { type ProjectBranch, useGetProjectBranchesQuery } from '@/lib/api';
import { Icon } from './primitives';

/**
 * Which branch the project screens are showing.
 *
 * It lives in the URL rather than in component state so a link to "issues on
 * develop" is a link somebody can send, and the back button walks branches the
 * way it walks everything else. Absent means the newest analysis whatever
 * branch it ran on, which is what every screen did before branches existed.
 */
export function useSelectedBranch(): string | null {
  return useSearchParams().get('branch');
}

/** The dot beside a branch name: what its last analysis decided, at a glance. */
function GateDot({ branch }: { branch: ProjectBranch }) {
  const tone =
    branch.gateStatus === 'PASSED'
      ? 'bg-[#22c55e]'
      : branch.gateStatus === 'FAILED'
        ? 'bg-error'
        : branch.analysisStatus === 'RUNNING' || branch.analysisStatus === 'PENDING'
          ? 'bg-primary-container'
          : 'bg-outline-variant';

  const label = branch.analysisId ? (branch.gateStatus ?? 'Not computed') : 'Never analysed';

  return <span aria-label={label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} title={label} />;
}

export function BranchSwitcher({ projectId, fallbackBranch }: { projectId: string; fallbackBranch: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get('branch');

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const { data: branches } = useGetProjectBranchesQuery(projectId, { skip: !projectId });

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!branches) return [];
    return needle ? branches.filter((branch) => branch.name.toLowerCase().includes(needle)) : branches;
  }, [branches, filter]);

  function choose(name: string | null) {
    const next = new URLSearchParams(params.toString());
    // The default branch is the absent case, not a value: keeping it out of the
    // URL means the plain project link is the one people share.
    if (name === null) next.delete('branch');
    else next.set('branch', name);

    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
    setOpen(false);
    setFilter('');
  }

  const current = selected ?? fallbackBranch;

  return (
    <span className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-sm border border-outline-variant bg-surface-container px-1.5 py-px text-label-sm text-on-secondary-container hover:border-outline"
        onClick={() => setOpen((was) => !was)}
        type="button"
      >
        <Icon className="text-[13px]" name="account_tree" />
        <span className="max-w-[160px] truncate font-mono">{current}</span>
        <Icon className="text-[13px]" name={open ? 'arrow_drop_up' : 'arrow_drop_down'} />
      </button>

      {open ? (
        <>
          {/* Catches the click that closes the menu without stealing focus
              from anything inside it. */}
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} role="presentation" />
          <div
            className="absolute right-0 z-50 mt-1 w-[280px] rounded-sm border border-outline bg-surface-container-lowest text-left shadow-[0_2px_4px_rgba(0,0,0,0.08)]"
            role="listbox"
          >
            <div className="border-b border-outline-variant p-1.5">
              <input
                autoFocus
                className="h-[26px] w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 text-body-sm focus:border-primary-container focus:outline-none"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter branches"
                value={filter}
              />
            </div>

            <div className="max-h-[280px] overflow-y-auto py-1">
              {!branches ? (
                <p className="px-2.5 py-2 text-body-sm text-on-surface-variant">Loading branches…</p>
              ) : branches.length === 0 ? (
                <p className="px-2.5 py-2 text-body-sm text-on-surface-variant">
                  No branches recorded yet. They are read from the repository the next time an analysis runs.
                </p>
              ) : shown.length === 0 ? (
                <p className="px-2.5 py-2 text-body-sm text-on-surface-variant">Nothing matches “{filter}”.</p>
              ) : (
                shown.map((branch) => {
                  const active = branch.name === current;
                  return (
                    <button
                      aria-selected={active}
                      className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-body-sm hover:bg-surface-container-low ${
                        active ? 'bg-surface-container-low font-medium' : ''
                      }`}
                      key={branch.name}
                      onClick={() => choose(branch.isDefault ? null : branch.name)}
                      role="option"
                      type="button"
                    >
                      <Icon className="text-[13px] text-on-surface-variant" name="account_tree" />
                      <span className="min-w-0 flex-1 truncate font-mono text-code-body">{branch.name}</span>
                      {branch.isDefault ? (
                        <span className="rounded-sm border border-outline-variant px-1 text-label-sm text-on-surface-variant">
                          default
                        </span>
                      ) : null}
                      <GateDot branch={branch} />
                      {active ? <Icon className="text-[13px] text-primary" name="check" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </span>
  );
}
