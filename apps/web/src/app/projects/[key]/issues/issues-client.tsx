'use client';

import Link from 'next/link';
import { notFound, useSearchParams } from 'next/navigation';
import {
  formatEffort,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  type IssueStatus,
  type IssueType,
  SEVERITIES,
} from '@code-quality/core';
import { Icon, Panel, SeverityChip, TypeChip, typeLabel } from '@/components/primitives';
import { QueryError, QueryLoading } from '@/components/query-state';
import { type Facet, type IssueFilters, ISSUES_PER_PAGE, useGetIssuesQuery, useGetProjectByKeyQuery } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import {
  clearedFilters,
  type FacetName,
  hasAnyFilter,
  hrefFor,
  isSelected,
  parseFilters,
  type SearchParams,
  toggleFacet,
  withNewCode,
  withoutFile,
  withPage,
} from '@/lib/issue-filters';

const STATUS_LABEL: Record<IssueStatus, string> = {
  OPEN: 'Open',
  CONFIRMED: 'Confirmed',
  REOPENED: 'Reopened',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/**
 * The filters live in the URL, as before — but they are read here rather than
 * on the server, so toggling a facet is a client-side navigation and a cached
 * query, not a round trip that re-renders the page.
 */
function toSearchParams(params: URLSearchParams): SearchParams {
  const result: SearchParams = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    result[key] = all.length > 1 ? all : all[0];
  }
  return result;
}

interface FacetGroupProps {
  title: string;
  facet: FacetName;
  /** Every possible value, so a facet does not vanish once it hits zero. */
  values: readonly string[];
  counts: Array<Facet<string>>;
  labels?: (value: string) => string;
  filters: IssueFilters;
  basePath: string;
}

function FacetGroup({ title, facet, values, counts, labels, filters, basePath }: FacetGroupProps) {
  const byValue = new Map(counts.map((entry) => [entry.value, entry.count]));
  const shown = values.filter((value) => byValue.has(value) || isSelected(filters, facet, value));
  if (shown.length === 0) return null;

  return (
    <section className="border-b border-outline-variant py-2 last:border-b-0">
      <h2 className="px-3 pb-1 text-label-sm tracking-wide text-on-surface-variant uppercase">{title}</h2>
      <ul>
        {shown.map((value) => {
          const selected = isSelected(filters, facet, value);

          return (
            <li key={value}>
              <Link
                className={`flex items-center justify-between gap-2 px-3 py-1 text-body-sm hover:bg-surface-container-low ${
                  selected ? 'bg-surface-container font-medium text-primary' : 'text-on-surface'
                }`}
                href={hrefFor(basePath, toggleFacet(filters, facet, value))}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {selected ? <Icon className="text-[14px]" name="check" /> : null}
                  <span className="truncate">{labels ? labels(value) : value}</span>
                </span>
                <span className="shrink-0 tabular-nums text-on-surface-variant">
                  {formatNumber(byValue.get(value) ?? 0)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function IssuesClient({ projectKey }: { projectKey: string }) {
  const searchParams = useSearchParams();
  const filters = parseFilters(toSearchParams(new URLSearchParams(searchParams.toString())));

  const project = useGetProjectByKeyQuery(projectKey);
  const result = useGetIssuesQuery(
    { projectId: project.data?.id ?? '', filters },
    { skip: !project.data },
  );

  if (project.isLoading) return <QueryLoading label="Loading project" />;
  if (project.error) return <QueryError error={project.error} onRetry={() => void project.refetch()} />;
  if (!project.data) notFound();

  const basePath = `/projects/${encodeURIComponent(project.data.key)}/issues`;

  if (result.isLoading) return <QueryLoading label="Loading issues" />;
  if (result.error) return <QueryError error={result.error} onRetry={() => void result.refetch()} />;
  if (!result.data) return <QueryLoading label="Loading issues" />;

  const page = result.data;
  const from = (page.page - 1) * ISSUES_PER_PAGE + 1;
  const to = Math.min(page.page * ISSUES_PER_PAGE, page.total);

  return (
    <main className="mx-auto flex max-w-[1500px] gap-3 px-4 py-3">
      <aside className="hidden w-[240px] shrink-0 lg:block">
        <Panel>
          <header className="flex items-center justify-between border-b border-outline-variant px-3 py-2">
            <span className="text-headline-sm">Filters</span>
            {hasAnyFilter(filters) ? (
              <Link className="text-body-sm text-primary hover:underline" href={hrefFor(basePath, clearedFilters())}>
                Clear
              </Link>
            ) : null}
          </header>

          <section className="border-b border-outline-variant py-2">
            <h2 className="px-3 pb-1 text-label-sm tracking-wide text-on-surface-variant uppercase">Period</h2>
            <ul>
              {[
                { label: 'All code', value: false },
                { label: 'New code', value: true },
              ].map((option) => (
                <li key={option.label}>
                  <Link
                    className={`block px-3 py-1 text-body-sm hover:bg-surface-container-low ${
                      filters.newCodeOnly === option.value
                        ? 'bg-surface-container font-medium text-primary'
                        : 'text-on-surface'
                    }`}
                    href={hrefFor(basePath, withNewCode(filters, option.value))}
                  >
                    {option.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <FacetGroup
            basePath={basePath}
            counts={page.facets.types}
            facet="type"
            filters={filters}
            labels={(value) => typeLabel(value as IssueType)}
            title="Type"
            values={ISSUE_TYPES}
          />
          <FacetGroup
            basePath={basePath}
            counts={page.facets.severities}
            facet="severity"
            filters={filters}
            title="Severity"
            values={SEVERITIES}
          />
          <FacetGroup
            basePath={basePath}
            counts={page.facets.statuses}
            facet="status"
            filters={filters}
            labels={(value) => STATUS_LABEL[value as IssueStatus]}
            title="Status"
            values={ISSUE_STATUSES}
          />
          <FacetGroup
            basePath={basePath}
            counts={page.facets.tags}
            facet="tag"
            filters={filters}
            title="Tag"
            values={page.facets.tags.map((tag) => tag.value)}
          />
        </Panel>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Panel className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="flex items-center gap-2">
            <span className="text-headline-sm">{formatNumber(page.total)} issues</span>
            <span className="text-body-sm text-on-surface-variant">
              {formatEffort(page.totalEffortMinutes)} of effort
            </span>
            {/* A refetch keeps the old rows on screen, so say it is happening. */}
            {result.isFetching ? <Icon className="animate-spin text-[14px] text-outline" name="progress_activity" /> : null}
          </span>
          {filters.file ? (
            <Link
              className="flex items-center gap-1 rounded-sm border border-outline-variant bg-surface-container px-2 py-px text-body-sm hover:border-outline"
              href={hrefFor(basePath, withoutFile(filters))}
            >
              <span className="font-mono text-code-body">{filters.file}</span>
              <Icon className="text-[14px]" name="close" />
            </Link>
          ) : null}
        </Panel>

        {page.issues.length === 0 ? (
          <Panel className="px-3 py-6 text-center text-body-md text-on-surface-variant">
            No issues match these filters.
          </Panel>
        ) : (
          <Panel>
            <ul>
              {page.issues.map((issue) => (
                <li className="border-b border-outline-variant last:border-b-0" key={issue.id}>
                  <article className="flex flex-col gap-1 px-3 py-2 hover:bg-surface-container-low">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-body-lg">{issue.message}</p>
                      <span className="shrink-0 text-body-sm text-on-surface-variant">
                        {formatEffort(issue.effortMinutes)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-on-surface-variant">
                      <SeverityChip severity={issue.severity} />
                      <TypeChip type={issue.type} />
                      <span className="font-mono text-code-body text-tertiary">
                        {issue.filePath}:{issue.startLine}
                      </span>
                      <span title={issue.ruleName ?? issue.ruleKey}>{issue.ruleKey}</span>
                      {issue.isNewCode ? (
                        <span className="rounded-sm border border-leak-border bg-leak px-1 py-px text-label-sm">
                          New code
                        </span>
                      ) : null}
                      {issue.status !== 'OPEN' ? <span>{STATUS_LABEL[issue.status]}</span> : null}
                      {issue.tags.map((tag) => (
                        <Link
                          className="rounded-sm bg-surface-container px-1 py-px text-label-sm hover:text-primary"
                          href={hrefFor(basePath, toggleFacet(filters, 'tag', tag))}
                          key={tag}
                        >
                          {tag}
                        </Link>
                      ))}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {page.pageCount > 1 ? (
          <nav className="flex items-center justify-between px-1 text-body-sm text-on-surface-variant">
            <span>
              {formatNumber(from)}–{formatNumber(to)} of {formatNumber(page.total)}
            </span>
            <span className="flex items-center gap-2">
              {page.page > 1 ? (
                <Link
                  className="text-primary hover:underline"
                  href={hrefFor(basePath, withPage(filters, page.page - 1))}
                >
                  Previous
                </Link>
              ) : null}
              {page.page < page.pageCount ? (
                <Link
                  className="text-primary hover:underline"
                  href={hrefFor(basePath, withPage(filters, page.page + 1))}
                >
                  Next
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </div>
    </main>
  );
}
