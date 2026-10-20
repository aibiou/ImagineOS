// 全深度打印 L240-L280 之间开始的所有 AST 节点
import ts from 'typescript';
import fs from 'node:fs';

const file = 'src/app/page.tsx';
const source = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

const out = [];
function walk(node, depth = 0) {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const line = start.line + 1;
  if (line >= 240 && line <= 280) {
    out.push(`L${line} d${depth} ${ts.SyntaxKind[node.kind]}`);
  }
  node.forEachChild((c) => walk(c, depth + 1));
}
walk(sf);
console.log(out.slice(0, 60).join('\n'));
console.log(`共 ${out.length} 个节点`);
