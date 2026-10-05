import { z } from 'zod'

// 环境变量校验（T0.3.1）：缺关键变量在启动/调用早期即报明确错误
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 未配置'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

/** 惰性解析环境变量（避免构建期无 .env 场景误炸） */
export function getEnv(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new Error(`[ImagineOS] 环境配置无效——${issues}`)
    }
    cached = parsed.data
  }
  return cached
}
