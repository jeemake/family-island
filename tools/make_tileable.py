"""Turn the raw generated images into small, seamless game textures.

Run: python3 tools/make_tileable.py <raw_dir> <out_dir>
- flattens large lighting gradients (high-pass around the mean colour)
- hides the wrap seam by cross-blending with a half-shifted copy
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

# name: (output size, flatten radius as a fraction of the width, or 0 to keep the lighting)
SPECS = {
    "brick": (512, 0),
    "grass": (512, 1 / 40),   # strong: the raw image has broad light bands
    "paving": (512, 1 / 10),
    "sand": (512, 1 / 10),
    "foliage": (512, 1 / 10),
    "fabric_jm": (512, 0),
    "fabric_m": (512, 0),
}

SOFTEN = {"grass": 0.4, "foliage": 0.75}
# Shift the average colour to the reference's soft, pale greens.
TARGET_MEAN = {"grass": (158, 196, 128), "foliage": (120, 165, 88)}


def flatten(img, frac):
    a = np.asarray(img, dtype=np.float32)
    blur = np.asarray(img.filter(ImageFilter.GaussianBlur(img.width * frac)), dtype=np.float32)
    out = a - blur + blur.mean(axis=(0, 1))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def tileable(img):
    a = np.asarray(img, dtype=np.float32)
    h, w = a.shape[:2]
    shifted = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    # Weight 1 in the middle, 0 at the borders: the borders come from the shifted copy,
    # whose own edges are the original's continuous centre.
    y = 1 - np.abs(np.linspace(-1, 1, h))
    x = 1 - np.abs(np.linspace(-1, 1, w))
    wgt = np.clip(np.minimum.outer(y, x) * 3, 0, 1)[..., None]
    out = a * wgt + shifted * (1 - wgt)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def main():
    raw, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for name, (size, frac) in SPECS.items():
        img = Image.open(os.path.join(raw, f"{name}.png")).convert("RGB")
        if frac:
            img = flatten(img, frac)
        img = tileable(img)
        if name in SOFTEN:  # pull towards the mean colour for a soft, painted look
            a = np.asarray(img, dtype=np.float32)
            mean = a.mean(axis=(0, 1))
            target = np.array(TARGET_MEAN.get(name, mean), dtype=np.float32)
            img = Image.fromarray(np.clip(target + (a - mean) * SOFTEN[name], 0, 255).astype(np.uint8))
        img = img.resize((size, size), Image.LANCZOS)
        img.save(os.path.join(out, f"{name}.jpg"), quality=86)
        print("wrote", name)


if __name__ == "__main__":
    main()
