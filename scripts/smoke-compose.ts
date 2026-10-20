// FFmpeg 合成器端到端冒烟：2 镜头（Ken Burns + xfade + TTS 音轨 + 中文字幕 + 封面）
import { composeVideo } from '../src/media/ffmpeg'
import { probeDurationMs, probeImageSize } from '../src/media/ffmpeg'

async function main() {
  console.log('TTS 时长:', await probeDurationMs('/tmp/smoke-tts.wav'))
  console.log('图像尺寸:', await probeImageSize('/tmp/smoke.jpg'))

  const t0 = Date.now()
  const result = await composeVideo({
    shots: [
      {
        imagePath: '/tmp/smoke.jpg',
        durationMs: 5000,
        cameraMotion: 'zoom_in',
        narrationPath: '/tmp/smoke-tts.wav',
        narrationLine: '那年夏天，父亲的手一直没离开过后座。',
      },
      {
        imagePath: '/tmp/smoke.jpg',
        durationMs: 4000,
        cameraMotion: 'pan_right',
      },
    ],
    width: 720,
    height: 1280,
    fps: 25,
    transitionMs: 600,
    narrationLeadMs: 350,
    narrationTailMs: 500,
    subtitles: { lines: [], fontPath: '/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf' },
    outPath: '/tmp/smoke-out.mp4',
    posterPath: '/tmp/smoke-poster.jpg',
    workDir: '/tmp/smoke-compose-work',
  })
  console.log(`合成耗时 ${Date.now() - t0}ms`)
  console.log('结果:', JSON.stringify(result, null, 2))
  console.log('成片时长实测:', await probeDurationMs('/tmp/smoke-poster.jpg'))
}
main().catch((e) => { console.error('失败:', e); process.exit(1) })
