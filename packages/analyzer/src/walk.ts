import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { languageForPath } from './languages.js';

/** Directories never worth analysing, skipped before any I/O on their contents. */
const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  'vendor',
  '__pycache__',
]);

export interface WalkOptions {
  ignore?: Set<string>;
  /** Files above this size are skipped: usually generated or minified. */
  maxBytes?: number;
}

export interface DiscoveredFile {
  path: string;
  absolutePath: string;
  text: string;
}

export async function* walkSourceFiles(root: string, options: WalkOptions = {}): AsyncGenerator<DiscoveredFile> {
  const ignore = options.ignore ?? DEFAULT_IGNORES;
  const maxBytes = options.maxBytes ?? 1_000_000;

  async function* visit(dir: string): AsyncGenerator<DiscoveredFile> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // A directory we cannot read is a directory with nothing to analyse:
      // permissions, a broken symlink, a race with something deleting it. The
      // generator yields nothing for it and the walk carries on.
      return;
    }

    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const absolutePath = join(dir, entry.name);

      if (entry.isDirectory()) {
        yield* visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!languageForPath(entry.name)) continue;

      const info = await stat(absolutePath);
      if (info.size > maxBytes) continue;

      yield {
        path: relative(root, absolutePath).split(sep).join('/'),
        absolutePath,
        text: await readFile(absolutePath, 'utf8'),
      };
    }
  }

  yield* visit(root);
}
