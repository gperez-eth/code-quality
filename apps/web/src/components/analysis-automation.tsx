'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  type Project,
  useGetMatchingBranchesQuery,
  useGetProjectBranchesQuery,
  useHasGitHubInstallationQuery,
  useSetAnalysisAutomationMutation,
} from '@/lib/api';
import { Icon } from './primitives';

/**
 * When this project gets analysed without anyone pressing a button.
 *
 * The settings are per project and they are saved through
 * `set_analysis_automation`, which checks membership itself — the browser is
 * not trusted to have checked.
 */

const INPUT =
  'h-[30px] w-full rounded-sm border border-outline-variant bg-surface-container-lowest px-2 text-body-md focus:border-primary-container focus:outline-none';

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      className={`relative h-[18px] w-[32px] shrink-0 rounded-full transition-colors ${
        checked ? 'bg-primary-container' : 'bg-outline-variant'
      }`}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-surface-container-lowest transition-all ${
          checked ? 'left-[16px]' : 'left-[2px]'
        }`}
      />
    </button>
  );
}

export function AnalysisAutomationDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [enabled, setEnabled] = useState(project.analyzeOnPush);
  const [onNewBranch, setOnNewBranch] = useState(project.analyzeOnNewBranch);
  const [patterns, setPatterns] = useState<string[]>(project.analyzeBranchPatterns);
  const [draft, setDraft] = useState('');

  const [save, { isLoading: saving, error: saveError }] = useSetAnalysisAutomationMutation();
  const { data: branches } = useGetProjectBranchesQuery(project.id);
  const { data: hasInstallation } = useHasGitHubInstallationQuery();

  // The preview asks the database, so it cannot disagree with the webhook about
  // what a pattern means. Debounced because it re-runs on every keystroke.
  const [settled, setSettled] = useState(patterns);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(patterns), 250);
    return () => clearTimeout(timer);
  }, [patterns]);

  const { data: matching } = useGetMatchingBranchesQuery(
    { projectId: project.id, patterns: settled },
    { skip: settled.length === 0 },
  );

  const matched = useMemo(() => matching ?? [], [matching]);

  function addDraft() {
    const value = draft.trim();
    if (value === '' || patterns.includes(value)) {
      setDraft('');
      return;
    }
    setPatterns((was) => [...was, value]);
    setDraft('');
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    const result = await save({
      projectId: project.id,
      analyzeOnPush: enabled,
      // Whatever is still in the box counts: nobody expects to lose a pattern
      // because they did not press Enter after typing it.
      branchPatterns: draft.trim() && !patterns.includes(draft.trim()) ? [...patterns, draft.trim()] : patterns,
      analyzeOnNewBranch: onNewBranch,
    });

    if (!('error' in result)) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-inverse-surface/40 p-6 pt-[10vh]"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
      role="presentation"
    >
      <form
        aria-labelledby="automation-title"
        aria-modal
        className="w-[620px] max-w-full rounded-sm border border-outline bg-surface-container-lowest shadow-[0_2px_4px_rgba(0,0,0,0.08)]"
        onSubmit={onSubmit}
        role="dialog"
      >
        <header className="flex items-center justify-between border-b border-outline-variant px-4 py-2.5">
          <span className="flex items-center gap-1.5">
            <Icon className="text-[18px] text-primary-container" name="settings" />
            <span>
              <h2 className="text-headline-sm" id="automation-title">
                Analysis automation
              </h2>
              <span className="block font-mono text-code-body text-on-surface-variant">{project.key}</span>
            </span>
          </span>
          <button aria-label="Close" disabled={saving} onClick={onClose} type="button">
            <Icon className="text-[18px] text-on-surface-variant" name="close" />
          </button>
        </header>

        <div className="flex items-start gap-2.5 border-b border-outline-variant px-4 py-3">
          <Toggle checked={enabled} onChange={setEnabled} />
          <span>
            <span className="block text-label-md">Analyse automatically</span>
            <span className="block text-body-sm text-on-surface-variant">
              Off means this project is only ever analysed when someone presses Analyse.
            </span>
          </span>
        </div>

        <fieldset className="border-b border-outline-variant px-4 py-3" disabled={!enabled}>
          <legend className="pb-1.5 text-label-sm tracking-wide text-on-surface-variant uppercase">
            When to analyse
          </legend>

          <div className={`flex flex-col gap-2.5 ${enabled ? '' : 'opacity-50'}`}>
            <label className="flex items-start gap-2.5">
              <input checked disabled readOnly type="checkbox" />
              <span>
                <span className="block text-label-md">On every push to a matching branch</span>
                <span className="block text-body-sm text-on-surface-variant">
                  A merge into master or develop is a push, so this is what covers merges.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5">
              <input checked={onNewBranch} onChange={(event) => setOnNewBranch(event.target.checked)} type="checkbox" />
              <span>
                <span className="block text-label-md">When a new branch is created</span>
                <span className="block text-body-sm text-on-surface-variant">
                  The push that creates a branch gets one analysis, so it has a baseline immediately — whether or not it
                  matches a pattern below.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 opacity-50">
              <input disabled type="checkbox" />
              <span>
                <span className="flex items-center gap-1.5 text-label-md">
                  When a pull request is opened or updated
                  <span className="rounded-sm border border-outline-variant px-1 text-label-sm text-on-surface-variant">
                    Needs branch analysis
                  </span>
                </span>
                <span className="block text-body-sm text-on-surface-variant">
                  A pull request needs its own baseline to compare against, which does not exist yet.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset className="border-b border-outline-variant px-4 py-3" disabled={!enabled}>
          <legend className="text-label-sm tracking-wide text-on-surface-variant uppercase">Matching branches</legend>
          <p className="pb-1.5 text-body-sm text-on-surface-variant">
            Glob patterns. <code className="font-mono text-code-body">*</code> matches anything, so{' '}
            <code className="font-mono text-code-body">release/*</code> covers every release branch.
          </p>

          <div className={`flex flex-wrap items-center gap-1.5 rounded-sm border border-outline-variant p-1.5 ${enabled ? '' : 'opacity-50'}`}>
            {patterns.map((pattern) => (
              <span
                className="flex items-center gap-1 rounded-sm border border-primary-container/40 bg-surface-container-low px-1.5 py-px font-mono text-code-body"
                key={pattern}
              >
                {pattern}
                <button
                  aria-label={`Remove ${pattern}`}
                  onClick={() => setPatterns((was) => was.filter((one) => one !== pattern))}
                  type="button"
                >
                  <Icon className="text-[12px] text-on-surface-variant" name="close" />
                </button>
              </span>
            ))}
            <input
              className="h-[22px] min-w-[140px] flex-1 bg-transparent px-1 font-mono text-code-body focus:outline-none"
              onBlur={addDraft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  // Enter here means "add a pattern", not "submit the form".
                  event.preventDefault();
                  addDraft();
                }
              }}
              placeholder="Add a pattern…"
              value={draft}
            />
          </div>

          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-sm border border-outline-variant bg-surface-container-low px-2 py-1 text-body-sm text-on-surface-variant">
            {patterns.length === 0 ? (
              <>
                <Icon className="text-[14px]" name="info" />
                No patterns, so a push only triggers an analysis when it creates a branch.
              </>
            ) : (
              <>
                <Icon className="text-[14px]" name="check" />
                {matched.length} of {branches?.length ?? 0} branches match right now
                {matched.length > 0 ? ':' : '.'}
                {matched.slice(0, 6).map((name) => (
                  <code className="font-mono text-code-body text-on-surface" key={name}>
                    {name}
                  </code>
                ))}
                {matched.length > 6 ? <span>and {matched.length - 6} more</span> : null}
              </>
            )}
          </p>
        </fieldset>

        {hasInstallation === false ? (
          <div className="mx-4 my-3 flex items-start gap-2 rounded-sm border border-[#fde68a] bg-[#fffbeb] px-2.5 py-2 text-body-sm">
            <Icon className="text-[16px] text-[#b45309]" name="warning" />
            <span>
              Automatic analysis needs the GitHub App. This organisation has not installed it, so these settings are
              saved but nothing will trigger.{' '}
              <a className="text-primary hover:underline" href="/api/github/install">
                Install the GitHub App
              </a>
            </span>
          </div>
        ) : null}

        {saveError ? (
          <p className="mx-4 my-3 rounded-sm border border-error/30 bg-error-container/40 px-2.5 py-1.5 text-body-sm text-on-error-container">
            {'message' in saveError ? saveError.message : 'Could not save.'}
          </p>
        ) : null}

        <footer className="flex items-center justify-between border-t border-outline-variant bg-surface-container-low px-4 py-3">
          <span className="text-body-sm text-on-surface-variant">Applies to this project only.</span>
          <span className="flex items-center gap-2">
            <button
              className="rounded-sm border border-outline-variant px-3 py-1.5 text-label-md disabled:opacity-60"
              disabled={saving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-1.5 text-label-md font-medium text-on-primary disabled:opacity-60"
              disabled={saving}
              type="submit"
            >
              {saving ? <Icon className="animate-spin text-[14px]" name="progress_activity" /> : null}
              Save automation
            </button>
          </span>
        </footer>
      </form>
    </div>
  );
}
