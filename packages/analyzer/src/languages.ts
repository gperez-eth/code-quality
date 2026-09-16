import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScriptGrammars from 'tree-sitter-typescript';
import type { LanguageId } from './types.js';

const GRAMMARS: Record<LanguageId, unknown> = {
  typescript: TypeScriptGrammars.typescript,
  tsx: TypeScriptGrammars.tsx,
  javascript: JavaScript,
};

const EXTENSIONS: Record<string, LanguageId> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
};

export function languageForPath(path: string): LanguageId | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return undefined;
  return EXTENSIONS[path.slice(dot).toLowerCase()];
}

const parsers = new Map<LanguageId, Parser>();

/** Parsers are stateful, so one is cached per language rather than per file. */
export function parserFor(language: LanguageId): Parser {
  let parser = parsers.get(language);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(GRAMMARS[language] as never);
    parsers.set(language, parser);
  }
  return parser;
}
