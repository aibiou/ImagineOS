#!/usr/bin/env python3
"""对比度修复客观验证：对修复前后截图做像素级分析
测量 ConfigCard 字段面板区域的文字亮度 vs 背景亮度（WCAG 相对亮度）。
"""
from PIL import Image

def analyze(path, label):
    img = Image.open(path).convert('L')
    w, h = img.size
    # 全页暗色，取页面中部区域（第一张配置卡字段面板所在区）
    # 字段面板在卡片内、页面垂直约 55%-70% 处（有配置卡时）
    region = img.crop((0, int(h * 0.45), w, int(h * 0.85)))
    px = list(region.getdata())
    total = len(px)
    # 亮度分布：背景（暗）与文字（亮）
    dark = [p for p in px if p < 60]      # 背景像素
    bright = [p for p in px if p > 140]   # 文字/高亮像素
    mid = total - len(dark) - len(bright)
    avg_dark = sum(dark) / len(dark) if dark else 0
    avg_bright = sum(bright) / len(bright) if bright else 0
    # WCAG 对比度（近似：以区域平均暗/亮为两极）
    def lum(v):
        c = v / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    l1, l2 = lum(avg_bright), lum(avg_dark)
    ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    print(f"[{label}] 区域 {w}x{int(h*0.4)}px | 背景均值 {avg_dark:.0f} | 亮部均值 {avg_bright:.0f} | "
          f"亮部占比 {len(bright)/total*100:.1f}% | WCAG 对比度 ≈ {ratio:.1f}:1")

base = '/home/z/my-project/download/'
analyze(base + 'settings-models-with-config.png', '修复前(旧字段 zinc-400/500)')
analyze(base + 'settings-models-contrast-fixed.png', '修复后(zinc-100 面板+dark模式)')
