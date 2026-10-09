// VLM 截图盲评（plan-async-022）：验证宽屏布局 + 等待叙事卡渲染
import ZAI from 'z-ai-web-dev-sdk'

const files = [
  ['download/ui-e2e/plan-async-story-stage-wide.png', '故事阶段（宽屏）'],
  ['download/ui-e2e/plan-async-storyboard-stage-wide.png', '分镜阶段（宽屏）'],
]

async function main() {
  const zai = await ZAI.create()
  const { readFile } = await import('node:fs/promises')
  for (const [file, label] of files) {
    const b64 = (await readFile(file)).toString('base64')
    const res = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${b64}` },
            },
            {
              type: 'text',
              text:
                `这是一个 AI 视频创作平台的创作空间页面（${label}）。请回答三个问题，每题单独一行，格式「题号. 结论+一句依据」：` +
                `1. 页面主体内容是否利用了宽屏空间（主体内容区是否明显宽于 800px、两侧是否没有大片空白）？` +
                `2. 内容卡片是否为多列布局（场景/镜头卡片是否并排成网格）？` +
                `3. 页面内容是否为结构化的故事/分镜信息（有无明显 UI 破版、文字溢出、控件重叠）？`,
            },
          ],
        },
      ],
      temperature: 0.2,
    })
    console.log(`\n=== ${label}（${file}） ===`)
    console.log(res.choices[0]?.message?.content ?? '(无输出)')
  }
}

main().catch((e) => {
  console.error('VLM 盲评失败：', e instanceof Error ? e.message : e)
  process.exit(1)
})
