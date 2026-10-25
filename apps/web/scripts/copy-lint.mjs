// Copy lint: fails on explanatory UI copy (docs/ideas/frontend-remediation-plan.md, R1–R2).
// Flags any user-visible string of 12+ words, plus `description=` / <CardDescription>, outside errors,
// placeholders, titles and aria text. Allow a deliberate case with a `copy-ok: <reason>` comment on or above the line.
// Usage: node scripts/copy-lint.mjs <dir>...
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const MAX_WORDS = 12;
const SKIP_ATTRS = new Set(["className", "placeholder", "title", "aria-label", "aria-description", "alt", "href", "src", "id", "key", "data-testid"]);
const ERROR_CALLS = /^(Error|setError|setSubmitError|toast\.error|fail|reject|ApiError)$/;

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("usage: copy-lint <dir>...");
  process.exit(2);
}

const files = dirs.flatMap(function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dev" || e.name.startsWith(".") ? [] : walk(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
});

const words = (s) => s.trim().split(/\s+/).filter(Boolean);
const looksLikeClasses = (s) => {
  const w = words(s);
  return w.length > 0 && w.filter((t) => /[-:[\]/]/.test(t) && !/^[A-Za-z]+[.,;:]?$/.test(t)).length / w.length > 0.5;
};

const problems = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const allowed = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    return /copy-ok/.test(lines[line] ?? "") || /copy-ok/.test(lines[line - 1] ?? "");
  };
  const exempt = (node) => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p) && SKIP_ATTRS.has(p.name.getText(sf))) return true;
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && ERROR_CALLS.test(p.expression.getText(sf))) return true;
      if (ts.isPropertyAssignment(p) && /^(className|placeholder|title|error|aria)/.test(p.name.getText(sf))) return true;
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
    }
    return false;
  };
  const report = (node, msg) => {
    if (allowed(node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    problems.push(`${file}:${line + 1}  ${msg}`);
  };
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "description") report(node, "description= prop (R1: no explainer lines)");
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sf) === "CardDescription")
      report(node, "<CardDescription> (R1: no explainer lines)");
    let s = null;
    if (ts.isJsxText(node)) s = node.getText(sf);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) s = node.text;
    else if (ts.isTemplateExpression(node)) s = node.getText(sf).replace(/\$\{[^}]*\}/g, "X");
    if (s && words(s).length >= MAX_WORDS && !looksLikeClasses(s) && !exempt(node)) {
      report(node, `${words(s).length}-word copy: "${s.trim().replace(/\s+/g, " ").slice(0, 90)}…"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\ncopy-lint: ${problems.length} problem(s). Cut the copy, or mark a real error/empty/confirm/legal line with \`copy-ok: <reason>\`.`);
  process.exit(1);
}
console.log(`copy-lint: ${files.length} files clean`);
