// FFmpeg 合成器（ADR-0001 方案 B：组合式视频管线 / T7.1.2 / T5.3.1）
// 编排：分镜图像 → Ken Burns 运镜（zoompan）→ xfade 转场 → TTS 旁白时间线混音
//       （可选 BGM 自动闪避）→ ASS 中文字幕烧制 → H.264 MP4 + 封面帧
//
// 设计要点：
//   - 每步产物独立（segments / audio mix / final / poster），失败可从中间产物续跑
//   - 音画对齐策略：先 ffprobe 实测 TTS 时长 → 镜头时长 = max(配方时长, 旁白+引导+余量)
//     → 视觉起点(xfade 偏移中点) = 旁白延迟起点，保证 ±0.5s 对齐 AC
//   - 全程无 shell 字符串拼接（args 数组 + cwd 隔离，杜绝注入与转义事故）

import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const FFMPEG = process.env.IMAGINEOS_FFMPEG ?? 'ffmpeg'
const FFPROBE = process.env.IMAGINEOS_FFPROBE ?? 'ffprobe'

export interface ComposeShotInput {
  /** 分镜图像绝对路径（首帧；composition 路径的像素源 / native 路径的首帧） */
  imagePath: string
  /** 原生视频段绝对路径（M1.5 Gate 6 native 路径；有此字段时跳过 Ken Burns） */
  videoPath?: string
  /** 配方时长（毫秒）——实际时长会考虑旁白长度取 max */
  durationMs: number
  cameraMotion: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static'
  /** 旁白音频绝对路径（无则该镜头无旁白） */
  narrationPath?: string
  /** 旁白文本（字幕用） */
  narrationLine?: string
}

export interface SubtitleLine {
  text: string
  startMs: number
  endMs: number
}

export interface ComposeSpec {
  shots: ComposeShotInput[]
  width: number
  height: number
  fps: number
  /** 转场时长（毫秒），>= 镜头时长时会自动钳制 */
  transitionMs: number
  /** 旁白相对视觉起点的引导时间（毫秒） */
  narrationLeadMs: number
  /** 旁白结束后额外停留（毫秒） */
  narrationTailMs: number
  subtitles?: { lines: SubtitleLine[]; fontPath: string }
  /** 可选背景音乐（自动闪避：旁白出现时压低） */
  bgm?: { path: string; volume: number }
  outPath: string
  posterPath: string
  workDir: string
}

export interface ComposeResult {
  durationMs: number
  videoPath: string
  posterPath: string
  /** 每个镜头的实际视觉起点（毫秒）——音频对齐的权威值 */
  shotStartMs: number[]
  /** 每个镜头的实际时长（毫秒） */
  shotDurationMs: number[]
}

// ---------- 进程执行 ----------

function run(bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number; label: string }): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve_, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${opts.label} 超时（>${opts.timeoutMs}ms）`))
    }, opts.timeoutMs ?? 300_000)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`${opts.label} 无法启动：${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve_({ stdout, stderr })
      else reject(new Error(`${opts.label} 失败（exit ${code}）：${stderr.slice(-1500)}`))
    })
  })
}

export async function probeDurationMs(path: string): Promise<number | null> {
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path], { label: 'ffprobe' })
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } }
    const sec = Number(parsed.format?.duration)
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null
  } catch {
    return null
  }
}

export async function probeImageSize(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], { label: 'ffprobe' })
    const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> }
    const s = parsed.streams?.[0]
    if (s?.width && s?.height) return { width: s.width, height: s.height }
    return null
  } catch {
    return null
  }
}

// ---------- Ken Burns ----------

function kenBurnsFilter(spec: ComposeSpec, frames: number, motion: ComposeShotInput['cameraMotion']): string {
  const { width: W, height: H, fps } = spec
  const upW = W * 2
  const upH = H * 2
  const d = frames
  const last = Math.max(1, d - 1)
  const centerX = "iw/2-(iw/zoom/2)"
  const centerY = "ih/2-(ih/zoom/2)"
  let z: string
  let x = centerX
  let y = centerY
  switch (motion) {
    case 'zoom_in':
      z = `1+0.15*on/${last}`
      break
    case 'zoom_out':
      z = `max(1.15-0.15*on/${last},1)`
      break
    case 'pan_right':
      z = '1.12'
      x = `(iw-iw/zoom)*on/${last}`
      break
    case 'pan_left':
      z = '1.12'
      x = `(iw-iw/zoom)*(1-on/${last})`
      break
    default:
      z = '1.0'
      break
  }
  return [
    `scale=${upW}:${upH}:force_original_aspect_ratio=increase`,
    `crop=${upW}:${upH}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${d}:s=${W}x${H}:fps=${fps}`,
  ].join(',')
}

// ---------- ASS 字幕 ----------

function assTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10))
  const cs = totalCs % 100
  const totalS = (totalCs - cs) / 100
  const s = totalS % 60
  const m = ((totalS - s) / 60) % 60
  const h = (totalS - s - m * 60) / 3600
  const pad = (n: number, w: number) => String(n).padStart(w, '0')
  return `${pad(h, 1)}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`
}

function escapeAssText(text: string): string {
  return text.replace(/[\\{}]/g, '').replace(/\r?\n/g, ' ').trim()
}

export function buildAssSubtitle(spec: ComposeSpec, fontName = 'Noto Sans SC'): string {
  const { width, height } = spec
  const fontsize = Math.round(width * 0.075) // 720 → 54
  const marginV = Math.round(height * 0.11)
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ImagineOS,${fontName},${fontsize},&H00FFFFFF,&H00FFFFFF,&H96000000,&H96000000,-1,0,0,0,100,100,0,0,3,2,1,2,60,60,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`
  const events = (spec.subtitles?.lines ?? [])
    .filter((l) => l.text.trim().length > 0)
    .map((l) => `Dialogue: 0,${assTime(l.startMs)},${assTime(l.endMs)},ImagineOS,,0,0,0,,${escapeAssText(l.text)}`)
    .join('\n')
  return `${header}${events}\n`
}

// ---------- 主合成 ----------

export async function composeVideo(spec: ComposeSpec): Promise<ComposeResult> {
  const { shots, fps, transitionMs, narrationLeadMs, narrationTailMs } = spec
  if (shots.length === 0) throw new Error('合成需要至少一个镜头')
  await mkdir(spec.workDir, { recursive: true })

  // ---- 1. 实测旁白时长 → 最终镜头时长（音画对齐的根源） ----
  const narrationDurations: Array<number | null> = []
  for (const shot of shots) {
    narrationDurations.push(shot.narrationPath ? await probeDurationMs(shot.narrationPath) : null)
  }
  const finalDurations = shots.map((shot, i) => {
    const narr = narrationDurations[i] ?? null
    const needed = narr !== null ? narr + narrationLeadMs + narrationTailMs : 0
    return Math.max(shot.durationMs, needed)
  })
  // 转场时长不得超过最短镜头的 2/3
  const minDur = Math.min(...finalDurations)
  const trans = Math.min(transitionMs, Math.floor(minDur * 0.66))
  const transFrames = Math.max(0, Math.round((trans / 1000) * fps))
  const transSec = transFrames / fps

  // ---- 2. 帧数与时间线（帧精确） ----
  const framesPerShot = finalDurations.map((ms) => Math.max(fps, Math.round((ms / 1000) * fps)))
  const durSec = framesPerShot.map((f) => f / fps)
  // 视觉起点：镜头 0 从 0 开始；镜头 j 的视觉起点 = xfade 偏移 + 转场中点
  const offsets: number[] = []
  let acc = 0
  for (let j = 1; j < shots.length; j++) {
    acc += durSec[j - 1]!
    offsets.push(acc - j * transSec) // off_j = sum_{k<j} dur_k - j*trans
  }
  const visualStartSec = shots.map((_, j) => (j === 0 ? 0 : offsets[j - 1]! + transSec / 2))
  const totalSec = durSec.reduce((a, b) => a + b, 0) - (shots.length - 1) * transSec
  const totalMs = Math.round(totalSec * 1000)

  // ---- 3. 逐镜头段（composition：Ken Burns；native：视频段标准化） ----
  const segFiles: string[] = []
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!
    const frames = framesPerShot[i]!
    const segPath = `seg_${i}.mp4`
    if (shot.videoPath) {
      // native 路径：视频段 → 统一分辨率/帧率/时长（不足定格补齐，超长截断）
      const targetSec = frames / fps
      await run(
        FFMPEG,
        [
          '-y',
          '-i', shot.videoPath,
          '-filter_complex',
          [
            `scale=${spec.width}:${spec.height}:force_original_aspect_ratio=increase`,
            `crop=${spec.width}:${spec.height}`,
            `fps=${fps}`,
            `tpad=stop_mode=clone:stop_duration=${Math.max(0, targetSec).toFixed(3)}`,
            'format=pix_fmts=yuv420p',
          ].join(','),
          '-frames:v', String(frames),
          '-an', // 音轨由组合层统一编排（TTS 旁白时间线）
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '20',
          '-r', String(fps),
          segPath,
        ],
        { cwd: spec.workDir, label: `nativeseg#seg${i}`, timeoutMs: 120_000 },
      )
    } else {
      // composition 路径：首帧图像 + Ken Burns 运镜
      const vf = kenBurnsFilter(spec, frames, shot.cameraMotion)
      await run(
        FFMPEG,
        [
          '-y',
          '-i', shot.imagePath,
          '-filter_complex', `format=pix_fmts=yuv420p,${vf},fps=${fps}`,
          '-frames:v', String(frames),
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '20',
          '-r', String(fps),
          segPath,
        ],
        { cwd: spec.workDir, label: `kenburns#seg${i}`, timeoutMs: 120_000 },
      )
    }
    segFiles.push(segPath)
  }

  // ---- 4. 音频时间线 ----
  // 旁白 j 起点 = visualStart_j + lead
  const narrationStartMs = shots.map((_, j) => Math.round(visualStartSec[j]! * 1000) + narrationLeadMs)
  const subtitleLines: SubtitleLine[] = []

  const audioInputArgs: string[] = []
  const audioLabels: string[] = []
  let inputIndex = shots.length // 视频输入占了 [0, shots.length)
  for (let j = 0; j < shots.length; j++) {
    const shot = shots[j]!
    const narrDur = narrationDurations[j] ?? null
    if (shot.narrationPath && narrDur !== null) {
      audioInputArgs.push('-i', shot.narrationPath)
      const startMs = narrationStartMs[j]!
      audioLabels.push(`[${inputIndex}:a]adelay=${startMs}:all=1[na${j}]`)
      inputIndex++
      if (shot.narrationLine) {
        subtitleLines.push({
          text: shot.narrationLine,
          startMs,
          endMs: startMs + narrDur,
        })
      }
    }
  }
  // 合并字幕来源（外部直供优先）
  const finalSubtitleLines = spec.subtitles?.lines?.length ? spec.subtitles.lines : subtitleLines

  let bgmInputIndex = -1
  if (spec.bgm) {
    audioInputArgs.push('-stream_loop', '-1', '-i', spec.bgm.path)
    bgmInputIndex = inputIndex
    inputIndex++
  }

  // ---- 5. 视频链（xfade）+ 字幕 + 音频链（amix + 可选闪避 + 对齐总长） ----
  const videoFilters: string[] = []
  if (shots.length === 1) {
    videoFilters.push(`[0:v]setpts=PTS-STARTPTS,fps=${fps}[vout0]`)
  } else {
    let prev = '0:v'
    for (let j = 1; j < shots.length; j++) {
      const outLabel = j < shots.length - 1 ? `vx${j}` : 'vout0'
      videoFilters.push(
        `[${prev}][${j}:v]xfade=transition=fade:duration=${transSec.toFixed(3)}:offset=${offsets[j - 1]!.toFixed(3)}[${outLabel}]`,
      )
      prev = outLabel
    }
  }

  // 字幕烧制（ass 文件放 workDir，文件名简单无转义问题）
  let assFile: string | null = null
  if (finalSubtitleLines.length > 0) {
    assFile = 'subs.ass'
    const fontsDir = resolve(spec.subtitles?.fontPath ?? '/usr/share/fonts/truetype/chinese', '..')
    const ass = buildAssSubtitle({ ...spec, subtitles: { lines: finalSubtitleLines, fontPath: spec.subtitles?.fontPath ?? '' } })
    await writeFile(join(spec.workDir, assFile), ass, 'utf-8')
    videoFilters.push(`[vout0]ass=filename=${assFile}:fontsdir=${fontsDir}[vout]`)
  } else {
    videoFilters.push('[vout0]null[vout]')
  }

  // 音频链
  const audioFilters: string[] = []
  let audioOut = ''
  if (audioLabels.length > 0 || bgmInputIndex >= 0) {
    const mixLabels: string[] = []
    if (audioLabels.length > 0) {
      // 旁白先混合
      audioFilters.push(...audioLabels)
      if (audioLabels.length > 1) {
        audioFilters.push(`${audioLabels.map((_, j) => `[na${j}]`).join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[narrmix]`)
      } else {
        audioFilters.push(`[na0]anull[narrmix]`)
      }
      if (bgmInputIndex >= 0) {
        // BGM 闪避：旁白作 sidechain 压制 BGM，再与旁白混合
        audioFilters.push(`[${bgmInputIndex}:a]volume=${spec.bgm!.volume}[bgmvol]`)
        audioFilters.push(`[bgmvol][narrmix]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=400[bgmduck]`)
        audioFilters.push(`[bgmduck][narrmix]amix=inputs=2:normalize=0:duration=first[bgmplus]`)
        // duration=first：以 BGM（循环无限）为准 → 再 atrim 到视频总长
        audioFilters.push(`[bgmplus]atrim=0:${totalSec.toFixed(3)},apad=whole_dur=${totalSec.toFixed(3)}[aout]`)
      } else {
        audioFilters.push(`[narrmix]apad=whole_dur=${totalSec.toFixed(3)}[aout]`)
      }
      audioOut = '[aout]'
      mixLabels.push('[aout]')
    } else if (bgmInputIndex >= 0) {
      // 仅 BGM
      audioFilters.push(`[${bgmInputIndex}:a]volume=${spec.bgm!.volume},atrim=0:${totalSec.toFixed(3)},apad=whole_dur=${totalSec.toFixed(3)}[aout]`)
      audioOut = '[aout]'
    }
  }

  // ---- 6. 最终合成 ----
  const finalArgs: string[] = ['-y']
  for (const seg of segFiles) finalArgs.push('-i', seg)
  finalArgs.push(...audioInputArgs)
  finalArgs.push(
    '-filter_complex',
    [...videoFilters, ...audioFilters].join(';'),
    '-map', '[vout]',
  )
  if (audioOut) finalArgs.push('-map', audioOut)
  finalArgs.push(
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
  )
  if (audioOut) finalArgs.push('-c:a', 'aac', '-b:a', '160k')
  finalArgs.push('final.mp4')

  await run(FFMPEG, finalArgs, { cwd: spec.workDir, label: 'compose.final', timeoutMs: 600_000 })

  // ---- 7. 封面帧 ----
  await run(
    FFMPEG,
    ['-y', '-ss', '0.6', '-i', 'final.mp4', '-frames:v', '1', '-q:v', '4', 'poster.jpg'],
    { cwd: spec.workDir, label: 'compose.poster', timeoutMs: 60_000 },
  )

  // ---- 8. 搬运产物到目标路径 ----
  const finalPath = resolve(spec.outPath)
  const posterPath = resolve(spec.posterPath)
  await mkdir(resolve(finalPath, '..'), { recursive: true })
  await mkdir(resolve(posterPath, '..'), { recursive: true })
  await run('mv', [join(spec.workDir, 'final.mp4'), finalPath], { label: 'mv.final' })
  await run('mv', [join(spec.workDir, 'poster.jpg'), posterPath], { label: 'mv.poster' })

  return {
    durationMs: totalMs,
    videoPath: finalPath,
    posterPath,
    shotStartMs: visualStartSec.map((s) => Math.round(s * 1000)),
    shotDurationMs: finalDurations,
  }
}

/** 清理工作目录（合成成功后调用；失败时保留现场供续跑/诊断） */
export async function cleanupWorkDir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true })
}
