// 一次性修补：给 8 处 db.$transaction 统一加 SQLite 交互事务超时（P2028 修复）
// 括号平衡定位闭合 })，替换为 }, SQLITE_TX_TIMEOUT)
import { readFileSync, writeFileSync } from 'node:fs'

const FILES = [
  'src/core/content/version-service.ts',
  'src/core/content/fork-service.ts',
  'src/core/content/content-service.ts',
  'src/core/planning/plan-service.ts',
]

const MARK = 'db.$transaction(async (tx) => {'
const OUT = '}, SQLITE_TX_TIMEOUT)'

for (const file of FILES) {
  let src = readFileSync(file, 'utf8')
  let count = 0
  let searchFrom = 0
  while (count < 10) {
    const from = src.indexOf(MARK, searchFrom)
    if (from < 0) break
    // 从 MARK 的 '{' 开始括号平衡
    let depth = 0
    let end = -1
    for (let i = from + MARK.length - 1; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end < 0) throw new Error(`${file}: 括号平衡失败`)
    const after = src.slice(end, end + 2)
    if (after !== '})') throw new Error(`${file} 位置 ${end}: 预期 '})' 实际 '${after}'`)
    src = src.slice(0, end) + OUT + src.slice(end + 2)
    searchFrom = end + OUT.length
    count++
  }
  if (count === 0) throw new Error(`${file}: 未找到事务标记`)
  if (!src.includes("import { db, SQLITE_TX_TIMEOUT }")) {
    const replaced = src.replace("import { db } from '@/lib/db'", "import { db, SQLITE_TX_TIMEOUT } from '@/lib/db'")
    if (replaced === src) throw new Error(`${file}: 未找到 db import 行`)
    src = replaced
  }
  writeFileSync(file, src)
  console.log(`${file}: ${count} 处事务已加超时`)
}
console.log('完成')
