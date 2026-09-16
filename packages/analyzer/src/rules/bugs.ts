import type { SyntaxNode } from 'tree-sitter';
import { visitNodes } from '../ast.js';
import type { Rule } from '../types.js';
import { ALL_LANGUAGES, normalizedText, unwrap } from './shared.js';

const identicalBranches: Rule = {
  key: 'ts:no-identical-branches',
  name: 'Conditional branches should not have the same implementation',
  type: 'BUG',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['suspicious'],
  description:
    'When both branches do the same thing the condition is either pointless or one branch was never finished. Either way the code does not say what it means.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'if_statement') return;

      const consequence = node.childForFieldName('consequence');
      const alternative = node.childForFieldName('alternative')?.namedChildren[0];
      if (!consequence || !alternative) return;
      // An `else if` chain is a different shape and is checked on its own.
      if (alternative.type === 'if_statement') return;
      if (normalizedText(consequence) !== normalizedText(alternative)) return;

      report({ node, message: 'This branch is identical to the one on the other side of the condition.' });
    });
  },
};

const constantCondition: Rule = {
  key: 'ts:no-constant-condition',
  name: 'Conditions should not always evaluate the same way',
  type: 'BUG',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['suspicious', 'cwe-570'],
  description: 'A condition that cannot change makes one branch dead code, usually left behind by debugging.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      const condition = node.childForFieldName('condition');
      if (!condition) return;

      const literal = unwrap(condition);
      if (literal.type !== 'true' && literal.type !== 'false') return;
      // `while (true)` with a break inside is how you write a loop.
      if (literal.type === 'true' && (node.type === 'while_statement' || node.type === 'do_statement')) return;
      if (node.type === 'for_statement') return;

      report({ node: condition, message: `This condition is always ${literal.type}.` });
    });
  },
};

const duplicateCase: Rule = {
  key: 'ts:no-duplicate-case',
  name: 'Switch cases should not be duplicated',
  type: 'BUG',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['suspicious', 'cwe-1023'],
  description: 'Only the first of two identical cases can ever run; the second is dead code.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'switch_body') return;

      const seen = new Set<string>();
      for (const child of node.namedChildren) {
        if (child.type !== 'switch_case') continue;

        const value = child.childForFieldName('value');
        if (!value) continue;

        const key = normalizedText(value);
        if (seen.has(key)) {
          report({ node: child, message: `This case duplicates an earlier "case ${key}".` });
        }
        seen.add(key);
      }
    });
  },
};

const IDENTICAL_OPERANDS = new Set(['===', '==', '<', '>', '<=', '>=', '&&', '||']);

const selfComparison: Rule = {
  key: 'ts:no-identical-operands',
  name: 'Identical expressions should not be used on both sides of an operator',
  type: 'BUG',
  severity: 'MAJOR',
  effortMinutes: 5,
  tags: ['suspicious', 'cwe-571'],
  description:
    'Comparing a value with itself always gives the same answer. One side is nearly always a typo for something else.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'binary_expression') return;

      const operator = node.child(1)?.type;
      if (!operator || !IDENTICAL_OPERANDS.has(operator)) return;

      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (!left || !right) return;
      if (normalizedText(left) !== normalizedText(right)) return;

      report({ node, message: `Both operands of this "${operator}" are the same expression.` });
    });
  },
};

const TERMINATING = new Set(['return_statement', 'throw_statement', 'break_statement', 'continue_statement']);
/** Declarations hoist, so they still mean something after a return. */
const HOISTED = new Set(['function_declaration', 'generator_function_declaration', 'class_declaration', 'comment']);

function reportUnreachable(block: SyntaxNode, report: (node: SyntaxNode) => void): void {
  const statements = block.namedChildren;

  for (let i = 0; i < statements.length; i += 1) {
    if (!TERMINATING.has(statements[i]!.type)) continue;

    const next = statements.slice(i + 1).find((statement) => !HOISTED.has(statement.type));
    if (next) report(next);
    return;
  }
}

const unreachableCode: Rule = {
  key: 'ts:no-unreachable-code',
  name: 'Jump statements should not be followed by other statements',
  type: 'BUG',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['unused', 'cwe-561'],
  description: 'Code after a return, throw, break or continue never runs — either the jump or the code is wrong.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'statement_block' && node.type !== 'switch_case') return;

      reportUnreachable(node, (unreachable) => {
        report({ node: unreachable, message: 'This statement cannot be reached.' });
      });
    });
  },
};

export const BUG_RULES: Rule[] = [
  identicalBranches,
  constantCondition,
  duplicateCase,
  selfComparison,
  unreachableCode,
];
