#!/usr/bin/env python3
"""Pack sliced sprite frames into a direction atlas plus a JSON descriptor.

Usage:
    python tools/sprite-atlas/atlas.py <spec.json>

Spec:
    {
      "name": "ranger-boy",
      "tile": 512,
      "columns": 4,
      "pivot": [0.5, 0.9414],
      "items": [
        {"index": 0, "label": "front", "file": "relative/or/absolute.png"}
      ]
    }
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def feet_pivot(frame: Image.Image) -> tuple[int, int]:
    """Anchor under the feet: x from the silhouette centroid of the lowest band."""
    alpha = np.asarray(frame)[..., 3] > 32
    rows = np.where(alpha.any(axis=1))[0]
    if not len(rows):
        return frame.width // 2, frame.height
    bottom = int(rows[-1])
    band = max(4, int(frame.height * 0.06))
    strip = alpha[max(0, bottom - band): bottom + 1]
    xs = np.where(strip.any(axis=0))[0]
    x = int((xs.min() + xs.max()) / 2) if len(xs) else frame.width // 2
    return x, bottom


def load_spec(path: Path) -> dict:
    spec = json.loads(path.read_text(encoding="utf-8"))
    base = path.parent
    for item in spec["items"]:
        f = Path(item["file"])
        item["path"] = f if f.is_absolute() else (base / f)
    return spec


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    spec_path = Path(sys.argv[1])
    spec = load_spec(spec_path)
    tile = int(spec.get("tile", 512))
    columns = int(spec.get("columns", 4))
    items = sorted(spec["items"], key=lambda i: i["index"])

    rows = math.ceil(len(items) / columns)
    atlas = Image.new("RGBA", (columns * tile, rows * tile), (0, 0, 0, 0))
    cells = []

    for position, item in enumerate(items):
        frame = Image.open(item["path"]).convert("RGBA")
        if frame.size != (tile, tile):
            frame = frame.resize((tile, tile), Image.LANCZOS)
        col, row = position % columns, position // columns
        x, y = col * tile, row * tile
        atlas.alpha_composite(frame, (x, y))
        px, py = feet_pivot(frame)
        cells.append({
            "index": item["index"],
            "label": item.get("label", ""),
            "column": col,
            "row": row,
            "rect": [x, y, tile, tile],
            "pivot": [x + px, y + py],
            "pivot_in_tile": [px, py],
        })

    out_dir = spec_path.parent
    image_name = f"{spec['name']}-atlas.png"
    atlas.save(out_dir / image_name)

    descriptor = {
        "name": spec["name"],
        "image": image_name,
        "tile": tile,
        "columns": columns,
        "rows": rows,
        "directions": len(cells),
        "frames": int(spec.get("frames", 1)),
        "index_order": spec.get("index_order", "counter-clockwise"),
        "cells": cells,
    }
    (out_dir / f"{spec['name']}-atlas.json").write_text(
        json.dumps(descriptor, indent=2, ensure_ascii=False), encoding="utf-8")

    debug = atlas.copy()
    draw = ImageDraw.Draw(debug)
    for cell in cells:
        x, y, w, h = cell["rect"]
        draw.rectangle([x, y, x + w - 1, y + h - 1], outline=(255, 0, 255, 180), width=2)
        draw.text((x + 10, y + 8), f'{cell["index"]} {cell["label"]}', fill=(255, 0, 255, 255))
        px, py = cell["pivot"]
        draw.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(0, 255, 255, 255))
    debug.save(out_dir / f"{spec['name']}-atlas-debug.png")

    print(f"{spec['name']}: {len(cells)} directions, {columns}x{rows} tiles, "
          f"atlas {atlas.width}x{atlas.height}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
