import type { SyntaxNode, Tree } from 'tree-sitter';
import { visitNodes } from './ast.js';
import { cognitiveComplexity, cyclomaticComplexity } from './complexity.js';

export interface LineCounts {
  /** Every line in the file, blank ones included. */
  lines: number;
  /** Lines carrying code. A line of code with a trailing comment counts here and as a comment line. */
  ncloc: number;
  commentLines: number;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/**
 * Counts lines by blanking out comment spans and seeing what is left, so a
 * trailing `// note` never costs a file its line of code and a banner comment
 * is never mistaken for one.
 */
export function countLines(lines: string[], tree: Tree): LineCounts {
  const stripped = [...lines];
  const commented = new Set<number>();

  visitNodes(tree.rootNode, (node: SyntaxNode) => {
    if (node.type !== 'comment') return;

    for (let row = node.startPosition.row; row <= node.endPosition.row; row += 1) {
      const line = stripped[row];
      if (line === undefined) continue;

      const from = row === node.startPosition.row ? node.startPosition.column : 0;
      const to = row === node.endPosition.row ? node.endPosition.column : line.length;
      const blanked = line.slice(0, from) + ' '.repeat(Math.max(0, to - from)) + line.slice(to);
      stripped[row] = blanked;

      // A comment line is one that says something; `*/` on its own does not.
      if (line.slice(from, to).replace(/[*/\s]/g, '').length > 0) commented.add(row);
    }
  });

  let ncloc = 0;
  for (const line of stripped) {
    if (!isBlank(line)) ncloc += 1;
  }

  return { lines: lines.length, ncloc, commentLines: commented.size };
}

export interface FileMetrics extends LineCounts {
  complexity: number;
  cognitiveComplexity: number;
}

export function computeFileMetrics(lines: string[], tree: Tree): FileMetrics {
  return {
    ...countLines(lines, tree),
    complexity: cyclomaticComplexity(tree.rootNode),
    cognitiveComplexity: cognitiveComplexity(tree.rootNode),
  };
}

/** `lines` is the denominator SonarQube uses for comment density, not `ncloc`. */
export function commentDensity(commentLines: number, ncloc: number): number {
  const total = commentLines + ncloc;
  return total === 0 ? 0 : (commentLines / total) * 100;
}
