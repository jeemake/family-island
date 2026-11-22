"""Generate the game's textures with fal (FLUX dev), tracking spend against a budget.

Run: python3 -I tools/gen_textures.py <raw_out_dir>
Needs FAL_KEY in the environment. Skips textures already downloaded.
"""
import json
import os
import sys
import urllib.request

PRICE_PER_MP = 0.025  # fal-ai/flux/dev, USD per megapixel
BUDGET = 1.00
ENDPOINT = "https://fal.run/fal-ai/flux/dev"

STYLE = ("seamless tileable texture, flat orthographic top-down view, soft even diffuse light, "
         "no shadows, no perspective, architectural illustration rendering style")
TEXTURES = {
    "brick": (1024, f"red orange clay brick wall, running bond, thin light grey mortar, subtle color variation, {STYLE}"),
    "grass": (1024, f"soft fresh green lawn grass seen from directly above, gentle light and dark patches, {STYLE}"),
    "paving": (1024, f"pale salmon pink fine gravel terrazzo paving seen from directly above, tiny speckles, {STYLE}"),
    "sand": (768, f"pale warm beach sand seen from directly above, fine grain, very subtle ripples, {STYLE}"),
    "foliage": (768, f"edge to edge dense mass of small green leaves completely filling the frame, no sky, no gaps, no background, "
                      f"fresh and olive greens, {STYLE}"),
    "fabric_jm": (768, "seamless repeating fabric pattern, hand painted chunky flower blobs in orange, yellow and "
                       "green on teal blue cotton, slightly pixelated knitted texture, flat, even light"),
    "fabric_m": (768, "seamless repeating fabric pattern, hand painted chunky white and golden yellow flowers on "
                      "warm coral orange cotton, slightly pixelated knitted texture, flat, even light"),
}


def generate(prompt, size):
    body = json.dumps({
        "prompt": prompt,
        "image_size": {"width": size, "height": size},
        "num_images": 1,
        "num_inference_steps": 28,
        "enable_safety_checker": True,
    }).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={
        "Authorization": f"Key {os.environ['FAL_KEY']}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["images"][0]["url"]


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    ledger_path = os.path.join(out, "spend.json")
    ledger = json.load(open(ledger_path)) if os.path.exists(ledger_path) else {"total": 0.0, "items": {}}
    for name, (size, prompt) in TEXTURES.items():
        path = os.path.join(out, f"{name}.png")
        if os.path.exists(path):
            print(f"skip {name} (already have it)")
            continue
        cost = size * size / 1e6 * PRICE_PER_MP
        if ledger["total"] + cost > BUDGET:
            print(f"stop: {name} would exceed the ${BUDGET:.2f} budget")
            break
        url = generate(prompt, size)
        urllib.request.urlretrieve(url, path)
        ledger["total"] = round(ledger["total"] + cost, 4)
        ledger["items"][name] = round(cost, 4)
        json.dump(ledger, open(ledger_path, "w"), indent=2)
        print(f"{name}: {size}x{size}  ${cost:.4f}  (total ${ledger['total']:.4f})")
    print(f"TOTAL SPENT: ${ledger['total']:.4f} of ${BUDGET:.2f}")


if __name__ == "__main__":
    main()
