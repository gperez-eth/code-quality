'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  describeCondition,
  formatEffort,
  formatMeasure,
  METRICS,
  type MetricKey,
  ratingFromValue,
} from '@code-quality/core';
import { MetricCard } from '@/components/metric-card';
import { GateStatusPill, Icon, Panel, PanelHeader } from '@/components/primitives';
import { QueryError, QueryLoading } from '@/components/query-state';
import { type Measures, type Overview, useGetOverviewQuery } from '@/lib/api';
import { formatCompact, formatNumber, formatPercent, languageLabel } from '@/lib/format';

// Measures are a plain object rather than the Map the server used: a Map does
// not survive the Redux store.
function overall(measures: Measures, metric: MetricKey): number | null {
  return measures[metric]?.value ?? null;
}

function newCode(measures: Measures, metric: MetricKey): number | null {
  return measures[metric]?.newCodeValue ?? null;
}

function rating(measures: Measures, metric: MetricKey, scope: 'overall' | 'new') {
  const value = scope === 'overall' ? overall(measures, metric) : newCode(measures, metric);
  return value === null ? undefined : ratingFromValue(value);
}

/** Rating conditions fail with a letter; everything else just fails. */
function conditionBadge(metric: MetricKey, actual: number | null): string {
  if (actual === null) return '?';
  return METRICS[metric].valueType === 'RATING' ? formatMeasure(metric, actual) : '!';
}

/** The size band SonarQube shows beside the line count: XS through XL. */
function sizeBadge(ncloc: number): string {
  if (ncloc < 1_000) return 'XS';
  if (ncloc < 10_000) return 'S';
  if (ncloc < 100_000) return 'M';
  if (ncloc < 500_000) return 'L';
  return 'XL';
}

/** Counts read as a number even when the analysis produced nothing. */
function countOf(measures: Measures, metric: MetricKey): number {
  return overall(measures, metric) ?? 0;
}

function QualityGate({ overview }: { overview: Overview }) {
  const { gate, gateName, measures, analysis } = overview;
  const failed = gate.status === 'FAILED';

  return (
    <Panel className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="flex items-center gap-2">
          <span className="text-headline-sm">Quality Gate</span>
          <GateStatusPill status={gate.status} />
          <span className="text-body-sm text-on-surface-variant">{gateName}</span>
        </span>

        {failed ? (
          <ul className="flex flex-wrap gap-2">
            {gate.failing.map((condition) => (
              <li
                className="flex items-center gap-2 rounded-sm bg-error-container/40 px-3 py-1"
                key={`${condition.metric}-${condition.scope}`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-error text-label-sm font-bold text-on-error">
                  {conditionBadge(condition.metric, condition.actual)}
                </span>
                <span className="flex flex-col">
                  <span className="text-body-sm font-medium">{describeCondition(condition)}</span>
                  <span className="text-label-sm font-semibold text-error">
                    actual{' '}
                    {condition.actual === null ? 'not measured' : formatMeasure(condition.metric, condition.actual)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-body-sm text-on-surface-variant">
            All {gate.conditions.length} conditions are within their thresholds.
          </span>
        )}
      </div>

      <div className="flex items-center gap-6">
        <span className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-label-md font-bold text-on-primary"
            title="Project size"
          >
            {sizeBadge(countOf(measures, 'ncloc'))}
          </span>
          <span className="flex flex-col">
            <span className="text-headline-sm text-primary">{formatCompact(countOf(measures, 'ncloc'))}</span>
            <span className="text-body-sm text-secondary">Lines of Code</span>
          </span>
        </span>
        {analysis.isFirstAnalysis ? (
          <span
            className="hidden max-w-[260px] items-center gap-1.5 rounded-sm border border-leak-border bg-leak px-2 py-1 text-body-sm text-on-surface-variant xl:flex"
            title="New code is measured against the previous analysis"
          >
            <Icon className="text-[14px]" name="new_releases" />
            First analysis: the whole codebase counts as new code.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function Languages({ overview }: { overview: Overview }) {
  const total = overview.languages.reduce((sum, language) => sum + language.ncloc, 0);

  return (
    <Panel>
      <PanelHeader>
        <span>Language breakdown</span>
        <span className="text-body-sm font-normal text-on-surface-variant">{formatNumber(total)} lines</span>
      </PanelHeader>
      <ul className="flex flex-col gap-2 px-3 py-3">
        {overview.languages.map((language) => (
          <li className="flex flex-col gap-1" key={language.language}>
            <span className="flex items-baseline justify-between text-body-sm">
              <span>{languageLabel(language.language)}</span>
              <span className="text-on-surface-variant">{formatNumber(language.ncloc)}</span>
            </span>
            <span className="h-1.5 w-full rounded-full bg-surface-container">
              <span
                className="block h-1.5 rounded-full bg-primary-container"
                style={{ width: `${total === 0 ? 0 : Math.max(2, (language.ncloc / total) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function WorstFiles({ overview }: { overview: Overview }) {
  const base = `/projects/${encodeURIComponent(overview.project.key)}/issues`;

  return (
    <Panel>
      <PanelHeader>
        <span>Remediation effort by file</span>
      </PanelHeader>
      {overview.worstFiles.length === 0 ? (
        <p className="px-3 py-3 text-body-sm text-on-surface-variant">Nothing to fix. Enjoy it while it lasts.</p>
      ) : (
        <ul>
          {overview.worstFiles.map((file) => (
            <li className="border-b border-outline-variant last:border-b-0" key={file.filePath}>
              <Link
                className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-container-low"
                href={`${base}?file=${encodeURIComponent(file.filePath)}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-code-body text-tertiary" dir="rtl">
                    {file.filePath}
                  </span>
                  <span className="text-body-sm text-on-surface-variant">
                    {file.issueCount} {file.issueCount === 1 ? 'issue' : 'issues'} · {formatNumber(file.ncloc)} lines
                  </span>
                </span>
                <span className="shrink-0 text-body-md font-medium">{formatEffort(file.effortMinutes)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Size({ measures }: { measures: Measures }) {
  const rows: Array<[string, string]> = [
    ['Lines of code', formatNumber(countOf(measures, 'ncloc'))],
    ['Lines', formatNumber(countOf(measures, 'lines'))],
    ['Files', formatNumber(countOf(measures, 'files'))],
    ['Cyclomatic complexity', formatNumber(countOf(measures, 'complexity'))],
    ['Cognitive complexity', formatNumber(countOf(measures, 'cognitive_complexity'))],
    ['Comments', formatPercent(overall(measures, 'comment_lines_density'))],
  ];

  return (
    <Panel>
      <PanelHeader>
        <span>Size</span>
      </PanelHeader>
      <dl className="flex flex-col">
        {rows.map(([label, value]) => (
          <div
            className="flex items-center justify-between border-b border-outline-variant px-3 py-1.5 last:border-b-0"
            key={label}
          >
            <dt className="text-body-sm text-on-surface-variant">{label}</dt>
            <dd className="text-body-md">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function OverviewClient({ projectKey }: { projectKey: string }) {
  const { data: overview, error, isLoading, refetch } = useGetOverviewQuery(projectKey);

  if (isLoading) return <QueryLoading label="Loading overview" />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;
  if (!overview) notFound();

  const { measures } = overview;
  const issues = `/projects/${encodeURIComponent(overview.project.key)}/issues`;
  const coverage = overall(measures, 'coverage');

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-3">
      <QualityGate overview={overview} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            href={`${issues}?type=BUG`}
            icon="bug_report"
            label={countOf(measures, 'bugs') === 1 ? 'Bug' : 'Bugs'}
            newCode={{
              value: formatNumber(newCode(measures, 'bugs') ?? 0),
              label: 'Bugs',
              rating: rating(measures, 'reliability_rating', 'new'),
            }}
            rating={rating(measures, 'reliability_rating', 'overall')}
            title="Reliability"
            value={formatNumber(countOf(measures, 'bugs'))}
          />
          <MetricCard
            href={`${issues}?type=VULNERABILITY`}
            icon="lock_open"
            label={countOf(measures, 'vulnerabilities') === 1 ? 'Vulnerability' : 'Vulnerabilities'}
            newCode={{
              value: formatNumber(newCode(measures, 'vulnerabilities') ?? 0),
              label: 'Vulnerabilities',
              rating: rating(measures, 'security_rating', 'new'),
            }}
            rating={rating(measures, 'security_rating', 'overall')}
            title="Security"
            value={formatNumber(countOf(measures, 'vulnerabilities'))}
          />
          <MetricCard
            href={`${issues}?type=SECURITY_HOTSPOT`}
            icon="security"
            label={countOf(measures, 'security_hotspots') === 1 ? 'Hotspot to review' : 'Hotspots to review'}
            newCode={{ value: formatNumber(newCode(measures, 'security_hotspots') ?? 0), label: 'Hotspots' }}
            title="Security Review"
            value={formatNumber(countOf(measures, 'security_hotspots'))}
          />
          <MetricCard
            href={`${issues}?type=CODE_SMELL`}
            icon="sanitizer"
            label={countOf(measures, 'code_smells') === 1 ? 'Code Smell' : 'Code Smells'}
            newCode={{
              value: formatNumber(newCode(measures, 'code_smells') ?? 0),
              label: 'Code Smells',
              rating: rating(measures, 'sqale_rating', 'new'),
            }}
            note={`${formatEffort(countOf(measures, 'sqale_index'))} of technical debt`}
            rating={rating(measures, 'sqale_rating', 'overall')}
            title="Maintainability"
            value={formatNumber(countOf(measures, 'code_smells'))}
          />
          <MetricCard
            icon="shield"
            label="Coverage"
            newCode={null}
            note={coverage === null ? 'No test report has been ingested yet.' : undefined}
            title="Coverage"
            value={formatPercent(coverage)}
          />
          <MetricCard
            icon="content_copy"
            label="Duplications"
            newCode={
              newCode(measures, 'duplicated_lines_density') === null
                ? null
                : { value: formatPercent(newCode(measures, 'duplicated_lines_density')), label: 'Duplications' }
            }
            note={`${formatNumber(countOf(measures, 'duplicated_blocks'))} duplicated blocks`}
            title="Duplications"
            value={formatPercent(overall(measures, 'duplicated_lines_density'))}
          />
        </div>

        <aside className="flex flex-col gap-3">
          <Languages overview={overview} />
          <WorstFiles overview={overview} />
          <Size measures={measures} />
        </aside>
      </div>
    </main>
  );
}
