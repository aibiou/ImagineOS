#!/usr/bin/env python3
"""字段面板精确对比度测量：裁剪 divide-y 面板区域（x=258,y=344,w=764,h=112）
测量：背景亮度 / 文字像素亮度 / WCAG 对比度 / 文字可读性判定
"""
from PIL import Image

img = Image.open('/home/z/my-project/download/field-panel-viewport.png').convert('L')
panel = img.crop((258, 344, 258 + 764, 344 + 112))
px = list(panel.getdata())
total = len(px)

# 双峰分析：面板背景 (bg-black/40 ≈ 深黑) vs 文字 (zinc-100 ≈ 244)
dark = [p for p in px if p < 60]
text = [p for p in px if p > 160]
mid = total - len(dark) - len(text)
avg_dark = sum(dark) / len(dark) if dark else 0
avg_text = sum(text) / len(text) if text else 0

def lum(v):
    c = v / 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

l1, l2 = lum(avg_text), lum(avg_dark)
ratio = (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)

print(f"面板区域 764x112 = {total}px")
print(f"背景像素: {len(dark)} ({len(dark)/total*100:.1f}%) 平均亮度 {avg_dark:.0f}/255")
print(f"文字像素: {len(text)} ({len(text)/total*100:.1f}%) 平均亮度 {avg_text:.0f}/255")
print(f"过渡像素: {mid} ({mid/total*100:.1f}%)")
print(f"WCAG 对比度: {ratio:.1f}:1")
print(f"判定: {'✓ AAA (≥7:1) 完全可读' if ratio >= 7 else '✓ AA (≥4.5:1) 可读' if ratio >= 4.5 else '✗ 不足'}")
