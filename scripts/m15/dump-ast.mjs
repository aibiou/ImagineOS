// dump page.tsx 中 submitRevision/remix 附近的 AST，确认真实结构
import ts from 'typescript';
import fs from 'node:fs';

const file = 'src/app/page.tsx';
const source = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

function walk(node, depth = 0, out = []) {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  // 只关心 245-275 行区域的节点
  if (start.line + 1 >= 245 && start.line + 1 <= 275 && depth <= 4) {
    out.push(`${'  '.repeat(depth)}${ts.SyntaxKind[node.kind]} L${start.line + 1}–L${end.line + 1}`);
  }
  node.forEachChild((c) => walk(c, depth + 1, out));
  return out;
}

const out = walk(sf);
console.log(out.join('\n'));
