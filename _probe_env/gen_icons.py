# -*- coding: utf-8 -*-
"""
小筱工作台 图标生成器（v810 起，取代旧的 gen_icons.js；v812 起补齐 Android 自适应图标）
源图：D:/图/logo小筱/logo2 9.png（3085×3085，蓝底 #7AB5F5 + 白色海豚）
      生成品牌基准 brand/logo.png（1024×1024）后统一派生所有尺寸。

产出：
  网页 / PWA
    icons/icon-192.png                  整幅原始构图
    icons/icon-512.png                  整幅原始构图
    icons/icon-maskable-512.png         内容缩到安全区内（maskable）
  APK（D:\\wbkey\\webview-app\\app\\src\\main\\res）
    drawable/ic_launcher.png            512 整幅（开屏 Java 引用 + Android 7 回退）
    drawable-xxxhdpi/ic_launcher_foreground.png   108dp 网格前景（内容缩到安全区，透明底）
    mipmap-mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi/ic_launcher.png(+_round)  48/72/96/144/192 满幅
    mipmap-anydpi-v26/ic_launcher.xml(+_round)    自适应图标（背景 @color/ic_launcher_background）

为什么 v812 要补 mipmap 自适应图标：
  Android 8+ 桌面对"非自适应图标"（只有一张 drawable 位图）会沿用系统图标缓存，
  换图后桌面经常仍显示旧图标。补齐 mipmap + adaptive-icon 后，图标作为标准自适应
  图标渲染，资源指纹变化，桌面会立即刷新为新图标。

用法：python gen_icons.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_RAW = r'D:\图\logo小筱\logo2 9.png'          # 用户提供的高清源图（v813 起改用 logo2 9，蓝底更浅）
BRAND = os.path.join(HERE, 'brand', 'logo.png')   # 品牌基准（1024）
APK_RES = r'D:\wbkey\webview-app\app\src\main\res'

BG = (122, 181, 245)         # #7AB5F5，与源图底蓝一致（v813 由 #5B9BE8 换成更浅的这版）
MASKABLE_SCALE = 0.914       # 内容最大半径 41.55% → 缩到 40% 安全圆内并留余量
# 自适应图标前景：108dp 网格里安全可视圆仅 66dp（61.1%），
# 内容原占 83.1% → 缩放 61.1%*0.93/83.1% ≈ 0.684，取 0.69 居中
ADAPTIVE_FG_SCALE = 0.69

# mipmap 各档边长（mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi）
MIPMAP_SIZES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}


def load_source():
    """优先用用户高清源图缩成品牌基准；缺源图时退回已有 brand/logo.png"""
    base = None
    if os.path.exists(SRC_RAW):
        raw = Image.open(SRC_RAW).convert('RGB')
        base = raw.resize((1024, 1024), Image.LANCZOS)
        os.makedirs(os.path.dirname(BRAND), exist_ok=True)
        base.save(BRAND)
        print('brand base ->', BRAND, '(from', os.path.basename(SRC_RAW) + ')')
    elif os.path.exists(BRAND):
        base = Image.open(BRAND).convert('RGB')
        print('brand base ->', BRAND, '(kept)')
    if base is None:
        raise SystemExit('no source: 需要 %s 或 %s' % (SRC_RAW, BRAND))
    return base


def plain(src, size):
    """整幅原始构图，仅缩放（不做任何裁切/重定位）"""
    return src.resize((size, size), Image.LANCZOS)


def maskable(src, size):
    """整幅缩到安全区，四周补同色底蓝"""
    inner = int(round(size * MASKABLE_SCALE))
    out = Image.new('RGB', (size, size), BG)
    off = (size - inner) // 2
    out.paste(src.resize((inner, inner), Image.LANCZOS), (off, off))
    return out


def adaptive_fg(src, size):
    """108dp 前景层：透明底 + 内容缩到安全区居中"""
    inner = int(round(size * ADAPTIVE_FG_SCALE))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    off = (size - inner) // 2
    out.paste(src.resize((inner, inner), Image.LANCZOS).convert('RGBA'), (off, off))
    return out


ADAPTIVE_XML = '''<?xml version="1.0" encoding="utf-8"?>
<!-- v812：自适应图标（Android 8+）。背景 = app 图标自身蓝底，前景 = 白色海豚+筱字。 -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
'''


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def main():
    src = load_source()

    # ---- 网页 / PWA ----
    outdir = os.path.join(HERE, 'icons')
    os.makedirs(outdir, exist_ok=True)
    plain(src, 192).save(os.path.join(outdir, 'icon-192.png'))
    plain(src, 512).save(os.path.join(outdir, 'icon-512.png'))
    maskable(src, 512).save(os.path.join(outdir, 'icon-maskable-512.png'))
    print('web icons ->', outdir)

    if not os.path.isdir(APK_RES):
        print('skip apk icons (res dir not found):', APK_RES)
        return

    # ---- APK：drawable 满幅（开屏引用 + 旧系统回退）----
    drawable = os.path.join(APK_RES, 'drawable')
    os.makedirs(drawable, exist_ok=True)
    plain(src, 512).save(os.path.join(drawable, 'ic_launcher.png'))
    print('apk drawable ->', os.path.join(drawable, 'ic_launcher.png'))

    # ---- APK：自适应前景（108dp = xxxhdpi 432px）----
    fg_dir = os.path.join(APK_RES, 'drawable-xxxhdpi')
    os.makedirs(fg_dir, exist_ok=True)
    adaptive_fg(src, 432).save(os.path.join(fg_dir, 'ic_launcher_foreground.png'))
    print('apk foreground ->', os.path.join(fg_dir, 'ic_launcher_foreground.png'))

    # ---- APK：mipmap 各档（满幅，供 Android 7 及回退）----
    for dens, size in MIPMAP_SIZES.items():
        d = os.path.join(APK_RES, 'mipmap-' + dens)
        os.makedirs(d, exist_ok=True)
        img = plain(src, size)
        img.save(os.path.join(d, 'ic_launcher.png'))
        img.save(os.path.join(d, 'ic_launcher_round.png'))
    print('apk mipmap -> 5 densities (48/72/96/144/192)')

    # ---- APK：自适应图标 XML ----
    anydpi = os.path.join(APK_RES, 'mipmap-anydpi-v26')
    write(os.path.join(anydpi, 'ic_launcher.xml'), ADAPTIVE_XML)
    write(os.path.join(anydpi, 'ic_launcher_round.xml'), ADAPTIVE_XML)
    print('apk adaptive ->', anydpi)


if __name__ == '__main__':
    main()
