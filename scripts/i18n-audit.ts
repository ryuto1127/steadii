/**
 * scripts/i18n-audit.ts
 *
 * Walks app/ and components/, parses each .tsx file via the TypeScript
 * compiler API, and reports user-facing strings that are NOT routed
 * through next-intl's t() output.
 *
 * Three finding kinds:
 *   - jsx-text         : raw text node inside JSX (<div>Hello</div>)
 *   - string-literal   : string literal as a JSX child ({"hello"})
 *   - title-attribute  : string literal in a user-visible JSX attribute
 *                        (aria-label="Send draft", placeholder="…", title="…")
 *
 * Whitelist rules (skip these — not user-visible UI strings):
 *   1. Brand name "Steadii".
 *   2. Pure punctuation / whitespace / numbers / single Unicode symbols
 *      ("·", "—", "⌘", ":", "/", etc.).
 *   3. Code-identifier-like strings: ^[a-z][a-zA-Z0-9_-]*$ AND length ≤ 32.
 *   4. Strings inside non-visible attributes (className, style, id, key,
 *      data-*, name, type, role, href, src, tabIndex, htmlFor, value,
 *      defaultValue, autoComplete, etc.) — those are NOT collected at all.
 *   5. Files under path whitelist (see PATH_WHITELIST below):
 *        - app/app/admin/    : admin-only internal tooling, metric labels
 *                              mirror DB column names, intentionally English.
 *        - app/opengraph-image.tsx : OG image generated at edge runtime,
 *                              no request-scoped i18n context available.
 *        - app/global-error.tsx    : root error boundary, must render even
 *                              if next-intl context failed to load.
 *        - app/dev/                 : dev-only verification harnesses
 *                              (NODE_ENV !== "production" gated). Mock
 *                              data is intentionally bilingual.
 *   6. JSX-text nodes that, after stripping HTML entity refs (&lt; &amp;
 *      &ldquo; &rdquo; etc.), reduce to punctuation/whitespace.
 *
 * For attribute findings we additionally skip short identifiers per rule (3).
 *
 * Usage:
 *   pnpm tsx scripts/i18n-audit.ts                  # human report
 *   pnpm tsx scripts/i18n-audit.ts --json           # JSON for the test
 *   pnpm tsx scripts/i18n-audit.ts --json > out.json
 *
 * Exit code: 0 if zero findings, 1 if findings (so CI/test can gate).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const REPO_ROOT = path.resolve(__dirname, "..");
const ROOTS = ["app", "components"];

// Path prefixes (relative to REPO_ROOT) that are walked but whose findings
// are dropped. See header comment, rule (5), for rationale per entry.
const PATH_WHITELIST: readonly string[] = [
  "app/app/admin/",
  "app/opengraph-image.tsx",
  "app/global-error.tsx",
  "app/dev/",
];

// JSX attribute names whose string-literal values can be user-visible.
// Anything not in this set is treated as non-visible (className, id, etc.).
export const USER_VISIBLE_ATTRS: ReadonlySet<string> = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-placeholder",
  "aria-valuetext",
  "title",
  "alt",
  "placeholder",
  "label",
  "summary",
  "caption",
]);

// Pure formatting / decoration. Matches "·", "—", "⌘", ":", "/", "1", "  ", etc.
const PUNCTUATION_ONLY_RE = /^[\s\p{P}\p{S}\p{N}]*$/u;

// HTML named/numeric entity reference. Used to strip &lt;, &ldquo;, &#39; etc.
// before deciding whether a JsxText node is punctuation-only.
const HTML_ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);/g;

// Code-identifier-shaped: starts with lowercase, only word chars + dash.
const SHORT_IDENTIFIER_RE = /^[a-z][a-zA-Z0-9_-]*$/;

// Per the brief: "Steadii" is the brand and stays untranslated.
const BRAND_NAME = "Steadii";

export type FindingKind = "jsx-text" | "string-literal" | "title-attribute";

export type Finding = {
  file: string; // relative to repo root, forward-slashed
  line: number; // 1-indexed
  column: number; // 1-indexed
  kind: FindingKind;
  text: string;
  context: string; // trimmed source line for the finding
};

function stripHtmlEntities(text: string): string {
  return text.replace(HTML_ENTITY_RE, "");
}

function isPunctuationOnly(text: string): boolean {
  return PUNCTUATION_ONLY_RE.test(text);
}

/**
 * For JsxText specifically: strip HTML entity references first, since the
 * TS compiler returns the raw source text (e.g. "&ldquo;" not "“"). After
 * stripping, an entity-only node reduces to "" and is treated as
 * punctuation-only.
 */
function isJsxTextWhitelistOnly(text: string): boolean {
  const stripped = stripHtmlEntities(text).trim();
  if (stripped.length === 0) return true;
  if (PUNCTUATION_ONLY_RE.test(stripped)) return true;
  return false;
}

function isShortIdentifier(text: string): boolean {
  return text.length > 0 && text.length <= 32 && SHORT_IDENTIFIER_RE.test(text);
}

function isBrandName(text: string): boolean {
  return text === BRAND_NAME;
}

/**
 * Whitelist a string that appears as JSX text. Returns true if the string
 * is NOT a finding (skip it).
 */
function isWhitelistedJsxText(text: string): boolean {
  if (isJsxTextWhitelistOnly(text)) return true;
  if (isBrandName(text)) return true;
  if (isShortIdentifier(text)) return true;
  return false;
}

/**
 * Whitelist a string that appears as a string-literal JSX child
 * (`<div>{"hello"}</div>`). Same rules as JSX text but no entity decoding —
 * a string literal carries its real value, not raw source.
 */
function isWhitelistedJsxStringLiteral(text: string): boolean {
  if (isPunctuationOnly(text)) return true;
  if (isBrandName(text)) return true;
  if (isShortIdentifier(text)) return true;
  return false;
}

/**
 * Whitelist for user-visible attribute values (aria-label, title, alt,
 * placeholder, etc.). Same rules as JSX strings.
 */
function isWhitelistedAttributeValue(text: string): boolean {
  if (isPunctuationOnly(text)) return true;
  if (isBrandName(text)) return true;
  if (isShortIdentifier(text)) return true;
  return false;
}

function isPathWhitelisted(relPath: string): boolean {
  return PATH_WHITELIST.some((prefix) => relPath.startsWith(prefix));
}

function walkDir(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walkDir(full, out);
    } else if (entry.isFile() && full.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

/**
 * Audit a single TSX file. Pass `repoRoot` to control how the returned
 * `file` path is rendered (defaults to the script's repo root).
 */
export function auditFile(filePath: string, repoRoot: string = REPO_ROOT): Finding[] {
  const source = fs.readFileSync(filePath, "utf8");
  return auditSource(source, filePath, repoRoot);
}

/**
 * Audit a TSX source string. Useful for tests that don't want to write a
 * temp file. `filePath` is purely for error reporting.
 */
export function auditSource(
  source: string,
  filePath: string,
  repoRoot: string = REPO_ROOT
): Finding[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const findings: Finding[] = [];
  const lines = source.split("\n");
  const relPath = path.relative(repoRoot, filePath).split(path.sep).join("/");

  if (isPathWhitelisted(relPath)) return findings;

  function getLineCol(pos: number): { line: number; column: number } {
    const lc = sourceFile.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character + 1 };
  }

  function getContext(line: number): string {
    return (lines[line - 1] ?? "").trim();
  }

  function pushFinding(
    kind: FindingKind,
    text: string,
    pos: number
  ): void {
    const { line, column } = getLineCol(pos);
    findings.push({
      file: relPath,
      line,
      column,
      kind,
      text,
      context: getContext(line),
    });
  }

  function visit(node: ts.Node): void {
    // 1) Raw JSX text: <div>Hello</div>
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      if (text.length > 0 && !isWhitelistedJsxText(text)) {
        pushFinding("jsx-text", text, node.getStart(sourceFile));
      }
      return; // JsxText has no children worth visiting
    }

    // 2) String literal as a JSX expression child: <div>{"hello"}</div>
    //    (but NOT as an attribute initializer — those are handled below)
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression) &&
      // Make sure parent is a JSX element/fragment, not an attribute.
      node.parent &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const lit = node.expression;
      const text = lit.text;
      if (text.length > 0 && !isWhitelistedJsxStringLiteral(text)) {
        pushFinding("string-literal", text, lit.getStart(sourceFile));
      }
    }

    // 3) JSX attribute with a string-literal value in a user-visible attr.
    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile);
      if (USER_VISIBLE_ATTRS.has(attrName)) {
        const init = node.initializer;
        let lit: ts.StringLiteral | null = null;
        if (init && ts.isStringLiteral(init)) {
          lit = init;
        } else if (
          init &&
          ts.isJsxExpression(init) &&
          init.expression &&
          ts.isStringLiteral(init.expression)
        ) {
          lit = init.expression as ts.StringLiteral;
        }
        if (lit) {
          const text = lit.text;
          if (text.length > 0 && !isWhitelistedAttributeValue(text)) {
            pushFinding("title-attribute", text, lit.getStart(sourceFile));
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

/**
 * Walk roots and audit every .tsx file. Returns all findings.
 */
export function auditCodebase(opts?: {
  roots?: readonly string[];
  repoRoot?: string;
}): Finding[] {
  const roots = opts?.roots ?? ROOTS;
  const repoRoot = opts?.repoRoot ?? REPO_ROOT;
  const files: string[] = [];
  for (const root of roots) {
    walkDir(path.join(repoRoot, root), files);
  }
  files.sort();
  const findings: Finding[] = [];
  for (const file of files) {
    findings.push(...auditFile(file, repoRoot));
  }
  return findings;
}

function formatHuman(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return "✓ No hardcoded JSX strings found.\n";
  }
  const lines: string[] = [];
  lines.push(`✗ Found ${findings.length} hardcoded string(s):`);
  lines.push("");
  // Group by file for readability.
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  for (const [file, items] of byFile) {
    lines.push(`  ${file}  (${items.length})`);
    for (const f of items) {
      lines.push(`    ${f.line}:${f.column}  [${f.kind}]  ${JSON.stringify(f.text)}`);
      if (f.context) lines.push(`         ${f.context}`);
    }
    lines.push("");
  }
  lines.push(`Total: ${findings.length}`);
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const findings = auditCodebase();
  if (jsonMode) {
    process.stdout.write(JSON.stringify(findings, null, 2));
    process.stdout.write("\n");
  } else {
    process.stdout.write(formatHuman(findings));
  }
  process.exit(findings.length > 0 ? 1 : 0);
}

// Execute when invoked directly via `tsx` (CommonJS mode under this repo).
// Keeps imports from auto-running the audit.
if (typeof require !== "undefined" && require.main === module) {
  main();
}
