// 用 TypeScript Compiler API 精确定位 page.tsx 的语法/绑定错误
import ts from 'typescript';
import fs from 'node:fs';

const file = 'src/app/page.tsx';
const source = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

// 1. 语法诊断
const diags = sf.parseDiagnostics ?? [];
console.log(`parseDiagnostics: ${diags.length}`);
for (const d of diags.slice(0, 10)) {
  const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
  console.log(`  L${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

// 2. 'utateContent' 出现位置
const re = /utateContent/g;
let m;
while ((m = re.exec(source))) {
  const { line } = sf.getLineAndCharacterOfPosition(m.index);
  console.log(`utateContent @ L${line + 1}`);
}

// 3. 找相邻的 `[m` 丢失特征：`}, utateContent` 与 `utateContent, toast]`
console.log('\n上下文（L261、L273 前后 1 行的原始文本）：');
const lines = source.split('\n');
for (const n of [260, 261, 262, 272, 273, 274]) {
  console.log(`${n + 1}: ${JSON.stringify(lines[n])}`);
}
