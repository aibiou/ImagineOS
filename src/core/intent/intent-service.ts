// Intent 持久化服务（§14–§17）
// AI 层产出的 IntentRecord 在此入库（fieldsJson + interviewJson）并记 Provenance。
// provider/model 只经 aiMeta 白名单进入 Provenance（§34 / 不变量 I4 例外区）。
import { db } from '@/lib/db'
import { NotFoundError, DomainValidationError } from '@/core/errors'
import { provenanceRepo } from '@/core/repositories/provenance-repo'
import { contentRepo } from '@/core/repositories/content-repo'
import { IntentRecordSchema, type IntentRecord } from '@/core/content/schemas'

export const intentService = {
  async getIntent(contentId: string) {
    const row = await db.intent.findFirst({ where: { contentId }, orderBy: { createdAt: 'asc' } })
    return row
  },

  /** 解析已入库的结构化 Intent（脏数据防御：解析失败返回 null） */
  parseRecord(row: { fieldsJson: string | null; interviewJson: string | null }): IntentRecord | null {
    if (!row.fieldsJson) return null
    try {
      return IntentRecordSchema.parse(JSON.parse(row.fieldsJson))
    } catch {
      return null
    }
  },

  async saveExtracted(
    contentId: string,
    record: IntentRecord,
    aiMeta: { provider?: string; model?: string; degraded: boolean; actorId: string },
  ): Promise<void> {
    const intent = await this.getIntent(contentId)
    if (!intent) throw new NotFoundError('意图记录', contentId)

    const fieldsJson = JSON.stringify({
      fields: record.fields,
      sources: record.sources,
      ...(record.interview ? { interview: record.interview } : {}),
    })

    await db.intent.update({
      where: { id: intent.id },
      data: {
        fieldsJson,
        interviewJson: record.interview ? JSON.stringify(record.interview) : null,
      },
    })

    await provenanceRepo.append(db, {
      contentId,
      eventType: 'ai_generated',
      actorType: 'ai',
      provider: aiMeta.provider ?? 'intent-engine',
      model: aiMeta.model ?? 'default',
      payload: {
        stage: 'intent.extract',
        degraded: aiMeta.degraded,
        fields: Object.keys(record.fields),
        userSpecified: Object.entries(record.sources)
          .filter(([, v]) => v === 'user')
          .map(([k]) => k),
      },
    })
  },

  /** 从 Intent 推导用户可读的一句话摘要（创作空间展示用） */
  summarize(record: IntentRecord): string {
    const f = record.fields
    const parts: string[] = [f.topic]
    if (f.duration) parts.push(`约 ${f.duration} 秒`)
    if (f.emotion?.length) parts.push(f.emotion.join('、'))
    if (f.audience) parts.push(f.audience)
    return parts.join(' · ')
  },

  /** 读取创作工作区所需的 Intent 记录（不存在则领域错误） */
  async requireRecord(contentId: string): Promise<IntentRecord> {
    const row = await this.getIntent(contentId)
    if (!row) throw new DomainValidationError('该作品还没有意图记录（先完成一次表达）')
    const record = this.parseRecord(row)
    if (!record) throw new DomainValidationError('意图记录损坏，请重新开始创作')
    return record
  },

  /** 读取原始表达 */
  async requireRawExpression(contentId: string): Promise<string> {
    const row = await this.getIntent(contentId)
    if (!row?.rawExpression) throw new DomainValidationError('该作品还没有原始表达')
    return row.rawExpression
  },

  /** content 概览（供工作区组合） */
  async requireContent(contentId: string) {
    const content = await contentRepo.findById(db, contentId)
    if (!content) throw new NotFoundError('作品', contentId)
    return content
  },
}
