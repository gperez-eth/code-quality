import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * A test report the analyzer read from disk rather than produced itself. See
 * ADR-0005: coverage means running the customer's own test suite, which the
 * hosted worker can never do, so the only way it reaches a scan is a file the
 * CI lane hands in.
 */
export interface ParsedLcovFile {
  /** As written in the lcov file, before normalisation against `file.path`. */
  path: string;
  linesFound: number;
  linesHit: number;
  /** 1-indexed line number to execution count, from DA records. */
  hits: Map<number, number>;
}

/**
 * Parses the handful of lcov records this analyzer cares about: `SF` (which
 * file a block of `DA` records belongs to), `DA` (a line and how many times
 * it ran), `LF`/`LH` (the file's own found/hit summary) and `end_of_record`
 * (where one file's block ends). Everything else — `TN`, the `FN`/`FNDA`/
 * `FNF`/`FNH` function-coverage records, the `BRDA`/`BRF`/`BRH` branch-coverage
 * records — is real lcov, just not a measure this analyzer reports yet, so it
 * is skipped rather than rejected.
 *
 * A real lcov.info is rarely perfectly formed: a line that does not parse
 * costs only itself, never the rest of the file, so one bad record from a
 * flaky coverage tool does not zero out everything that follows it.
 */
export function parseLcov(content: string): ParsedLcovFile[] {
  const files: ParsedLcovFile[] = [];
  let current: ParsedLcovFile | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    if (line.startsWith('SF:')) {
      // A new SF before the previous file's end_of_record showed up: start
      // the next file's record rather than losing the one still open.
      if (current) files.push(current);
      current = { path: line.slice(3).trim(), linesFound: 0, linesHit: 0, hits: new Map() };
      continue;
    }

    if (!current) continue; // a record fragment before its SF: line means nothing

    if (line === 'end_of_record') {
      files.push(current);
      current = null;
      continue;
    }

    if (line.startsWith('DA:')) {
      const [lineNumber, hitCount] = line.slice(3).split(',');
      const parsedLine = Number(lineNumber);
      const parsedHits = Number(hitCount);
      if (Number.isInteger(parsedLine) && parsedLine >= 1 && Number.isFinite(parsedHits)) {
        // A line reported twice in one record is the exception, not the
        // rule, but where it happens "ever hit" is the more useful reading
        // than "hit this many times added together".
        current.hits.set(parsedLine, Math.max(current.hits.get(parsedLine) ?? 0, parsedHits));
      }
      continue;
    }

    if (line.startsWith('LF:')) {
      const value = Number(line.slice(3));
      if (Number.isFinite(value)) current.linesFound = value;
      continue;
    }

    if (line.startsWith('LH:')) {
      const value = Number(line.slice(3));
      if (Number.isFinite(value)) current.linesHit = value;
      continue;
    }

    // TN, FN, FNDA, FNF, FNH, BRDA, BRF, BRH and anything future coverage
    // tools add land here and are ignored.
  }

  // A file whose block never closed (a truncated write, an interrupted
  // coverage run) still has real DA data worth keeping.
  if (current) files.push(current);

  return files;
}

export interface FileCoverage {
  path: string;
  linesFound: number;
  linesHit: number;
  /** 1-indexed lines with zero hits, best-effort from the DA records seen. */
  uncoveredLines: number[];
}

export interface CoverageReport {
  byFile: Map<string, FileCoverage>;
  linesFound: number;
  linesHit: number;
}

/** The part of a `FileReport` matching needs — kept narrow so this module does not have to import the analyzer's file shape, the same way `duplication.ts` defines its own input rather than depending on it. */
export interface CoverageTarget {
  path: string;
}

function normalizePath(rawPath: string, root: string): string {
  const platformPath = rawPath.split(/[\\/]+/).join(sep);
  const absolute = isAbsolute(platformPath) ? platformPath : resolve(root, platformPath);
  return relative(root, absolute).split(sep).join('/');
}

/**
 * Matches parsed lcov records against the files this scan actually analysed.
 * Paths in an lcov.info are usually absolute, or relative to wherever the
 * coverage tool ran from; both are normalised here to the same relative,
 * forward-slashed form `file.path` uses. A path that does not land on one of
 * `files` is dropped rather than guessed at — coverage for a file we did not
 * analyse is not a measurement of anything.
 */
export function matchCoverage(
  parsed: ParsedLcovFile[],
  root: string,
  files: readonly CoverageTarget[],
): CoverageReport {
  const known = new Set(files.map((file) => file.path));
  const byFile = new Map<string, FileCoverage>();

  for (const entry of parsed) {
    const path = normalizePath(entry.path, root);
    if (!known.has(path)) continue;

    const hits = [...entry.hits.values()];
    const linesFound = entry.linesFound > 0 ? entry.linesFound : entry.hits.size;
    const linesHit = entry.linesHit > 0 ? entry.linesHit : hits.filter((count) => count > 0).length;
    const uncoveredLines = [...entry.hits.entries()]
      .filter(([, count]) => count === 0)
      .map(([lineNumber]) => lineNumber)
      .sort((a, b) => a - b);

    // A later record for a path already seen — a merged lcov.info from more
    // than one test run — replaces rather than combines. Merging tallies
    // across runs is not something a single CI job's report needs.
    byFile.set(path, { path, linesFound, linesHit, uncoveredLines });
  }

  let linesFound = 0;
  let linesHit = 0;
  for (const file of byFile.values()) {
    linesFound += file.linesFound;
    linesHit += file.linesHit;
  }

  return { byFile, linesFound, linesHit };
}

export function coveragePercent(linesHit: number, linesFound: number): number {
  return linesFound === 0 ? 0 : (linesHit / linesFound) * 100;
}

/**
 * Reads the lcov file the `--coverage` flag points at. A missing or
 * unreadable report fails loudly rather than being treated as "no coverage
 * supplied": a CI job that believes it published coverage and did not is
 * worse than one that stops.
 */
export async function readCoverageFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Could not read coverage report at ${path}: ${(error as Error).message}`);
  }
}
