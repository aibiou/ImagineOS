// VLM 截图盲评（progress-visibility-023）：验证生成阶段「过程可见」的视觉呈现
// 三问：①逐镜卡片网格与状态角标 ②Lightbox 大图/视频播放器 ③无破版
import ZAI from 'z-ai-web-dev-sdk'

const files = [
  ['download/ui-e2e/progress-video-grid.png', '生成进行中（逐镜卡片网格）'],
  ['download/ui-e2e/progress-video-lightbox.png', '单镜 Lightbox（AI 视频点播）'],
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
                `这是一个 AI 视频创作平台「生成镜头画面与 AI 视频」进行中的页面（${label}）。请回答三个问题，每题单独一行，格式「题号. 结论+一句依据」：` +
                `1. 镜头卡片是否为多列网格，且每张卡片上有清晰可读的状态角标（如「AI 视频」「视频生成中」「画面生成中」「画面已就绪」）？` +
                `2. ${label.includes('Lightbox') ? '弹窗内是否呈现了视频播放器（带播放控件的视频画面）与镜头信息（景别/运镜/台词等）？' : '页面是否显示进度统计（画面 N/N、AI 视频 N/N、配音 N/N）与已耗时/等待提示文字？'}` +
                `3. 有无明显 UI 破版（文字溢出、控件重叠、卡片错位、空白异常）？`,
            },
          ],
        },
      ],
    })
    const answer = res.choices?.[0]?.message?.content ?? ''
    console.log(`\n=== ${label} ===`)
    console.log(answer)
  }
}

main().catch((e) => {
  console.error('VLM 盲评失败：', e.message)
  process.exit(1)
})
