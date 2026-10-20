// scripts/m15/repair-cookies.mjs —— 一次性修复：为旧 state 补齐作者会话 cookie（从 DB Identity 提取）
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const db = new PrismaClient()
const STATE = 'scripts/m15/state'
const COOKIE_NAME = 'imagineos_sid'

const caseIds = ['p01-persona', 'p02-family', 'p03-travel', 'p05-mood', 'p06-dream']

for (const caseId of caseIds) {
  const file = join(STATE, `${caseId}.json`)
  if (!existsSync(file)) continue
  const state = JSON.parse(readFileSync(file, 'utf8'))
  if (state.cookies && state.cookies[COOKIE_NAME]) { console.log(`${caseId}: 已有 cookie，跳过`); continue }
  if (!state.contentId) { console.log(`${caseId}: 无 contentId，跳过`); continue }

  const content = await db.content.findUnique({
    where: { id: state.contentId },
    select: { ownerId: true },
  })
  if (!content) { console.log(`${caseId}: content 不存在，跳过`); continue }
  const identity = await db.identity.findFirst({
    where: { userId: content.ownerId, type: 'session' },
    orderBy: { createdAt: 'asc' },
  })
  if (!identity) { console.log(`${caseId}: 无 session identity，跳过`); continue }

  state.cookies = { [COOKIE_NAME]: identity.secret }
  writeFileSync(file, JSON.stringify(state, null, 2))
  console.log(`${caseId}: cookie 已修复（user ${content.ownerId.slice(0, 8)}）`)
}

// p03 半成品清理（其 cookie 无法恢复 → 重置为全新案例）
const p03 = join(STATE, 'p03-travel.json')
if (existsSync(p03)) {
  const state = JSON.parse(readFileSync(p03, 'utf8'))
  if (state.contentId) {
    // 删除 DB 半成品（无版本 = 未生成过，安全删除；级联清 Intent/Provenance）
    const content = await db.content.findUnique({ where: { id: state.contentId }, include: { versions: true } })
    if (content && content.versions.length === 0) {
      await db.content.delete({ where: { id: state.contentId } })
      console.log(`p03-travel: 半成品 content ${state.contentId} 已清理`)
    }
  }
  writeFileSync(p03, JSON.stringify({ caseId: 'p03-travel', phase: 'init', contentId: null, meta: { text: state.meta?.text }, timeline: {}, elapsed: {}, record: {} }, null, 2))
  console.log('p03-travel: state 已重置')
}

await db.$disconnect()
