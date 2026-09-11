#!/usr/bin/env python3
"""Локальные операции с картинками для scripts/fetch-program-media.js.

На macOS генератор вызывает sips и cwebp. На Windows их нет, а ставить
системные бинарники ради одной сборки нельзя: в проекте нет внешних
зависимостей кроме того, что уже стоит на машине. Python 3 + Pillow
закрывают те же три операции: WebP-спутник, миниатюра, ужатие.

Команды:
  webp   SRC DEST [QUALITY]   — спутник WebP (по умолчанию q=80)
  thumb  SRC DEST WIDTH       — JPEG-миниатюра заданной ширины, q=80
  shrink SRC WIDTH            — ужатие по ширине на месте
  jpeg   SRC DEST [QUALITY]   — PNG → JPEG (альфа плющится на белое)

Альфа в портретах не нужна: и CSS, и вырез круглые. Без плющения Pillow
оставил бы шахматку или раздутый RGBA-WebP.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def open_flat(path: str) -> Image.Image:
    im = Image.open(path)
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    if im.mode != "RGB":
        return im.convert("RGB")
    return im


def resize_width(im: Image.Image, width: int) -> Image.Image:
    if im.width <= width:
        return im
    height = max(1, round(im.height * (width / im.width)))
    return im.resize((width, height), Image.Resampling.LANCZOS)


def cmd_webp(src: str, dest: str, quality: int = 80) -> None:
    im = open_flat(src)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "WEBP", quality=quality, method=6)


def cmd_thumb(src: str, dest: str, width: int) -> None:
    im = resize_width(open_flat(src), width)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=80, optimize=True)


def cmd_shrink(src: str, width: int) -> None:
    im = Image.open(src)
    if im.width <= width:
        return
    flat = open_flat(src)
    out = resize_width(flat, width)
    fmt = "JPEG" if src.lower().endswith((".jpg", ".jpeg")) else im.format or "PNG"
    if fmt == "JPEG":
        out.save(src, "JPEG", quality=82, optimize=True)
    elif fmt == "WEBP":
        out.save(src, "WEBP", quality=80, method=6)
    else:
        out.save(src)


def cmd_jpeg(src: str, dest: str, quality: int = 82) -> None:
    im = open_flat(src)
    Path(dest).parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=quality, optimize=True)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: image-tools.py webp|thumb|shrink|jpeg ...", file=sys.stderr)
        return 2
    cmd, args = argv[0], argv[1:]
    try:
        if cmd == "webp":
            cmd_webp(args[0], args[1], int(args[2]) if len(args) > 2 else 80)
        elif cmd == "thumb":
            cmd_thumb(args[0], args[1], int(args[2]))
        elif cmd == "shrink":
            cmd_shrink(args[0], int(args[1]))
        elif cmd == "jpeg":
            cmd_jpeg(args[0], args[1], int(args[2]) if len(args) > 2 else 82)
        else:
            print("unknown command: " + cmd, file=sys.stderr)
            return 2
    except Exception as exc:  # noqa: BLE001 — CLI, ошибка уходит в stderr
        print(f"{cmd}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
