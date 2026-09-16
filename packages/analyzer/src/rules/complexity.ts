import type { SyntaxNode } from 'tree-sitter';
import type { TextRange } from '@code-quality/core';
import { functionName, isFunctionNode, LOOP_NODES, rangeOf, visitNodes } from '../ast.js';
import { cognitiveComplexity, cyclomaticComplexity } from '../complexity.js';
import type { Rule } from '../types.js';
import { ALL_LANGUAGES } from './shared.js';

const MAX_CYCLOMATIC = 15;
const MAX_COGNITIVE = 15;
const MAX_PARAMETERS = 7;
const MAX_NESTING = 4;

/**
 * Anchors a finding to the signature rather than the whole body: a 200-line
 * function highlighted end to end tells the reader nothing.
 */
function signatureRange(node: SyntaxNode): TextRange {
  const name = node.childForFieldName('name');
  if (name) return rangeOf(name);

  const { row, column } = node.startPosition;
  return { startLine: row + 1, endLine: row + 1, startColumn: column, endColumn: column + 1 };
}

/** Walks every function in the file, outermost first. */
function forEachFunction(root: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visitNodes(root, (node) => {
    if (isFunctionNode(node)) visit(node);
  });
}

const functionComplexity: Rule = {
  key: 'ts:function-complexity',
  name: 'Functions should not be too complex',
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 30,
  tags: ['brain-overload'],
  description:
    'Cyclomatic complexity counts the paths through a function, which is also the number of tests needed to cover it.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    forEachFunction(file.tree.rootNode, (node) => {
      const complexity = cyclomaticComplexity(node, { includeNested: false });
      if (complexity <= MAX_CYCLOMATIC) return;

      report({
        range: signatureRange(node),
        message: `Function "${functionName(node)}" has a complexity of ${complexity}, over the ${MAX_CYCLOMATIC} allowed.`,
      });
    });
  },
};

const functionCognitiveComplexity: Rule = {
  key: 'ts:cognitive-complexity',
  name: 'Cognitive complexity of functions should not be too high',
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 30,
  tags: ['brain-overload'],
  description:
    'Unlike cyclomatic complexity, this measures how hard the function is to follow: nesting costs more than breadth.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    forEachFunction(file.tree.rootNode, (node) => {
      const complexity = cognitiveComplexity(node, { includeNested: false });
      if (complexity <= MAX_COGNITIVE) return;

      report({
        range: signatureRange(node),
        message: `Refactor "${functionName(node)}": its cognitive complexity of ${complexity} is over the ${MAX_COGNITIVE} allowed.`,
      });
    });
  },
};

const tooManyParameters: Rule = {
  key: 'ts:too-many-parameters',
  name: 'Functions should not have too many parameters',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  effortMinutes: 20,
  tags: ['brain-overload', 'design'],
  description: 'A long parameter list is a call site nobody can read and an object waiting to be extracted.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    forEachFunction(file.tree.rootNode, (node) => {
      const parameters = node.childForFieldName('parameters')?.namedChildren.length ?? 0;
      if (parameters <= MAX_PARAMETERS) return;

      report({
        range: signatureRange(node),
        message: `Function "${functionName(node)}" takes ${parameters} parameters, over the ${MAX_PARAMETERS} allowed.`,
      });
    });
  },
};

/** The structures that cost a reader a level of indentation. */
const NESTING_NODES = new Set(['if_statement', 'switch_statement', 'try_statement', ...LOOP_NODES]);

const nestingDepth: Rule = {
  key: 'ts:nesting-depth',
  name: 'Control flow statements should not be nested too deeply',
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 20,
  tags: ['brain-overload'],
  description:
    'Past a few levels the reader has to hold every enclosing condition in their head at once. Extract a function or return early.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    const walk = (node: SyntaxNode, depth: number): void => {
      // `else if` reads as one chain, so it does not count as another level.
      const chained = node.type === 'if_statement' && node.parent?.type === 'else_clause';
      const nested = NESTING_NODES.has(node.type) && !chained;
      const next = nested ? depth + 1 : depth;

      if (nested && next > MAX_NESTING) {
        report({
          range: signatureRange(node),
          message: `Refactor this code: it is nested ${next} levels deep, over the ${MAX_NESTING} allowed.`,
        });
        return;
      }

      for (const child of node.namedChildren) {
        // Each function body starts the count again.
        walk(child, isFunctionNode(child) ? 0 : next);
      }
    };

    walk(file.tree.rootNode, 0);
  },
};

export const COMPLEXITY_RULES: Rule[] = [
  functionComplexity,
  functionCognitiveComplexity,
  tooManyParameters,
  nestingDepth,
];
