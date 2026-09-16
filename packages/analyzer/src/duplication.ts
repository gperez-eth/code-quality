import { createHash } from 'node:crypto';

/** How many significant lines have to line up before it counts as duplication. */
const DEFAULT_BLOCK_LINES = 10;

/** Lines that are nothing but punctuation match everywhere and mean nothing. */
const TRIVIAL_LINE = /^[\s{}()[\];,]*$/;

export interface DuplicationInput {
  path: string;
  lines: string[];
}

export interface DuplicationOptions {
  blockLines?: number;
}

export interface FileDuplication {
  path: string;
  duplicatedLines: number;
  /** Merged 1-indexed line spans, in file order. */
  blocks: Array<{ startLine: number; endLine: number }>;
}

export interface DuplicationReport {
  duplicatedBlocks: number;
  duplicatedLines: number;
  byFile: Map<string, FileDuplication>;
}

interface Window {
  file: string;
  /** 0-indexed, inclusive. */
  start: number;
  end: number;
}

function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Line numbers survive normalisation so findings point at the real file. */
function significantLines(lines: string[]): Array<{ index: number; text: string }> {
  const significant: Array<{ index: number; text: string }> = [];

  lines.forEach((line, index) => {
    const text = normalize(line);
    if (text.length === 0 || TRIVIAL_LINE.test(text)) return;
    significant.push({ index, text });
  });

  return significant;
}

function merge(windows: Window[]): Array<{ startLine: number; endLine: number }> {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: Array<{ startLine: number; endLine: number }> = [];

  for (const window of sorted) {
    const last = merged[merged.length - 1];
    // Touching spans are one duplicated region, not two.
    if (last && window.start <= last.endLine) {
      last.endLine = Math.max(last.endLine, window.end + 1);
      continue;
    }
    merged.push({ startLine: window.start + 1, endLine: window.end + 1 });
  }

  return merged;
}

/**
 * Finds blocks of identical code across the whole scan. Comparison is on
 * whitespace-normalised lines rather than tokens: cheaper than a real token
 * index, and it still ignores reformatting, which is what matters in practice.
 */
export function detectDuplication(files: DuplicationInput[], options: DuplicationOptions = {}): DuplicationReport {
  const blockLines = options.blockLines ?? DEFAULT_BLOCK_LINES;
  const index = new Map<string, Window[]>();

  for (const file of files) {
    const significant = significantLines(file.lines);

    for (let i = 0; i + blockLines <= significant.length; i += 1) {
      const block = significant.slice(i, i + blockLines);
      const hash = createHash('sha1')
        .update(block.map((line) => line.text).join('\n'))
        .digest('hex');

      const window: Window = { file: file.path, start: block[0]!.index, end: block[block.length - 1]!.index };
      const existing = index.get(hash);
      if (existing) existing.push(window);
      else index.set(hash, [window]);
    }
  }

  const duplicatedByFile = new Map<string, Window[]>();

  for (const windows of index.values()) {
    if (windows.length < 2) continue;

    for (const window of windows) {
      const existing = duplicatedByFile.get(window.file);
      if (existing) existing.push(window);
      else duplicatedByFile.set(window.file, [window]);
    }
  }

  const byFile = new Map<string, FileDuplication>();
  let duplicatedBlocks = 0;
  let duplicatedLines = 0;

  for (const [path, windows] of duplicatedByFile) {
    const blocks = merge(windows);
    const lines = blocks.reduce((total, block) => total + (block.endLine - block.startLine + 1), 0);

    byFile.set(path, { path, duplicatedLines: lines, blocks });
    duplicatedBlocks += blocks.length;
    duplicatedLines += lines;
  }

  return { duplicatedBlocks, duplicatedLines, byFile };
}

export function duplicationDensity(duplicatedLines: number, totalLines: number): number {
  return totalLines === 0 ? 0 : (duplicatedLines / totalLines) * 100;
}
