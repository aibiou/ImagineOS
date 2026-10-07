// 找出覆盖 L247-274 的最外层节点（模板串/注释等吞噬结构）
import ts from 'typescript';
import fs from 'node:fs';

const file = 'src/app/page.tsx';
const source = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

const LO = 246, HI = 274; // 0-based line targets (L247..L275)

function covers(node) {
  const s = node.getStart(sf), e = node.getEnd();
  const sl = sf.getLineAndCharacterOfPosition(s).line;
  const el = sf.getLineAndCharacterOfPosition(e).line;
  return sl < LO && el > HI; // 节点起点在区域前、终点在区域后
}

// 递归找覆盖区域的最小节点（吞噬者）
let swallower = null;
function find(node) {
  if (covers(node)) {
    if (!swallower || node.getEnd() - node.getStart() < swallower.getEnd() - swallower.getStart()) {
      swallower = node;
    }
  }
  node.forEachChild((c) => find(c));
}
find(sf);

if (!swallower) {
  console.log('没有发现覆盖 L247-L275 的吞噬节点');
} else {
  const s = swallower.getStart(sf), e = swallower.getEnd();
  const sl = sf.getLineAndCharacterOfPosition(s);
  const el = sf.getLineAndCharacterOfPosition(e);
  console.log(`吞噬节点: ${ts.SyntaxKind[swallower.kind]}`);
  console.log(`  起点 L${sl.line + 1}:${sl.character + 1}  终点 L${el.line + 1}:${el.character + 1}`);
  console.log(`  起点附近文本: ${JSON.stringify(source.slice(s, s + 80))}`);
  console.log(`  终点附近文本: ${JSON.stringify(source.slice(Math.max(0, e - 80), e))}`);
}
