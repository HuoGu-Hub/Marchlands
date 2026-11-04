#!/usr/bin/env python3
"""Slice generated reference sheets into game-ready sprite frames.

Usage:
    python tools/sprite-slice/slice.py <file-or-dir> [more...] --out <dir> [--size 512]

Steps per image: trim white canvas bands, key the flat background by flood
fill from the border, split into panels by empty columns, crop each panel to
its content box, then place it on a square canvas with the feet anchored.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

WHITE = 240
KEY = (255, 0, 254)


def trim_white_bands(im: Image.Image) -> Image.Image:
    a = np.asarray(im.convert("RGB"))
    h, w = a.shape[:2]
    white = (a > WHITE).all(axis=2)

    top, bottom, left, right = 0, h, 0, w
    # A watermark sits inside the white band, so a few percent of non-white
    # pixels per row is normal. Never trim more than a fifth of the canvas.
    limit = 0.90
    while top < h and white[top].mean() > limit:
        top += 1
    while bottom > top and white[bottom - 1].mean() > limit:
        bottom -= 1
    while left < w and white[top:bottom, left].mean() > limit:
        left += 1
    while right > left and white[top:bottom, right - 1].mean() > limit:
        right -= 1
    if top > h * 0.2:
        top = 0
    if h - bottom > h * 0.2:
        bottom = h
    if left > w * 0.2:
        left = 0
    if w - right > w * 0.2:
        right = w
    return im.crop((left, top, right, bottom))


def key_background(im: Image.Image, thresh: int = 0, dehalo: int = 2):
    rgb = im.convert("RGB")
    w, h = rgb.size
    arr = np.asarray(rgb).astype(np.int16)
    ring = np.concatenate([arr[0:2].reshape(-1, 3), arr[-2:].reshape(-1, 3),
                           arr[:, 0:2].reshape(-1, 3), arr[:, -2:].reshape(-1, 3)])
    bg_median = np.median(ring, axis=0)
    if thresh <= 0:
        spread = np.abs(ring - bg_median).max(axis=1)
        thresh = int(np.clip(np.percentile(spread, 99.5) + 4, 6, 26))
    # Absolute distance to the median background, not a seed-relative flood fill:
    # the canvas has a faint gradient that a seed comparison would slowly drift out of.
    distance = np.abs(arr - bg_median).max(axis=2)
    candidate = distance <= thresh

    # Only background reachable from the border counts. Enclosed patches are
    # light-coloured parts of the subject, not background.
    labels, count = ndimage.label(candidate)
    bg = np.zeros_like(candidate)
    if count:
        border_labels = np.unique(np.concatenate([
            labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1],
        ]))
        border_labels = border_labels[border_labels > 0]
        if border_labels.size:
            bg = np.isin(labels, border_labels)

    foreground = ~bg
    bg_color = bg_median

    alpha = (foreground * 255).astype(np.uint8)
    alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0)))

    # Generated sheets often carry a soft glow or shadow halo a few pixels wide.
    # Keep alpha only next to the opaque core so the halo cannot survive.
    if dehalo > 0:
        core = alpha >= 230
        allowed = ndimage.binary_dilation(core, iterations=dehalo)
        alpha = np.where(allowed, alpha, 0).astype(np.uint8)

    # Droppings of smoke, paint speckle or stray shadow far from the body.
    solid = alpha > 32
    islands, island_count = ndimage.label(solid)
    if island_count > 1:
        sizes = ndimage.sum(solid, islands, range(1, island_count + 1))
        keep = sizes >= max(64, sizes.max() * 0.05)
        alpha = np.where(np.isin(islands, np.where(keep)[0] + 1), alpha, 0).astype(np.uint8)

    src = np.asarray(rgb).astype(np.float32)
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    safe = np.clip(a, 0.05, 1.0)
    color = (src - (1.0 - a) * bg_color[None, None, :]) / safe
    color = np.where(a > 0.02, color, 0)
    color = np.clip(color, 0, 255).astype(np.uint8)

    out = np.dstack([color, alpha])
    return Image.fromarray(out), tuple(int(c) for c in bg_color)


def drop_small_islands(panel: Image.Image, ratio: float) -> Image.Image:
    data = np.asarray(panel)
    solid = data[..., 3] > 32
    labels, count = ndimage.label(solid)
    if count <= 1:
        return panel
    sizes = ndimage.sum(solid, labels, range(1, count + 1))
    keep = sizes >= sizes.max() * ratio
    mask = np.isin(labels, np.where(keep)[0] + 1)
    out = data.copy()
    out[..., 3] = np.where(mask, out[..., 3], 0)
    return Image.fromarray(out)


def find_panels(foreground: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    cols = foreground.any(axis=0)
    runs, start = [], None
    for x, filled in enumerate(cols):
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            runs.append((start, x))
            start = None
    if start is not None:
        runs.append((start, len(cols)))

    merged = []
    for run in runs:
        if merged and run[0] - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], run[1])
        else:
            merged.append(run)

    min_width = max(24, int(len(cols) * 0.04))
    return [r for r in merged if r[1] - r[0] >= min_width]


def place_on_canvas(
    panel: Image.Image, size: int, pad: float, scale: float | None = None
) -> tuple[Image.Image, dict]:
    bbox = panel.getbbox()
    panel = panel.crop(bbox)
    w, h = panel.size
    target = max(1, int(size * (1 - 2 * pad)))
    if scale is None:
        scale = min(target / w, target / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = panel.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - nw) // 2
    y = size - int(size * pad) - nh
    canvas.alpha_composite(resized, (x, y))

    meta = {
        "source_box": [bbox[0], bbox[1], bbox[0] + w, bbox[1] + h],
        "source_size": [w, h],
        "placed": [x, y, nw, nh],
        "foot_y": y + nh,
        "height_ratio": round(nh / size, 4),
    }
    return canvas, meta


def checkerboard(size: int, cell: int = 16) -> Image.Image:
    board = Image.new("RGB", (size, size), (232, 232, 232))
    draw = ImageDraw.Draw(board)
    for yy in range(0, size, cell):
        for xx in range(0, size, cell):
            if (xx // cell + yy // cell) % 2:
                draw.rectangle([xx, yy, xx + cell - 1, yy + cell - 1], fill=(204, 204, 204))
    return board


def build_preview(frames: list[Image.Image], size: int) -> Image.Image:
    if not frames:
        return Image.new("RGB", (size, size), (240, 240, 240))
    sheet = Image.new("RGB", (size * len(frames), size), (240, 240, 240))
    for i, frame in enumerate(frames):
        sheet.paste(checkerboard(size), (i * size, 0))
        sheet.paste(frame, (i * size, 0), frame)
    return sheet


def process(path: Path, out_dir: Path, size: int, pad: float, thresh: int, dehalo: int, columns: int) -> dict:
    raw = Image.open(path)
    trimmed = trim_white_bands(raw)
    keyed, bg_color = key_background(trimmed, thresh=thresh, dehalo=dehalo)
    alpha = np.asarray(keyed)[..., 3] > 8
    if columns > 0:
        # 名义等分点可能正好切在相邻人像的披风上，就近找一列空白最多的位置下刀。
        coverage = alpha.sum(axis=0)
        cuts = [0]
        step = keyed.width / columns
        for i in range(1, columns):
            nominal = round(i * step)
            window = range(max(1, nominal - 40), min(keyed.width - 1, nominal + 40))
            best = min(window, key=lambda x: int(coverage[x]))
            cuts.append(best)
        cuts.append(keyed.width)
        panels = [(cuts[i], cuts[i + 1]) for i in range(columns)]
    else:
        panels = find_panels(alpha, min_gap=max(12, keyed.width // 120))

    # Drop short leftovers such as watermark glyphs that survived the trim.
    boxes = []
    for x0, x1 in panels:
        rows = np.where(alpha[:, x0:x1].any(axis=1))[0]
        if len(rows):
            boxes.append((x0, x1, int(rows[0]), int(rows[-1])))
    if boxes:
        tallest = max(b[3] - b[2] + 1 for b in boxes)
        boxes = [b for b in boxes if (b[3] - b[2] + 1) >= 0.25 * tallest]
    panels = [(b[0], b[1]) for b in boxes]

    stem = path.stem
    target = out_dir / stem
    target.mkdir(parents=True, exist_ok=True)

    crops = []
    for x0, x1 in panels:
        box = keyed.crop((x0, 0, x1, keyed.height))
        bounds = box.getbbox()
        box = box.crop(bounds) if bounds else box
        # 相邻人像越界过来的披风碎片要丢掉，否则会飘在本帧旁边。
        if columns > 0:
            box = drop_small_islands(box, 0.15)
        crops.append(box)

    # 按列切分时用同一个缩放系数，否则抬脚帧会被放大，播起来会一胀一缩。
    common_scale = None
    if columns > 0 and crops:
        tallest = max(c.height for c in crops)
        common_scale = (size * (1 - 2 * pad)) / tallest if tallest else None

    frames, entries = [], []
    for index, box in enumerate(crops, start=1):
        frame, meta = place_on_canvas(box, size, pad, common_scale)
        name = f"{stem}-p{index:02d}.png"
        frame.save(target / name)
        frames.append(frame)
        entries.append({"panel": index, "file": name, **meta})

    preview = build_preview(frames, size)
    preview.save(target / f"{stem}-preview.png")

    return {
        "source": str(path),
        "trimmed_size": list(trimmed.size),
        "background": list(bg_color),
        "panels": len(panels),
        "frames": entries,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("--out", required=True)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--pad", type=float, default=0.06)
    parser.add_argument("--columns", type=int, default=0,
                        help="split into this many equal columns instead of detecting panels")
    parser.add_argument("--dehalo", type=int, default=2,
                        help="pixels of halo to drop around the opaque core; 0 disables")
    parser.add_argument("--thresh", type=int, default=0,
                        help="background key tolerance; 0 derives it from border noise")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    files: list[Path] = []
    for item in args.inputs:
        p = Path(item)
        if p.is_dir():
            files += sorted(q for q in p.iterdir() if q.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
        else:
            files.append(p)

    report = []
    for path in files:
        result = process(path, out_dir, args.size, args.pad, args.thresh, args.dehalo, args.columns)
        report.append(result)
        print(f"{path.name}: {result['panels']} panel(s), bg={result['background']}, "
              f"trimmed={result['trimmed_size']}")

    (out_dir / "manifest.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
