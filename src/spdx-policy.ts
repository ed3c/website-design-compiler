import { createHash } from "node:crypto";

export type SpdxPolicyState = "ALLOW" | "REVIEW_REQUIRED" | "DENY" | "UNKNOWN";

type LicenseNode = { kind: "LICENSE"; id: string };
type WithNode = { kind: "WITH"; license: LicenseNode; exception: string };
type AndNode = { kind: "AND"; left: SpdxNode; right: SpdxNode };
type OrNode = { kind: "OR"; left: SpdxNode; right: SpdxNode };
export type SpdxNode = LicenseNode | WithNode | AndNode | OrNode;

export interface SpdxEvaluation {
  schema: "website-design-compiler/spdx-policy-evaluation/v1";
  expression: string;
  normalizedExpression: string;
  astSha256: string;
  policyIdentitySha256: string;
  identifiers: string[];
  state: SpdxPolicyState;
  diagnostics: string[];
  evaluationIdentitySha256: string;
}

type Token = { kind: "IDENT"; value: string } | { kind: "AND" | "OR" | "WITH" | "LPAREN" | "RPAREN" } | { kind: "EOF" };

const PERMISSIVE = new Set([
  "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "BlueOak-1.0.0", "CC0-1.0", "ISC", "MIT",
  "Python-2.0", "Unlicense", "WTFPL"
]);
const REVIEW_EXACT = new Set(["Artistic-2.0", "CDDL-1.0", "CDDL-1.1", "EPL-1.0", "EPL-2.0", "MPL-1.1", "MPL-2.0"]);
const REVIEW_PREFIXES = ["AGPL-", "GPL-", "LGPL-", "OSL-", "CC-BY-"];
const DENY_MARKERS = ["PolyForm-Noncommercial", "Commons-Clause", "NON-COMMERCIAL", "NONCOMMERCIAL", "CC-BY-NC"];
const KNOWN_EXCEPTIONS = new Set(["Classpath-exception-2.0", "LLVM-exception", "GCC-exception-2.0", "GCC-exception-3.1"]);

const POLICY_IDENTITY = createHash("sha256").update(JSON.stringify({
  schema: "website-design-compiler/spdx-policy/v1",
  permissive: [...PERMISSIVE].sort(),
  reviewExact: [...REVIEW_EXACT].sort(),
  reviewPrefixes: [...REVIEW_PREFIXES].sort(),
  denyMarkers: [...DENY_MARKERS].sort(),
  knownExceptions: [...KNOWN_EXCEPTIONS].sort(),
  andRule: "DENY>UNKNOWN>REVIEW_REQUIRED>ALLOW",
  orRule: "ALLOW>REVIEW_REQUIRED>UNKNOWN>DENY",
  withRule: "known-exception-never-auto-allow"
})).digest("hex");

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`unsupported canonical JSON value: ${typeof value}`);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function tokenize(source: string): Token[] {
  const value = source.trim();
  if (!value) throw new Error("SPDX expression must be non-empty");
  const tokens: Token[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "(") { tokens.push({ kind: "LPAREN" }); index += 1; continue; }
    if (char === ")") { tokens.push({ kind: "RPAREN" }); index += 1; continue; }
    const start = index;
    while (index < value.length && !/[\s()]/.test(value[index]!)) index += 1;
    const raw = value.slice(start, index);
    if (!/^[A-Za-z0-9][A-Za-z0-9.+:_-]*$/.test(raw)) throw new Error(`invalid SPDX token: ${raw}`);
    const upper = raw.toUpperCase();
    if (upper === "AND" || upper === "OR" || upper === "WITH") tokens.push({ kind: upper });
    else tokens.push({ kind: "IDENT", value: raw });
  }
  tokens.push({ kind: "EOF" });
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): SpdxNode {
    const node = this.parseOr();
    if (this.peek().kind !== "EOF") throw new Error(`unexpected SPDX token: ${this.describe(this.peek())}`);
    return node;
  }

  private peek(): Token { return this.tokens[this.index] ?? { kind: "EOF" }; }
  private take(): Token { const token = this.peek(); this.index += 1; return token; }
  private describe(token: Token): string { return token.kind === "IDENT" ? token.value : token.kind; }

  private parseOr(): SpdxNode {
    let node = this.parseAnd();
    while (this.peek().kind === "OR") { this.take(); node = { kind: "OR", left: node, right: this.parseAnd() }; }
    return node;
  }

  private parseAnd(): SpdxNode {
    let node = this.parseWith();
    while (this.peek().kind === "AND") { this.take(); node = { kind: "AND", left: node, right: this.parseWith() }; }
    return node;
  }

  private parseWith(): SpdxNode {
    const node = this.parsePrimary();
    if (this.peek().kind !== "WITH") return node;
    this.take();
    if (node.kind !== "LICENSE") throw new Error("SPDX WITH must apply to one license identifier");
    const exception = this.take();
    if (exception.kind !== "IDENT") throw new Error("SPDX WITH requires one exception identifier");
    if (this.peek().kind === "WITH") throw new Error("SPDX expression cannot chain WITH exceptions");
    return { kind: "WITH", license: node, exception: exception.value };
  }

  private parsePrimary(): SpdxNode {
    const token = this.take();
    if (token.kind === "IDENT") return { kind: "LICENSE", id: token.value };
    if (token.kind === "LPAREN") {
      const node = this.parseOr();
      if (this.take().kind !== "RPAREN") throw new Error("SPDX expression has an unclosed parenthesis");
      return node;
    }
    throw new Error(`expected SPDX license identifier, got ${this.describe(token)}`);
  }
}

export function parseSpdxExpression(expression: string): SpdxNode {
  return new Parser(tokenize(expression)).parse();
}

function format(node: SpdxNode): string {
  if (node.kind === "LICENSE") return node.id;
  if (node.kind === "WITH") return `${node.license.id} WITH ${node.exception}`;
  return `(${format(node.left)} ${node.kind} ${format(node.right)})`;
}

function classifyLicense(id: string, diagnostics: string[]): SpdxPolicyState {
  if (PERMISSIVE.has(id)) return "ALLOW";
  if (DENY_MARKERS.some((marker) => id.toUpperCase().includes(marker.toUpperCase()))) {
    diagnostics.push(`license ${id} matches a non-commercial or restricted policy marker`);
    return "DENY";
  }
  if (REVIEW_EXACT.has(id) || REVIEW_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    diagnostics.push(`license ${id} requires explicit review under repository policy`);
    return "REVIEW_REQUIRED";
  }
  diagnostics.push(`license identifier ${id} is not classified by the pinned policy`);
  return "UNKNOWN";
}

function combineAnd(left: SpdxPolicyState, right: SpdxPolicyState): SpdxPolicyState {
  const rank: Record<SpdxPolicyState, number> = { ALLOW: 0, REVIEW_REQUIRED: 1, UNKNOWN: 2, DENY: 3 };
  return rank[left] >= rank[right] ? left : right;
}

function combineOr(left: SpdxPolicyState, right: SpdxPolicyState): SpdxPolicyState {
  const rank: Record<SpdxPolicyState, number> = { DENY: 0, UNKNOWN: 1, REVIEW_REQUIRED: 2, ALLOW: 3 };
  return rank[left] >= rank[right] ? left : right;
}

function evaluateNode(node: SpdxNode, diagnostics: string[]): SpdxPolicyState {
  if (node.kind === "LICENSE") return classifyLicense(node.id, diagnostics);
  if (node.kind === "WITH") {
    const base = classifyLicense(node.license.id, diagnostics);
    if (base === "DENY") return "DENY";
    if (!KNOWN_EXCEPTIONS.has(node.exception)) {
      diagnostics.push(`SPDX exception ${node.exception} is not classified by the pinned policy`);
      return "UNKNOWN";
    }
    diagnostics.push(`SPDX exception ${node.exception} requires explicit review; WITH never auto-promotes to ALLOW`);
    return base === "UNKNOWN" ? "UNKNOWN" : "REVIEW_REQUIRED";
  }
  const left = evaluateNode(node.left, diagnostics);
  const right = evaluateNode(node.right, diagnostics);
  return node.kind === "AND" ? combineAnd(left, right) : combineOr(left, right);
}

function collectIdentifiers(node: SpdxNode, output: Set<string>): void {
  if (node.kind === "LICENSE") { output.add(node.id); return; }
  if (node.kind === "WITH") { output.add(node.license.id); output.add(node.exception); return; }
  collectIdentifiers(node.left, output);
  collectIdentifiers(node.right, output);
}

export function evaluateSpdxExpression(expression: string): SpdxEvaluation {
  const source = expression.trim();
  const ast = parseSpdxExpression(source);
  const normalizedExpression = format(ast);
  const diagnostics: string[] = [];
  const state = evaluateNode(ast, diagnostics);
  const identifiers = new Set<string>();
  collectIdentifiers(ast, identifiers);
  const astSha256 = hash(ast);
  const stable = {
    schema: "website-design-compiler/spdx-policy-evaluation/v1" as const,
    expression: source,
    normalizedExpression,
    astSha256,
    policyIdentitySha256: POLICY_IDENTITY,
    identifiers: [...identifiers].sort(),
    state,
    diagnostics: [...new Set(diagnostics)].sort()
  };
  return { ...stable, evaluationIdentitySha256: hash(stable) };
}
