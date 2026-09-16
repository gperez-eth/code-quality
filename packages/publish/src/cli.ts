#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { isScanReport, ratingValue, SONAR_WAY_GATE } from '@code-quality/core';

const USAGE = `code-quality-import — publish a scan report to the dashboard

Usage
  code-quality-import <report.json> [options]

Options
  --org <slug>      Organisation that owns the project (or CODE_QUALITY_ORG)
  --project <key>   Project key used in URLs (default: the scanned folder name)
  --name <name>     Human-readable project name (default: the key)
  --repo <url>      Repository URL shown on the project
  --branch <name>   Branch the analysis belongs to (default: main)
  --commit <sha>    Commit the analysis was run against
  --version <ver>   Version label for the analysis
  -h, --help        Show this help

Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment. The
service role key is a secret: give it to CI as a masked variable, never to a
browser.
`;

interface ImportOptions {
  report: string;
  org?: string;
  project?: string;
  name?: string;
  repo?: string;
  branch?: string;
  commit?: string;
  version?: string;
}

function parseArgs(argv: string[]): ImportOptions | undefined {
  const options: Partial<ImportOptions> = {};

  const valueFor = (flag: string, value: string | undefined): string => {
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;

    switch (arg) {
      case '-h':
      case '--help':
        return undefined;
      case '--org':
        options.org = valueFor(arg, argv[++i]);
        break;
      case '--project':
        options.project = valueFor(arg, argv[++i]);
        break;
      case '--name':
        options.name = valueFor(arg, argv[++i]);
        break;
      case '--repo':
        options.repo = valueFor(arg, argv[++i]);
        break;
      case '--branch':
        options.branch = valueFor(arg, argv[++i]);
        break;
      case '--commit':
        options.commit = valueFor(arg, argv[++i]);
        break;
      case '--version':
        options.version = valueFor(arg, argv[++i]);
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (options.report) throw new Error(`Unexpected argument: ${arg}`);
        options.report = resolve(arg);
    }
  }

  if (!options.report) throw new Error('No report file given');
  return options as ImportOptions;
}

/** "C:\\src\\my-app" -> "my-app": a sensible key when none is given. */
function keyFromRoot(root: string): string {
  const name = basename(root.replace(/[\\/]+$/, ''));
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-') || 'project';
}

/**
 * The built-in gate as the import function wants it: thresholds numeric,
 * ratings already converted. Passed in rather than duplicated in SQL, so
 * SONAR_WAY_GATE stays the single definition.
 */
function defaultGatePayload() {
  return {
    name: SONAR_WAY_GATE.name,
    conditions: SONAR_WAY_GATE.conditions.map((condition) => ({
      metric: condition.metric,
      operator: condition.operator,
      threshold: typeof condition.threshold === 'number' ? condition.threshold : ratingValue(condition.threshold),
      scope: condition.scope,
    })),
  };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(USAGE);
    return 0;
  }

  const report: unknown = JSON.parse(await readFile(options.report, 'utf8'));
  if (!isScanReport(report)) {
    throw new Error(`${options.report} is not a scan report. Produce one with: code-quality-scan <path> --json <file>`);
  }

  const url = process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service role key belongs in CI secrets.');
  }

  const slug = options.org ?? process.env['CODE_QUALITY_ORG'];
  if (!slug) {
    throw new Error('Which organisation is this for? Pass --org <slug>, or set CODE_QUALITY_ORG.');
  }

  // No session to persist and nothing to refresh: this runs once and exits.
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Resolved before anything is written: publishing into the wrong tenant, or
  // into none, is worse than failing.
  const { data: organization, error: lookupError } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (lookupError) throw new Error(`Could not look up the organisation: ${lookupError.message}`);
  if (!organization) throw new Error(`No organisation with slug "${slug}"`);

  const projectKey = options.project ?? keyFromRoot(report.root);

  const { data, error } = await supabase.rpc('import_analysis', {
    p_organization_id: organization.id,
    p_project_key: projectKey,
    p_report: report,
    p_default_gate: defaultGatePayload(),
    ...(options.name ? { p_project_name: options.name } : {}),
    ...(options.repo ? { p_repository_url: options.repo } : {}),
    ...(options.branch ? { p_branch: options.branch } : {}),
    ...(options.commit ? { p_commit_sha: options.commit } : {}),
    ...(options.version ? { p_version: options.version } : {}),
    p_trigger: 'CLI',
  });

  if (error) throw new Error(`The analysis could not be published: ${error.message}`);

  const result = (data ?? {}) as Record<string, unknown>;
  const count = (name: string): number => (typeof result[name] === 'number' ? (result[name] as number) : 0);

  const changes = [
    `${count('newIssues')} new`,
    `${count('reopenedIssues')} reopened`,
    `${count('closedIssues')} closed`,
    `${count('unchangedIssues')} unchanged`,
  ].join(', ');

  console.log(`Imported analysis ${String(result['analysisId'])} into ${slug}/${projectKey}`);
  console.log(`  Quality gate: ${report.gate.status} (${report.gate.name})`);
  console.log(`  Issues: ${changes}`);
  if (!result['baselineAnalysisId']) console.log('  First analysis: the whole codebase counts as new code.');

  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`code-quality-import: ${(error as Error).message}`);
    process.exitCode = 1;
  },
);
