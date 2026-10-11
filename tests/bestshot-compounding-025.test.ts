// bestshot-compounding-025 收编版回归测试
// 历史：本文件原测平行实现 src/core/generation/best-shot.ts（已删除）。
// 正向复利（高分范例 few-shot）由 exemplar-service.topPromptsForTeaching + exemplarTeachingSection 落地
// （exemplar-service.test.ts 已覆盖）；本文件锁定收编后的负向复利与双向注入：
//   §4 缺陷记忆：image.gate 事件解析 → 复发聚合 → 中文清单/英文约束两个注入面 + DB 读回通道
//   §3.2 generateStoryboard：system 范例教学段 + user 缺陷规避清单（双通道共存）
// 冷却递增/熔断（escalatedCooldownMs / rateCooldownSnapshot）暂缓收编——生产以 video-pacer
// 节奏化提交 + 固定冷却轮转 + 诚实失败应对供给墙（决策记录见 worklog）。
// 铁律：fake provider / 直接 DB 造数，绝不触网。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { userRepo } from '@/core/repositories/user-repo'
import { contentService } from '@/core/content/content-service'
import { clearRegistry, registerProvider } from '@/ai/router/registry'
import type { ProviderCallContext, TextPlanProvider } from '@/ai/router/types'
import { generateStoryboard } from '@/ai/planning/story'
import type { IntentRecord, StorySnapshot } from '@/core/content/schemas'
import {
  parseGateReviews,
  aggregateDefectMemory,
  defectMemoryFragment,
  learnedAvoidanceFragment,
  avoidanceClausesFor,
  loadDefectMemory,
  DEFECT_MEMORY_MIN_COUNT,
} from '@/core/quality/defect-memory'

afterEach(() => {
  clearRegistry()
})

// ---------------- §4 缺陷记忆（纯函数） ----------------

describe('parseGateReviews：image.gate 事件 → 评审记录', () => {
  const mkRow = (payload: Record<string, unknown>, at = new Date()) => ({
    payloadJson: JSON.stringify(payload),
    createdAt: at,
  })

  it('合法行解析（含 skipped/score 口径）；skipped（评审缺席）保留但不构成缺陷证据', () => {
    const rows = [
      mkRow({ stage: 'image.gate', shotIndex: 0, pass: true, skipped: false, score: 9, issues: [] }),
      mkRow({ stage: 'image.gate', shotIndex: 1, pass: false, skipped: false, score: 3, issues: ['画面出现文字或水印'] }),
      mkRow({ stage: 'image.gate', shotIndex: 2, pass: true, skipped: true, score: null, issues: [], attempts: 1 }),
    ]
    const records = parseGateReviews(rows)
    expect(records).toHaveLength(3)
    expect(records[1]!.issues).toEqual(['画面出现文字或水印'])
    expect(records[2]!.skipped).toBe(true)
  })
  it('非 image.gate 事件 / 脏 JSON / 缺 shotIndex / 缺 pass 一律跳过', () => {
    const rows = [
      mkRow({ stage: 'mode.decision', mode: 'hybrid' }),
      { payloadJson: '{broken json', createdAt: new Date() },
      { payloadJson: null, createdAt: new Date() },
      mkRow({ stage: 'image.gate', score: 8, pass: true }), // 缺 shotIndex
      mkRow({ stage: 'image.gate', shotIndex: 0, score: 8 }), // 缺 pass
    ]
    expect(parseGateReviews(rows)).toHaveLength(0)
  })
})

describe('aggregateDefectMemory：复发性缺陷（出现 ≥2 次）', () => {
  const fail = (issues: string[]) => ({
    shotIndex: 0, pass: false, skipped: false, score: 3, issues, createdAt: new Date(),
  })
  it('跨评审频次聚合；一次性缺陷过滤；排序频次降序', () => {
    const memory = aggregateDefectMemory([
      fail(['画面出现文字或水印']),
      fail(['画面出现文字或水印', '人物与锚点不符']),
      fail(['人物与锚点不符']),
      fail(['构图偏空']), // 只出现 1 次 → 非复发
    ])
    expect(memory).toHaveLength(2)
    expect(memory[0]).toEqual({ issue: '画面出现文字或水印', count: 2 }) // 同 2 次 → 稳定序（先入先出）
    expect(memory.map((m) => m.issue)).toContain('人物与锚点不符')
    expect(memory.map((m) => m.issue)).not.toContain('构图偏空')
  })
  it('同一评审内重复 issue 去重（1 次）；pass/skipped 的评审不参与缺陷统计', () => {
    expect(aggregateDefectMemory([fail(['构图偏空', '构图偏空'])])).toHaveLength(0)
    expect(
      aggregateDefectMemory([
        { shotIndex: 0, pass: true, skipped: false, score: 9, issues: ['画面出现文字或水印'], createdAt: new Date() },
        { shotIndex: 1, pass: false, skipped: true, score: null, issues: ['画面出现文字或水印'], createdAt: new Date() },
      ]),
    ).toHaveLength(0)
    expect(DEFECT_MEMORY_MIN_COUNT).toBe(2)
  })
})

describe('defectMemoryFragment / learnedAvoidanceFragment / avoidanceClausesFor', () => {
  it('中文清单含频次；空 → 空串', () => {
    const frag = defectMemoryFragment([{ issue: '画面出现文字或水印', count: 3 }])
    expect(frag).toContain('画面出现文字或水印')
    expect(frag).toContain('3 次')
    expect(defectMemoryFragment([])).toBe('')
  })
  it('英文负面约束复用质量门同款翻译；无映射缺陷诚实跳过', () => {
    const frag = learnedAvoidanceFragment([{ issue: '画面出现文字或水印', count: 2 }])
    expect(frag).toContain('Studio-learned constraints')
    expect(frag).toContain('no text, no watermark')
    // 「构图偏空」无英文映射 → 不产出执行层约束
    expect(learnedAvoidanceFragment([{ issue: '构图偏空', count: 2 }])).toBe('')
    expect(learnedAvoidanceFragment([])).toBe('')
  })
  it('avoidanceClausesFor：水印类 → no text 子句；人物类 → 锚点约束；空 → 空数组', () => {
    expect(avoidanceClausesFor(['画面出现文字或水印']).join('; ')).toContain('no text, no watermark')
    expect(avoidanceClausesFor(['人物与锚点不符']).join('; ')).toContain('strictly match the described appearance')
    expect(avoidanceClausesFor([])).toEqual([])
  })
})

// ---------------- §4 loadDefectMemory（DB 读回通道，零触网） ----------------

describe('loadDefectMemory：Provenance quality-gate 事件读回', () => {
  beforeEach(async () => {
    // 测试库持久跨运行：先清 quality-gate 事件，隔离历史残留（含本套件自身上一次运行）
    await db.provenance.deleteMany({ where: { model: 'quality-gate' } })
  })

  it('复发失败 issue（≥2 次）→ 记忆；一次性/通过/缺席评审不入选；脏行容错', async () => {
    const { user } = await userRepo.createSessionUser(db)
    const c = await contentService.startCreation({ ownerId: user.id, text: '缺陷记忆读回走查' })
    const qg = (payload: Record<string, unknown>) =>
      db.provenance.create({
        data: {
          contentId: c.id,
          eventType: 'ai_generated',
          actorType: 'ai',
          provider: 'pipeline',
          model: 'quality-gate',
          payloadJson: JSON.stringify({ stage: 'image.gate', ...payload }),
        },
      })
    await qg({ shotIndex: 0, pass: false, skipped: false, score: 3, attempts: 2, issues: ['画面出现文字或水印'] })
    await qg({ shotIndex: 1, pass: false, skipped: false, score: 4, attempts: 2, issues: ['画面出现文字或水印'] })
    await qg({ shotIndex: 2, pass: false, skipped: false, score: 4, attempts: 1, issues: ['构图偏空'] }) // 一次性
    await qg({ shotIndex: 3, pass: true, skipped: false, score: 9, attempts: 1, issues: [] }) // 通过
    await qg({ shotIndex: 4, pass: true, skipped: true, score: null, attempts: 1, issues: [] }) // 评审缺席
    await db.provenance.create({
      data: { contentId: c.id, eventType: 'ai_generated', actorType: 'system', provider: 'pipeline', model: 'quality-gate', payloadJson: '{broken' },
    })
    const memory = await loadDefectMemory()
    expect(memory).toEqual([{ issue: '画面出现文字或水印', count: 2 }])
  })
  it('无任何评审 → 空记忆（复利缺席零注入）', async () => {
    expect(await loadDefectMemory()).toEqual([])
  })
})

// ---------------- §3.2 generateStoryboard 双向注入 ----------------

describe('generateStoryboard：system 范例教学段 + user 缺陷规避清单', () => {
  it('opts 传入 → system 含高分写法范例与节奏语法，user 含规避清单（fake provider 捕获）', async () => {
    let capturedUser = ''
    let capturedSystem = ''
    clearRegistry()
    const fakeLlm: TextPlanProvider = {
      id: 'fake-llm-025',
      capability: 'text.plan',
      model: 'fake-llm',
      async execute(payload) {
        capturedUser = payload.user
        capturedSystem = payload.system
        return {
          text: JSON.stringify({
            scenes: [
              {
                index: 0,
                shots: [
                  {
                    index: 0,
                    visualDescription: '大远景：暮色中的老巷口',
                    imagePrompt: 'A quiet old alley at dusk seen from far away, long shadows, cinematic',
                    shotSize: 'extreme_wide',
                    cameraMotion: 'static',
                    charactersInShot: [],
                    durationMs: 5000,
                  },
                ],
              },
            ],
          }),
        }
      },
    }
    registerProvider(fakeLlm)

    const intent = { fields: { topic: '复利注入', duration: 45 } } as unknown as IntentRecord
    const story = {
      logline: 'A story for compounding test',
      scenes: [{ index: 0, shots: [] }],
      lookBook: 'warm amber',
    } as unknown as StorySnapshot
    const ctx: ProviderCallContext = { contentId: 'test-content', versionId: null, purpose: 'test' }

    await generateStoryboard(
      intent,
      { name: '方向', oneLiner: '一句话' },
      story,
      ctx,
      {
        exemplarPrompts: [{ imagePrompt: 'close-up of a brass thimble, warm amber lamplight, cinematic', score: 9 }],
        defectMemory: [{ issue: '画面出现文字或水印', count: 3 }],
      },
    )
    // 正向复利：范例教学段进 system（写法遗传）
    expect(capturedSystem).toContain('已验证的高分写法范例')
    expect(capturedSystem).toContain('brass thimble')
    // 负向复利：规避清单进 user（编剧层看得见的约束）
    expect(capturedUser).toContain('历史高频缺陷规避清单')
    expect(capturedUser).toContain('画面出现文字或水印')
    // 024 手法库仍在 system（共存不互斥）
    expect(capturedSystem).toContain('8–12 秒')
    // 空上下文调用不注入（向后兼容：无范例无记忆时 prompt 与旧版一致）
    await generateStoryboard(intent, { name: '方向', oneLiner: '一句话' }, story, ctx)
    expect(capturedUser).not.toContain('历史高频缺陷规避清单')
    expect(capturedSystem).not.toContain('已验证的高分写法范例')
  })
})
