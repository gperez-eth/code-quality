import type { SyntaxNode } from 'tree-sitter';
import { isFunctionNode, LOOP_NODES, logicalOperator, visitNodes } from './ast.js';

/** Constructs that split the flow of control and so add a path to cover. */
const DECISION_NODES = new Set([
  'if_statement',
  'switch_case',
  'catch_clause',
  'ternary_expression',
  ...LOOP_NODES,
]);

function isDecisionPoint(node: SyntaxNode): boolean {
  return DECISION_NODES.has(node.type) || logicalOperator(node) !== undefined;
}

export interface ComplexityOptions {
  /**
   * Whether functions declared inside this one count towards its score.
   * File-level metrics want everything; the rules do not, or a `describe()`
   * block would be blamed for the complexity of every test inside it.
   */
  includeNested?: boolean;
}

/**
 * Cyclomatic complexity: one path to begin with, plus one per decision point.
 * Every function counts as its own entry point, so a file's complexity is the
 * sum of its functions' plus any branching at the top level.
 */
export function cyclomaticComplexity(node: SyntaxNode, options: ComplexityOptions = {}): number {
  const includeNested = options.includeNested ?? true;
  let complexity = isFunctionNode(node) ? 1 : 0;

  visitNodes(node, (current) => {
    if (current === node) return;
    if (isFunctionNode(current)) {
      if (!includeNested) return false;
      complexity += 1;
      return;
    }
    if (isDecisionPoint(current)) complexity += 1;
  });

  return complexity;
}

/**
 * Cognitive complexity — how hard the code is to *read*, as opposed to how many
 * paths it has. Nesting is what hurts, so each structure scores one point plus
 * the depth it sits at, while `else` and boolean sequences score flat.
 *
 * This follows the shape of the published metric rather than its letter: the
 * increments and the nesting rules are here, recursion detection is not.
 */
export function cognitiveComplexity(root: SyntaxNode, options: ComplexityOptions = {}): number {
  const includeNested = options.includeNested ?? true;
  let score = 0;

  function walkChildren(node: SyntaxNode, nesting: number): void {
    for (const child of node.namedChildren) walk(child, nesting);
  }

  /** Counts the `if` itself, its body one level deeper, then its `else`. */
  function walkIf(node: SyntaxNode, nesting: number, chained: boolean): void {
    // An `else if` is one flat point: the reader follows a single chain.
    score += chained ? 1 : 1 + nesting;

    const condition = node.childForFieldName('condition');
    if (condition) walk(condition, nesting);

    const consequence = node.childForFieldName('consequence');
    if (consequence) walk(consequence, nesting + 1);

    const alternative = node.childForFieldName('alternative');
    if (!alternative) return;

    const branch = alternative.namedChildren[0];
    if (branch?.type === 'if_statement') {
      walkIf(branch, nesting, true);
      return;
    }
    score += 1;
    if (branch) walk(branch, nesting + 1);
  }

  /**
   * `a && b && c` is one point, `a && b || c` is two: what costs the reader is
   * switching operator, not repeating one.
   */
  function countLogicalSequence(node: SyntaxNode, nesting: number): void {
    const operators: string[] = [];

    const flatten = (current: SyntaxNode): void => {
      const operator = logicalOperator(current);
      if (!operator) {
        walk(current, nesting);
        return;
      }
      const left = current.childForFieldName('left');
      const right = current.childForFieldName('right');
      if (left) flatten(left);
      operators.push(operator);
      if (right) flatten(right);
    };

    flatten(node);

    let runs = 0;
    let previous: string | undefined;
    for (const operator of operators) {
      if (operator !== previous) runs += 1;
      previous = operator;
    }
    score += runs;
  }

  function walk(node: SyntaxNode, nesting: number): void {
    if (node.type === 'if_statement') {
      walkIf(node, nesting, false);
      return;
    }

    if (LOOP_NODES.has(node.type) || node.type === 'catch_clause' || node.type === 'switch_statement') {
      score += 1 + nesting;
      walkChildren(node, nesting + 1);
      return;
    }

    if (node.type === 'ternary_expression') {
      score += 1 + nesting;
      walkChildren(node, nesting + 1);
      return;
    }

    // A jump that names a label makes the reader look elsewhere.
    if (
      (node.type === 'break_statement' || node.type === 'continue_statement') &&
      node.namedChildren.some((child) => child.type === 'statement_identifier')
    ) {
      score += 1;
      return;
    }

    if (logicalOperator(node)) {
      countLogicalSequence(node, nesting);
      return;
    }

    // A nested function's body is read inside everything around it.
    if (isFunctionNode(node) && node !== root) {
      if (includeNested) walkChildren(node, nesting + 1);
      return;
    }

    walkChildren(node, nesting);
  }

  walkChildren(root, 0);
  return score;
}
