import type { SyntaxNode } from 'tree-sitter';
import type { TextRange } from '@code-quality/core';

/** Every node shape that introduces its own scope and counts as a function. */
export const FUNCTION_NODES = new Set([
  'function_declaration',
  'function_expression',
  'generator_function',
  'generator_function_declaration',
  'arrow_function',
  'method_definition',
]);

export const LOOP_NODES = new Set([
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'while_statement',
  'do_statement',
]);

export const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);

export function isFunctionNode(node: SyntaxNode): boolean {
  return FUNCTION_NODES.has(node.type);
}

/** The `&&`, `||` or `??` of a logical expression; undefined for anything else. */
export function logicalOperator(node: SyntaxNode): string | undefined {
  if (node.type !== 'binary_expression') return undefined;
  const operator = node.child(1)?.type;
  return operator && LOGICAL_OPERATORS.has(operator) ? operator : undefined;
}

/**
 * Depth-first over named nodes. Returning `false` from `visit` prunes that
 * subtree, which rules use to avoid reporting twice on nested constructs.
 */
export function visitNodes(root: SyntaxNode, visit: (node: SyntaxNode) => boolean | void): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visit(node) === false) continue;
    const children = node.namedChildren;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }
}

/** Tree-sitter positions are 0-indexed; issue ranges count lines from 1. */
export function rangeOf(node: SyntaxNode): TextRange {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  };
}

/** The name a reader would use for a function, for issue messages. */
export function functionName(node: SyntaxNode): string {
  const named = node.childForFieldName('name')?.text;
  if (named) return named;

  // `const parse = () => {}` and `parse: function () {}` read as "parse".
  const parent = node.parent;
  if (parent?.type === 'variable_declarator' || parent?.type === 'pair') {
    const key = parent.childForFieldName('name')?.text ?? parent.childForFieldName('key')?.text;
    if (key) return key;
  }
  if (parent?.type === 'assignment_expression') {
    const left = parent.childForFieldName('left')?.text;
    if (left) return left;
  }
  return '<anonymous>';
}

/** The nearest enclosing function, used to attribute a finding to its owner. */
export function enclosingFunction(node: SyntaxNode): SyntaxNode | undefined {
  let current = node.parent;
  while (current) {
    if (isFunctionNode(current)) return current;
    current = current.parent;
  }
  return undefined;
}
