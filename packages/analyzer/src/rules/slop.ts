import type { SyntaxNode } from 'tree-sitter';
import { functionName, isFunctionNode, visitNodes } from '../ast.js';
import type { Rule } from '../types.js';
import {
  ALL_LANGUAGES,
  annotatedType,
  calleeText,
  isPredefinedType,
  propertyName,
  TYPESCRIPT_ONLY,
  unwrap,
} from './shared.js';

/**
 * Patterns that are structurally plausible but hollow: code that parses,
 * compiles and reads as finished without actually doing or proving anything.
 * This is the failure mode LLM-generated code reliably produces, so every
 * rule here earns its place by naming a specific way that happens.
 */

const chainedTypeAssertions: Rule = {
  key: 'ts:no-chained-type-assertions',
  name: '"as" assertions should not be chained',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['type-safety'],
  description:
    'The first "as" already tells the compiler to stop checking. A second "as" on top of it asserts against a type the compiler never verified, so it reads as extra evidence for the cast and is actually none.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'as_expression') return;

      const inner = node.namedChildren[0];
      if (inner?.type !== 'as_expression') return;

      report({
        node,
        message: 'This chains two or more "as" assertions. Assert once, to the real type, or fix the value instead of forcing it through.',
      });
      // The inner link is part of the same chain; do not also report it as its own chain start.
      return false;
    });
  },
};

const PARAMETER_NODES = new Set(['required_parameter', 'optional_parameter']);


/**
 * A type guard's parameter *must* be `unknown` — validating at the boundary is
 * the discipline this pack exists to encourage, so flagging it punishes the
 * right answer. Found by running the pack over this repository, where it
 * flagged `isScanReport(value: unknown): value is ScanReport`.
 */
function declaresTypePredicate(parameter: SyntaxNode): boolean {
  let current: SyntaxNode | null = parameter;
  while (current && !isFunctionNode(current)) current = current.parent;

  const returnType = current?.childForFieldName('return_type');
  if (!returnType) return false;
  return (
    returnType.type === 'type_predicate' ||
    returnType.namedChildren.some((child) => child.type === 'type_predicate')
  );
}

/**
 * Where `unknown` is the correct annotation rather than a missing one: a
 * caught or rejected error. TypeScript's own `useUnknownInCatchVariables`
 * makes it the default, so asking for a real type here is asking for a lie.
 */
const ERROR_PARAMETER_NAMES = new Set(['error', 'err', 'e', 'reason', 'cause']);

const unknownParameter: Rule = {
  key: 'ts:no-unknown-parameters',
  name: 'Function parameters should not be typed "unknown"',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 10,
  tags: ['type-safety'],
  description:
    'A parameter typed "unknown" pushes the type checking the function is supposed to do onto every caller instead. The signature promises nothing about what the function actually accepts.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (!PARAMETER_NODES.has(node.type)) return;

      const valueType = annotatedType(node.childForFieldName('type'));
      if (!valueType || !isPredefinedType(valueType, ['unknown'])) return;

      const name = node.childForFieldName('pattern')?.text ?? 'this parameter';
      if (ERROR_PARAMETER_NAMES.has(name)) return;
      if (declaresTypePredicate(node)) return;

      report({ node, message: `Give "${name}" a real type instead of "unknown".` });
    });
  },
};

const unknownReturn: Rule = {
  key: 'ts:no-unknown-returns',
  name: 'Functions should not declare an "unknown" return type',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 10,
  tags: ['type-safety'],
  description:
    'A function that hands back "unknown" makes every caller narrow the result before they can do anything with it. If the function does not know what it returns, nothing downstream can either.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (!isFunctionNode(node)) return;

      const returnType = node.childForFieldName('return_type');
      if (!isPredefinedType(annotatedType(returnType), ['unknown'])) return;

      report({ node: returnType ?? node, message: `Give "${functionName(node)}" a real return type instead of "unknown".` });
    });
  },
};

const unknownTypeAlias: Rule = {
  key: 'ts:no-unknown-type-alias',
  name: 'Type aliases should not resolve to "unknown"',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 5,
  tags: ['type-safety'],
  description: 'A type alias that resolves to "unknown" documents nothing. It is a name for "trust me" attached to whatever uses it.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'type_alias_declaration') return;

      const value = node.childForFieldName('value');
      if (!isPredefinedType(value, ['unknown'])) return;

      const name = node.childForFieldName('name')?.text ?? 'this type';
      report({ node, message: `Type "${name}" is just another name for "unknown". Give it a real shape or remove it.` });
    });
  },
};

const UNSAFE_DICTIONARY_VALUES = ['any', 'unknown', 'object'];

const unsafeDictionaryType: Rule = {
  key: 'ts:no-unsafe-dictionary-type',
  name: 'Dictionary value types should not be "any", "unknown" or "object"',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 10,
  tags: ['type-safety'],
  description:
    'A dictionary typed to hold "any", "unknown" or "object" gives up on every value it stores. Whatever is read back out has to be checked from scratch, which defeats the point of typing the container at all.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type === 'index_signature') {
        const valueType = annotatedType(node.childForFieldName('type'));
        if (!valueType || !isPredefinedType(valueType, UNSAFE_DICTIONARY_VALUES)) return;

        report({ node, message: `This index signature's value type is "${valueType.text}", which is no safer than leaving it untyped.` });
        return;
      }

      if (node.type === 'generic_type') {
        if (node.childForFieldName('name')?.text !== 'Record') return;

        const valueType = node.childForFieldName('type_arguments')?.namedChildren[1];
        if (!valueType || !isPredefinedType(valueType, UNSAFE_DICTIONARY_VALUES)) return;

        report({ node, message: `This Record's value type is "${valueType.text}", which is no safer than leaving it untyped.` });
      }
    });
  },
};

const emptyFunctionBody: Rule = {
  key: 'ts:no-empty-function-body',
  name: 'Named functions should not have an empty body',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['suspicious'],
  description:
    'A named function with an empty body reads as finished — it has a name, a signature, maybe even call sites — but does nothing. That gap is easy to miss until it is in production. An anonymous inline no-op (e.g. a default event handler) is left alone, and so is an empty constructor, since both are common and usually intentional.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (!isFunctionNode(node)) return;

      const body = node.childForFieldName('body');
      // A comment counts as a named child, so a documented stub is left alone.
      if (body?.type !== 'statement_block' || body.namedChildren.length > 0) return;
      if (node.childForFieldName('name')?.text === 'constructor') return;

      // An empty ARROW is a placeholder or a deliberate no-op, not an
      // unimplemented stub: `let signal = () => {}` has its real body
      // assigned two lines later, and `const noop = () => {}` means it.
      // functionName resolves both to the variable they are assigned to, so
      // the anonymity check below never caught them. A named function or a
      // method with an empty body is the shape this rule is for.
      if (node.type === 'arrow_function') return;

      const name = functionName(node);
      if (name === '<anonymous>') return;

      report({ node, message: `Function "${name}" has an empty body. Implement it, remove it, or comment why doing nothing is correct.` });
    });
  },
};

const swallowedCatch: Rule = {
  key: 'ts:no-swallowed-catch',
  name: 'Caught exceptions should not be swallowed',
  // CODE_SMELL, not BUG, and the demotion has a reason. The rule reads
  // intent — "this catch tells the caller it succeeded" — and in a
  // top-level poll loop there is no caller left to mislead, where logging
  // and carrying on is the correct behaviour. A heuristic about intent
  // should not drive the reliability rating or fail a build. It was also
  // harsher than `ts:no-ignored-exception`, which is CODE_SMELL for the
  // strictly worse case of a catch that does nothing at all.
  type: 'CODE_SMELL',
  severity: 'CRITICAL',
  effortMinutes: 15,
  tags: ['error-handling'],
  description:
    'A catch that logs and moves on, or quietly returns null, tells the caller the operation succeeded when it did not. GitClear measured exactly this shape of error-masking rising 47% in code written with heavy AI assistance — it is the fastest way to make error handling look present without being present.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'catch_clause') return;

      const body = node.childForFieldName('body');
      if (!body) return;

      // An *empty* catch belongs to `ts:no-ignored-exception`, which also knows
      // that a comment counts as a named child and so leaves a documented catch
      // alone. This rule is about the harder case: a catch that looks handled.
      // A comment counts as a named child, so `catch { /* why */ return; }`
      // falls out of the length check below and is left alone — the same
      // escape hatch `ts:no-ignored-exception` gives. Narrow that check and
      // the exemption disappears silently.
      const statements = body.namedChildren;
      if (statements.length !== 1) return;

      const only = statements[0]!;

      if (only.type === 'expression_statement') {
        const call = only.namedChildren[0];
        const callee = call ? calleeText(call) : undefined;
        if (!callee?.startsWith('console.')) return;

        report({
          node,
          message: `This catch only calls ${callee}() and moves on; the caller still believes the operation succeeded. Rethrow the error or return something the caller can check.`,
        });
        return;
      }

      if (only.type === 'return_statement') {
        const argument = only.namedChildren[0];
        const isNullish = !argument || argument.type === 'null' || (argument.type === 'identifier' && argument.text === 'undefined');
        if (!isNullish) return;

        report({
          node,
          message: 'This catch returns as if nothing went wrong; the caller cannot tell the operation failed. Rethrow the error or return something the caller can check.',
        });
      }
    });
  },
};


/** Small function words that carry no meaning on their own, filtered out before comparing. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'is', 'are', 'it', 'this', 'that', 'in', 'on',
  'for', 'and', 'or', 'be', 'as', 'by', 'with', 'at', 'from',
]);

/** Lowercased, camelCase-split, punctuation-stripped words, with the stopwords above removed. */
function contentWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));
}

// A comment restating its code is only worth flagging when the match is unmistakable: the
// comment has to sit alone on its own line (a trailing note is a different, usually-fine
// habit), it needs at least two content words so a one-word comment like "// noop" can never
// match by accident, and at least four-fifths of those words have to reappear on the very
// next line. Anything looser starts catching real explanations, so this stays conservative
// on purpose at the cost of missing some genuinely redundant comments.
const MIN_CONTENT_WORDS = 2;
const OVERLAP_THRESHOLD = 0.8;

const redundantComment: Rule = {
  key: 'ts:no-redundant-comment',
  name: 'Comments should not restate the code below them',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 5,
  tags: ['convention'],
  description:
    'A comment that just re-says the next line in different words costs reading time and gives nothing back. It is also the shape a generator produces when told to "add comments" with nothing left to explain.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'comment' || !node.text.startsWith('//')) return;

      const row = node.startPosition.row;
      const linePrefix = file.lines[row]?.slice(0, node.startPosition.column) ?? '';
      if (linePrefix.trim().length > 0) return; // a trailing comment annotates; it does not restate

      const nextLine = file.lines[row + 1];
      if (!nextLine || !nextLine.trim() || nextLine.trim().startsWith('//')) return;

      const commentWords = contentWords(node.text.slice(2));
      if (commentWords.length < MIN_CONTENT_WORDS) return;

      const codeWords = new Set(contentWords(nextLine));
      const overlap = commentWords.filter((word) => codeWords.has(word)).length / commentWords.length;
      if (overlap < OVERLAP_THRESHOLD) return;

      report({
        node,
        message: 'This comment restates the line below it in different words. Delete it, or explain why the code does this rather than what it does.',
      });
    });
  },
};

/** The value a reduce callback hands back: the arrow's expression body, or its top-level return. */
function reduceCallbackReturn(callback: SyntaxNode): SyntaxNode | undefined {
  const body = callback.childForFieldName('body');
  if (!body) return undefined;
  if (body.type !== 'statement_block') return body;

  // Only the top-level return counts; one buried in a branch is a more deliberate shape
  // that this heuristic leaves alone rather than risk a false positive.
  const topLevelReturn = body.namedChildren.find((child) => child.type === 'return_statement');
  return topLevelReturn?.namedChildren[0];
}

function simpleParameterName(param: SyntaxNode | undefined): string | undefined {
  if (!param) return undefined;
  if (param.type === 'identifier') return param.text;
  if (param.type === 'required_parameter' || param.type === 'optional_parameter') {
    const pattern = param.childForFieldName('pattern');
    return pattern?.type === 'identifier' ? pattern.text : undefined;
  }
  return undefined;
}

const reduceAccumulatorCopy: Rule = {
  key: 'ts:no-reduce-accumulator-copy',
  name: 'reduce should not rebuild its accumulator on every call',
  type: 'CODE_SMELL',
  severity: 'MINOR',
  effortMinutes: 10,
  tags: ['performance'],
  description:
    'Spreading the accumulator into a new object or array on every iteration copies everything seen so far, every time — an O(n) copy inside an O(n) loop. It reads as careful, immutable code and runs quadratically.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'call_expression') return;

      const callee = node.childForFieldName('function');
      if (callee?.type !== 'member_expression' || propertyName(callee) !== 'reduce') return;

      const callback = node.childForFieldName('arguments')?.namedChildren[0];
      if (!callback || (callback.type !== 'arrow_function' && callback.type !== 'function_expression')) return;

      const accumulatorName = simpleParameterName(callback.childForFieldName('parameters')?.namedChildren[0]);
      if (!accumulatorName) return;

      const returned = reduceCallbackReturn(callback);
      const value = returned ? unwrap(returned) : undefined;
      if (!value || (value.type !== 'object' && value.type !== 'array')) return;

      const copiesAccumulator = value.namedChildren.some(
        (child) =>
          child.type === 'spread_element' &&
          child.namedChildren[0]?.type === 'identifier' &&
          child.namedChildren[0]?.text === accumulatorName,
      );
      if (!copiesAccumulator) return;

      report({
        node: value,
        message: `This reduce spreads "${accumulatorName}" into a new ${value.type} every iteration, copying everything seen so far each time. Mutate a single accumulator, or use map/filter instead.`,
      });
    });
  },
};

const WIDENING_TYPES = ['unknown', 'any'];

/** The widening type a declarator's value was forced into, via annotation or an "as" cast. */
function wideningTypeText(declarator: SyntaxNode): string | undefined {
  const annotated = annotatedType(declarator.childForFieldName('type'));
  if (annotated && isPredefinedType(annotated, WIDENING_TYPES)) return annotated.text;

  const initializer = declarator.childForFieldName('value');
  const castTo = initializer?.type === 'as_expression' ? initializer.namedChildren[1] : undefined;
  if (castTo && isPredefinedType(castTo, WIDENING_TYPES)) return castTo.text;

  return undefined;
}

/** The first "name as ConcreteType" inside scope, skipping any nested function's own body. */
function findConcreteAssertion(scope: SyntaxNode, name: string): SyntaxNode | undefined {
  let found: SyntaxNode | undefined;

  visitNodes(scope, (node) => {
    if (found) return false;
    // Node identity is not reliable across separate property accesses in this binding, so
    // position is what tells `scope` itself apart from a nested function inside it.
    if (node.startIndex !== scope.startIndex && isFunctionNode(node)) return false;

    if (node.type === 'as_expression') {
      const left = node.namedChildren[0];
      const right = node.namedChildren[1];
      if (left?.type === 'identifier' && left.text === name && right && !isPredefinedType(right, WIDENING_TYPES)) {
        found = node;
        return false;
      }
    }
  });

  return found;
}

const widenThenAssert: Rule = {
  key: 'ts:no-widen-then-assert',
  name: 'A value should not be widened and immediately asserted back',
  type: 'CODE_SMELL',
  severity: 'MAJOR',
  effortMinutes: 10,
  tags: ['type-safety'],
  description:
    'Declaring a value "unknown" or "any" and asserting it straight back to a concrete type on the next line adds a statement where the widening removes the one check it was supposed to force. The single-expression version, "x as unknown as T", is covered by no-chained-type-assertions; this rule is the two-statement version of the same move.',
  languages: TYPESCRIPT_ONLY,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'lexical_declaration' && node.type !== 'variable_declaration') return;
      if (node.namedChildren.length !== 1) return; // multiple declarators muddy which name the next line means

      const declarator = node.namedChildren[0];
      if (declarator?.type !== 'variable_declarator') return;

      const name = declarator.childForFieldName('name');
      if (name?.type !== 'identifier') return;

      const wideType = wideningTypeText(declarator);
      if (!wideType) return;

      // Not `siblings.indexOf(node)`: this binding does not guarantee that a node fetched via
      // `parent.namedChildren` is reference-equal to the node the outer traversal is holding,
      // so position is what has to identify it.
      const siblings = node.parent?.namedChildren ?? [];
      const index = siblings.findIndex((sibling) => sibling.startIndex === node.startIndex);
      const next = index >= 0 ? siblings[index + 1] : undefined;
      if (!next) return;

      const assertion = findConcreteAssertion(next, name.text);
      if (!assertion) return;

      report({
        node: assertion,
        message: `"${name.text}" was widened to "${wideType}" on the line above and is immediately asserted back to a concrete type. Skip the widening, or justify it — right now it only suppresses the type checker.`,
      });
    });
  },
};

export const SLOP_RULES: Rule[] = [
  chainedTypeAssertions,
  unknownParameter,
  unknownReturn,
  unknownTypeAlias,
  unsafeDictionaryType,
  emptyFunctionBody,
  swallowedCatch,
  redundantComment,
  reduceAccumulatorCopy,
  widenThenAssert,
];
