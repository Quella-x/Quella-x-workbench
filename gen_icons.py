# -*- coding: utf-8 -*-
"""
小筱工作台 图标生成器（v810 起，取代旧的 gen_icons.js）
源图：brand/logo.png（1024×1024，蓝底 #5B9BE8 + 白色海豚）
产出：
  icons/icon-192.png / icon-512.png       —— 整幅原始构图（PWA any）
  icons/icon-maskable-512.png             —— 内容缩到安全区内（maskable）
  APK: res/drawable/ic_launcher.png       —— 512 整幅原始构图

说明：源图内容最大半径 41.55%（安卓自适应图标安全区上限 40%），
      故 maskable 版把整幅图缩到 91.4% 再居中，避免圆形遮罩切到海豚尾尖/筱字笔画。
      原始构图不做任何裁切/重定位（用户明确要求"按原图比例"）。
用法：python gen_icons.py
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'brand', 'logo.png')
APK_ICON = r'D:\wbkey\webview-app\app\src\main\res\drawable\ic_launcher.png'
BG = (91, 155, 232)          # #5B9BE8，与源图底蓝一致
MASKABLE_SCALE = 0.914       # 40% / 41.55% × 0.95 安全余量

src = Image.open(SRC).convert('RGB')


def plain(size):
    """整幅原始构图，仅缩放"""
    return src.resize((size, size), Image.LANCZOS)


def maskable(size):
    """整幅缩到安全区，四周补同色底蓝"""
    inner = int(round(size * MASKABLE_SCALE))
    out = Image.new('RGB', (size, size), BG)
    off = (size - inner) // 2
    out.paste(src.resize((inner, inner), Image.LANCZOS), (off, off))
    return out


def main():
    outdir = os.path.join(HERE, 'icons')
    os.makedirs(outdir, exist_ok=True)
    plain(192).save(os.path.join(outdir, 'icon-192.png'))
    plain(512).save(os.path.join(outdir, 'icon-512.png'))
    maskable(512).save(os.path.join(outdir, 'icon-maskable-512.png'))
    print('web icons ->', outdir)
    if os.path.isdir(os.path.dirname(APK_ICON)):
        plain(512).save(APK_ICON)
        print('apk icon  ->', APK_ICON)
    else:
        print('skip apk icon (dir not found):', APK_ICON)


if __name__ == '__main__':
    main()
