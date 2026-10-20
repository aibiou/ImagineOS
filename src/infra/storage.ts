// 存储抽象（T7.1.1：对象存储抽象，Alpha 本地磁盘适配器，接口按 S3 语义设计）
// 位置：infra（跨切面基础能力，core 经端口使用，磁盘细节不出现在领域层）
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface StorageAdapter {
  /** 写入对象（content-addressed：key 即存储位置） */
  put(key: string, data: Buffer): Promise<void>
  /** 读取对象 */
  get(key: string): Promise<Buffer>
  exists(key: string): Promise<boolean>
  /** 对象绝对路径（FFmpeg 等本地工具直取文件用） */
  resolvePath(key: string): string
  remove(key: string): Promise<void>
}

const STORAGE_ROOT = resolve(process.env.IMAGINEOS_STORAGE_DIR ?? 'storage/assets')

class DiskStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    // 防路径逃逸：key 只允许 [A-Za-z0-9._-]
    if (!/^[A-Za-z0-9._-]+$/.test(key)) {
      throw new Error(`非法存储 key：${key}`)
    }
    return join(this.root, key)
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.stat(this.path(key))
      return true
    } catch {
      return false
    }
  }

  private async stat(p: string) {
    const { stat } = await import('node:fs/promises')
    return stat(p)
  }

  resolvePath(key: string): string {
    return this.path(key)
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
  }
}

/** 本地磁盘适配器（单例；未来替换为 S3 适配器时实现同接口即可） */
export const diskStorage: StorageAdapter = new DiskStorage(STORAGE_ROOT)

/** 存储根目录（诊断/seed 用） */
export function storageRoot(): string {
  return STORAGE_ROOT
}
