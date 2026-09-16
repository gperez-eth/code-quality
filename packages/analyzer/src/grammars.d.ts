// The tree-sitter grammar packages ship no type declarations.
declare module 'tree-sitter-typescript' {
  const grammars: { typescript: unknown; tsx: unknown };
  export default grammars;
}

declare module 'tree-sitter-javascript' {
  const grammar: unknown;
  export default grammar;
}
