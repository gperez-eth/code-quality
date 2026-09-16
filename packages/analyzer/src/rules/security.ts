import { visitNodes } from '../ast.js';
import type { Rule } from '../types.js';
import { ALL_LANGUAGES, calleeText, importsModule, propertyName, staticStringValue } from './shared.js';

const noEval: Rule = {
  key: 'ts:no-eval',
  name: 'Code should not be dynamically evaluated',
  type: 'VULNERABILITY',
  severity: 'CRITICAL',
  effortMinutes: 20,
  tags: ['injection', 'cwe-95', 'owasp-a3'],
  description:
    'eval() runs whatever string it is given with the privileges of the caller. Any value that reaches it from outside the program is a remote code execution.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (calleeText(node) === 'eval') {
        report({ node, message: 'Refactor this code so that it does not use eval().' });
      }
    });
  },
};

const noFunctionConstructor: Rule = {
  key: 'ts:no-function-constructor',
  name: 'The Function constructor should not be used',
  type: 'VULNERABILITY',
  severity: 'CRITICAL',
  effortMinutes: 20,
  tags: ['injection', 'cwe-95'],
  description: 'new Function(...) compiles a string into a function, which is eval() by another name.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type === 'new_expression' && calleeText(node) === 'Function') {
        report({ node, message: 'Build this function in source rather than compiling it from a string.' });
      }
    });
  },
};

const SECRET_NAMES = /(pass(word|wd)?|secret|token|api[_-]?key|apikey|credential|private[_-]?key|auth)/i;
/** Values that only look like secrets: placeholders, empty strings, examples. */
const PLACEHOLDER = /^(\s*|x+|changeme|your[_-]?\w+|<.*>|\$\{.*\}|.*\.example\..*)$/i;

const noHardcodedSecret: Rule = {
  key: 'ts:no-hardcoded-secret',
  name: 'Credentials should not be hard-coded',
  type: 'VULNERABILITY',
  severity: 'BLOCKER',
  effortMinutes: 30,
  tags: ['cwe-798', 'credentials', 'owasp-a7'],
  description:
    'A credential in source is a credential in every clone, every branch and every build log. Read it from the environment or a secret store instead.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      let name: string | undefined;
      let value: string | undefined;

      if (node.type === 'variable_declarator') {
        name = node.childForFieldName('name')?.text;
        const initializer = node.childForFieldName('value');
        value = initializer ? staticStringValue(initializer) : undefined;
      } else if (node.type === 'assignment_expression') {
        name = node.childForFieldName('left')?.text;
        const right = node.childForFieldName('right');
        value = right ? staticStringValue(right) : undefined;
      } else if (node.type === 'pair') {
        name = node.childForFieldName('key')?.text;
        const pairValue = node.childForFieldName('value');
        value = pairValue ? staticStringValue(pairValue) : undefined;
      }

      if (!name || value === undefined) return;
      if (!SECRET_NAMES.test(name)) return;
      if (value.length < 4 || PLACEHOLDER.test(value)) return;

      report({ node, message: `Remove this hard-coded credential assigned to "${name}".` });
    });
  },
};

const noInnerHtml: Rule = {
  key: 'ts:no-inner-html',
  name: 'HTML should not be built from untrusted values',
  type: 'VULNERABILITY',
  severity: 'MAJOR',
  effortMinutes: 20,
  tags: ['xss', 'cwe-79', 'owasp-a3'],
  description:
    'Assigning a computed string to innerHTML hands the browser markup it will happily execute. Set textContent, or sanitise before assigning.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (node.type !== 'assignment_expression') return;

      const left = node.childForFieldName('left');
      const property = left ? propertyName(left) : undefined;
      if (property !== 'innerHTML' && property !== 'outerHTML') return;

      // A constant string is under the author's control and carries no taint.
      const right = node.childForFieldName('right');
      if (right && staticStringValue(right) !== undefined) return;

      report({ node, message: `Sanitise this value before assigning it to ${property}.` });
    });
  },
};

const pseudorandom: Rule = {
  key: 'ts:pseudorandom',
  name: 'Using pseudorandom number generators is security-sensitive',
  type: 'SECURITY_HOTSPOT',
  severity: 'MINOR',
  effortMinutes: 10,
  tags: ['cwe-338', 'security-hotspot'],
  description:
    'Math.random() is predictable. It is fine for jitter or sampling and wrong for tokens, salts and identifiers — review which this is.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      if (calleeText(node) === 'Math.random') {
        report({ node, message: 'Make sure this random value is not used for anything security-sensitive.' });
      }
    });
  },
};

/** A real endpoint, not the word "http://" in a sentence: there has to be a host. */
const HTTP_URL = /http:\/\/([\w.-]+(?::\d+)?)/i;
/** Local addresses and namespace URIs are not traffic, so they are not a risk. */
const SAFE_HTTP = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w-]+\.local|.*\.example\.(com|org)|example\.(com|org)|(www\.)?w3\.org|schemas?\..*)(:\d+)?$/i;

const clearTextProtocol: Rule = {
  key: 'ts:clear-text-protocol',
  name: 'Using clear-text protocols is security-sensitive',
  type: 'SECURITY_HOTSPOT',
  severity: 'MINOR',
  effortMinutes: 5,
  tags: ['cwe-319', 'security-hotspot'],
  description: 'Traffic over http:// can be read and rewritten in transit. Use https:// unless the endpoint is local.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    visitNodes(file.tree.rootNode, (node) => {
      const value = staticStringValue(node);
      if (!value) return;

      const host = HTTP_URL.exec(value)?.[1];
      if (!host || SAFE_HTTP.test(host)) return;

      report({ node, message: `Make sure the traffic to ${host} over http:// carries nothing sensitive.` });
    });
  },
};

const OS_COMMAND_CALLS = new Set(['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync']);
const COMMAND_MODULES = ['node:child_process', 'child_process', 'execa', 'shelljs'];

const osCommand: Rule = {
  key: 'ts:os-command',
  name: 'Executing OS commands is security-sensitive',
  type: 'SECURITY_HOTSPOT',
  severity: 'MAJOR',
  effortMinutes: 20,
  tags: ['cwe-78', 'security-hotspot', 'owasp-a3'],
  description:
    'A shell command built from program values is an injection point. Review where the arguments come from, and prefer the argv form over a shell string.',
  languages: ALL_LANGUAGES,
  check({ file, report }) {
    // Without the import, `exec` is far more likely to be RegExp.exec().
    if (!importsModule(file.tree.rootNode, COMMAND_MODULES)) return;

    visitNodes(file.tree.rootNode, (node) => {
      const callee = calleeText(node);
      if (!callee) return;

      const name = callee.includes('.') ? callee.slice(callee.lastIndexOf('.') + 1) : callee;
      if (!OS_COMMAND_CALLS.has(name)) return;

      report({ node, message: `Make sure the arguments to ${name}() cannot be controlled from outside.` });
    });
  },
};

export const SECURITY_RULES: Rule[] = [
  noEval,
  noFunctionConstructor,
  noHardcodedSecret,
  noInnerHtml,
  pseudorandom,
  clearTextProtocol,
  osCommand,
];
