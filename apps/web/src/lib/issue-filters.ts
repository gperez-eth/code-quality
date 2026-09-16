import { ISSUE_STATUSES, ISSUE_TYPES, type IssueStatus, type IssueType, SEVERITIES, type Severity } from '@code-quality/core';
import type { IssueFilters } from './api';

export type SearchParams = Record<string, string | string[] | undefined>;

/** Accepts `?type=BUG&type=CODE_SMELL` and `?type=BUG,CODE_SMELL` alike. */
function readList(value: string | string[] | undefined): string[] {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return raw.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean);
}

function readOne(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFilters(searchParams: SearchParams): IssueFilters {
  const types = readList(searchParams['type']).filter((value): value is IssueType =>
    (ISSUE_TYPES as readonly string[]).includes(value),
  );
  const severities = readList(searchParams['severity']).filter((value): value is Severity =>
    (SEVERITIES as readonly string[]).includes(value),
  );
  const statuses = readList(searchParams['status']).filter((value): value is IssueStatus =>
    (ISSUE_STATUSES as readonly string[]).includes(value),
  );

  const page = Number(readOne(searchParams['page']) ?? '1');
  const file = readOne(searchParams['file']);

  return {
    types,
    severities,
    statuses,
    tags: readList(searchParams['tag']),
    ...(file ? { file } : {}),
    newCodeOnly: readOne(searchParams['newCode']) === '1',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export type FacetName = 'type' | 'severity' | 'status' | 'tag';

const FACET_FIELD: Record<FacetName, keyof Pick<IssueFilters, 'types' | 'severities' | 'statuses' | 'tags'>> = {
  type: 'types',
  severity: 'severities',
  status: 'statuses',
  tag: 'tags',
};

function toQuery(filters: IssueFilters): URLSearchParams {
  const query = new URLSearchParams();

  for (const value of filters.types) query.append('type', value);
  for (const value of filters.severities) query.append('severity', value);
  for (const value of filters.statuses) query.append('status', value);
  for (const value of filters.tags) query.append('tag', value);
  if (filters.file) query.set('file', filters.file);
  if (filters.newCodeOnly) query.set('newCode', '1');
  // Any change of filter invalidates the page number, so it is never carried.
  if (filters.page > 1) query.set('page', String(filters.page));

  return query;
}

export function hrefFor(basePath: string, filters: IssueFilters): string {
  const query = toQuery(filters).toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Selecting a value that is already selected clears it: facets are toggles. */
export function toggleFacet(filters: IssueFilters, facet: FacetName, value: string): IssueFilters {
  const field = FACET_FIELD[facet];
  const current = filters[field] as string[];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];

  return { ...filters, [field]: next, page: 1 };
}

export function isSelected(filters: IssueFilters, facet: FacetName, value: string): boolean {
  return (filters[FACET_FIELD[facet]] as string[]).includes(value);
}

export function withoutFile(filters: IssueFilters): IssueFilters {
  const { file: _file, ...rest } = filters;
  return { ...rest, page: 1 };
}

export function withNewCode(filters: IssueFilters, newCodeOnly: boolean): IssueFilters {
  return { ...filters, newCodeOnly, page: 1 };
}

export function withPage(filters: IssueFilters, page: number): IssueFilters {
  return { ...filters, page };
}

export function hasAnyFilter(filters: IssueFilters): boolean {
  return (
    filters.types.length > 0 ||
    filters.severities.length > 0 ||
    filters.statuses.length > 0 ||
    filters.tags.length > 0 ||
    filters.newCodeOnly ||
    Boolean(filters.file)
  );
}

export function clearedFilters(): IssueFilters {
  return { types: [], severities: [], statuses: [], tags: [], newCodeOnly: false, page: 1 };
}
