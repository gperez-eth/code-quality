import type { SyntaxNode } from 'tree-sitter';
import { visitNodes } from '../ast.js';
import type { LanguageId } from '../types.js';

export const ALL_LANGUAGES: LanguageId[] = ['typescript', 'tsx', 'javascript'];
export const TYPESCRIPT_ONLY: LanguageId[] = ['typescript', 'tsx'];

/** The literal text of a string or of a template with nothing interpolated. */
export function staticStringValue(node: SyntaxNode): string | undefined {
  if (node.type === 'string' || node.type === 'template_string') {
    const parts = node.namedChildren.filter((child) => child.type === 'string_fragment');
    if (node.namedChildren.some((child) => child.type === 'template_substitution')) return undefined;
    return parts.map((part) => part.text).join('');
  }
  return undefined;
}

/** Strips the parentheses a reader ignores, e.g. `if ((true))`. */
export function unwrap(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = current.namedChildren[0];
    if (!inner) break;
    current = inner;
  }
  return current;
}

/** Text of the thing being called, e.g. `Math.random` or `eval`. */
export function calleeText(node: SyntaxNode): string | undefined {
  if (node.type !== 'call_expression' && node.type !== 'new_expression') return undefined;
  return node.childForFieldName('function')?.text ?? node.childForFieldName('constructor')?.text;
}

/** The property being read or written, e.g. `innerHTML` in `el.innerHTML`. */
export function propertyName(node: SyntaxNode): string | undefined {
  if (node.type !== 'member_expression') return undefined;
  return node.childForFieldName('property')?.text;
}

/** Compares code ignoring whitespace, so reformatting alone is not a match. */
export function normalizedText(node: SyntaxNode): string {
  return node.text.replace(/\s+/g, ' ').trim();
}

/**
 * Whether the file pulls in one of these modules, by import or require. Rules
 * use it to tell `childProcess.exec()` from `someRegex.exec()`: without the
 * import, a name on its own proves nothing.
 */
export function importsModule(root: SyntaxNode, modules: readonly string[]): boolean {
  const wanted = new Set(modules.map((name) => name.replace(/^node:/, '')));
  let found = false;

  const matches = (specifier: string | undefined): boolean =>
    specifier !== undefined && wanted.has(specifier.replace(/^node:/, ''));

  visitNodes(root, (node) => {
    if (found) return false;

    if (node.type === 'import_statement') {
      const source = node.childForFieldName('source');
      if (source && matches(staticStringValue(source))) found = true;
      return;
    }

    if (node.type === 'call_expression' && calleeText(node) === 'require') {
      const argument = node.childForFieldName('arguments')?.namedChildren[0];
      if (argument && matches(staticStringValue(argument))) found = true;
    }
  });

  return found;
}
