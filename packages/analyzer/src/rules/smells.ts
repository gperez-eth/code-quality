import type { SyntaxNode } from 'tree-sitter';
import { visitNodes } from '../ast.js';
import type { Rule } from '../types.js';
import { ALL_LANGUAGES, calleeText, staticStringValue, TYPESCRIPT_ONLY } from './shared.js';

const ignoredException: Rule = {
  key: 'ts:no-ignored-exception',
  name: 'Exceptions should not be ignored',
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 15,
  tags: ['error-handling', 'cwe-391'],
  description:
    'An empty catch swallows the failure and everything after it runs on bad state. Handle it, rethrow it, or leave a comment saying why neither is needed.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'catch_clause') return;

      const body = node.childForFieldName('body');
      // A comment counts as a named child, so a documented catch is left alone.
      if (!body || body.namedChildren.length > 0) return;

      report({ node, message: 'Handle this exception or explain in a comment why it can be ignored.' });
    });
  },
};

const TODO_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;

// Not a marker, but the same admission — and the phrasing generated code
// reaches for when it leaves a stub behind looking finished.
const IMPLEMENT_THIS = /implement this/i;

const todoComment: Rule = {
  key: 'ts:no-todo-comment',
  name: 'Track uses of "TODO" tags',
  type: 'CODE_SMELL',
  severity: 'INFO',
  effortMinutes: 0,
  tags: ['convention'],
  description: 'A TODO is a note that the code is knowingly incomplete. Worth counting so the pile stays visible.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'comment') return;

      const marker = TODO_MARKER.exec(node.text)?.[1] ?? (IMPLEMENT_THIS.test(node.text) ? 'implement this' : undefined);
      if (!marker) return;

      report({ node, message: `Complete the task associated with this "${marker}" comment.` });
    });
  },
};

const noVar: Rule = {
  key: 'ts:no-var',
  name: 'let and const should be preferred to var',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 5,
  tags: ['es2015'],
  description: 'var is function-scoped and hoisted, which is rarely what the surrounding code assumes.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      // let and const parse as lexical_declaration; only var lands here.
      if (node.type !== 'variable_declaration') return;

      report({ node, message: 'Replace this "var" with "let" or "const".' });
    });
  },
};

const explicitAny: Rule = {
  key: 'ts:no-explicit-any',
  name: 'The "any" type should not be used',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 10,
  tags: ['type-safety'],
  description: 'Every "any" is a hole in the type system, and holes spread to everything that touches the value.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'predefined_type' || node.text !== 'any') return;

      report({ node, message: 'Replace this "any" with a more specific type.' });
    });
  },
};

const noConsole: Rule = {
  key: 'ts:no-console',
  name: 'Console logging should not be used in production code',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  effortMinutes: 5,
  tags: ['observability'],
  description: 'console output bypasses whatever logging the application actually ships with.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      const callee = calleeText(node);
      if (!callee?.startsWith('console.')) return;

      report({ node, message: `Remove this ${callee}() call or route it through the logger.` });
    });
  },
};

const noDebugger: Rule = {
  key: 'ts:no-debugger',
  name: 'Debugger statements should not be committed',
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 5,
  tags: ['unused'],
  description: 'A debugger statement that reaches production stops the browser dead for anyone with devtools open.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'debugger_statement') return;

      report({ node, message: 'Remove this "debugger" statement.' });
    });
  },
};

/** Block owners where emptiness means something is missing, unlike a noop function. */
const BLOCK_OWNERS = new Set([
  'if_statement',
  'else_clause',
  'while_statement',
  'do_statement',
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'try_statement',
  'finally_clause',
  'statement_block',
  'program',
]);

const emptyBlock: Rule = {
  key: 'ts:no-empty-block',
  name: 'Nested blocks of code should not be left empty',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 5,
  tags: ['suspicious'],
  description: 'An empty branch or loop body is either dead weight or a missing implementation.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'statement_block' || node.namedChildren.length > 0) return;

      const parent = node.parent;
      if (!parent || !BLOCK_OWNERS.has(parent.type)) return;

      report({ node, message: 'Either remove or fill this block of code.' });
    });
  },
};

const MIN_DUPLICATE_LENGTH = 10;
const MIN_DUPLICATES = 3;

const duplicateStringLiteral: Rule = {
  key: 'ts:duplicate-string-literal',
  name: 'String literals should not be duplicated',
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 10,
  tags: ['design'],
  description:
    'The same literal in several places has to be changed in several places. Name it once and refer to the constant.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    const occurrences = new Map<string, { node: SyntaxNode; count: number }>();

    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'string' && node.type !== 'template_string') return;
      // Module specifiers repeat by design.
      if (node.parent?.type === 'import_statement' || node.parent?.type === 'export_statement') return;

      const value = staticStringValue(node);
      if (!value || value.trim().length < MIN_DUPLICATE_LENGTH) return;

      const seen = occurrences.get(value);
      if (seen) seen.count += 1;
      else occurrences.set(value, { node, count: 1 });
    });

    for (const [value, occurrence] of occurrences) {
      if (occurrence.count < MIN_DUPLICATES) continue;

      report({
        node: occurrence.node,
        message: `Define a constant instead of duplicating this literal ${occurrence.count} times: "${value}".`,
      });
    }
  },
};

const MAX_FILE_LINES = 750;

const fileTooLong: Rule = {
  key: 'ts:file-too-long',
  name: 'Files should not have too many lines of code',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  effortMinutes: 60,
  tags: ['design', 'brain-overload'],
  description: 'A file this long has stopped being one thing. Split it along the seams that are already there.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    if (file.lines.length <= MAX_FILE_LINES) return;

    report({
      range: { startLine: 1, endLine: 1 },
      message: `This file has ${file.lines.length} lines, over the ${MAX_FILE_LINES} allowed. Split it into smaller files.`,
    });
  },
};

export const SMELL_RULES: Rule[] = [
  ignoredException,
  todoComment,
  noVar,
  explicitAny,
  noConsole,
  noDebugger,
  emptyBlock,
  duplicateStringLiteral,
  fileTooLong,
];
