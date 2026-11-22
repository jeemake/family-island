"""Generate the game's music and sound effects with ElevenLabs.

Run: ELEVENLABS_API_KEY=... python3 -I tools/gen_audio.py <out_dir> [name ...]
Skips files that already exist; logs credits used per item (from the subscription endpoint).
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.elevenlabs.io/v1"
KEY = os.environ["ELEVENLABS_API_KEY"]

MUSIC = {
    "music": ("Relaxed sunny tropical island groove for a cosy video game: ukulele, marimba, soft steel drums, "
              "light shaker percussion and warm bass, happy and carefree, instrumental, steady tempo, "
              "seamless loop", 60000),
}
# name: (prompt, seconds, loop)
SFX = {
    "heart": ("bright cheerful magical chime, quick sparkly pickup sound for a cute video game", 0.8, False),
    "gold": ("sparkling golden shimmer arpeggio, rewarding bonus pickup sound, magical", 1.4, False),
    "jump": ("light playful cartoon hop with a soft whoosh", 0.6, False),
    "land": ("soft footstep landing on grass, gentle thump", 0.5, False),
    "bonk": ("coconut bonks a cartoon character on the head, comic hollow wooden bonk with a dizzy twinkle", 1.0, False),
    "thud": ("coconut drops onto sand, soft heavy thud", 0.5, False),
    "board": ("footsteps on a small wooden boat, hollow knock and gentle water slosh", 1.0, False),
    "splash": ("fishing bobber plops into calm water, small splash", 0.7, False),
    "bite": ("fish nibbles the bobber, quick bloop in the water", 0.5, False),
    "catch": ("fish pulled out of the water with a splash, followed by a tiny happy ukulele flourish", 1.6, False),
    "miss": ("fish escapes, quick water swish and a soft disappointed boop", 0.8, False),
    "end": ("short cheerful round over jingle, marimba and ukulele, cosy video game", 2.5, False),
    "engine": ("small outboard boat motor running at low speed, steady putter, no water", 4.0, True),
    "waves": ("gentle tropical sea waves lapping on a sandy beach, calm and soft ambience", 10.0, True),
}


def credits_used():
    req = urllib.request.Request(f"{API}/user/subscription", headers={"xi-api-key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["character_count"]


def post_audio(path, body):
    req = urllib.request.Request(f"{API}{path}?output_format=mp3_44100_128", data=json.dumps(body).encode(),
                                 headers={"xi-api-key": KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code}: {e.read()[:300].decode(errors='replace')}")


def main():
    out = sys.argv[1]
    only = set(sys.argv[2:])
    os.makedirs(out, exist_ok=True)
    start = before = credits_used()
    jobs = [(n, "music", v) for n, v in MUSIC.items()] + [(n, "sfx", v) for n, v in SFX.items()]
    for name, kind, spec in jobs:
        if only and name not in only:
            continue
        path = os.path.join(out, f"{name}.mp3")
        if os.path.exists(path):
            print(f"skip {name}")
            continue
        try:
            if kind == "music":
                prompt, ms = spec
                audio = post_audio("/music", {"prompt": prompt, "music_length_ms": ms})
            else:
                prompt, secs, loop = spec
                body = {"text": prompt, "duration_seconds": max(0.5, secs), "prompt_influence": 0.5,
                        "model_id": "eleven_text_to_sound_v2"}
                if loop:
                    body["loop"] = True
                audio = post_audio("/sound-generation", body)
        except RuntimeError as e:
            print(f"FAILED {name}: {e}")
            continue
        open(path, "wb").write(audio)
        now = credits_used()
        print(f"{name}: {len(audio) // 1024} KB, {now - before} credits")
        before = now
    print(f"TOTAL CREDITS USED THIS RUN: {credits_used() - start}")


if __name__ == "__main__":
    main()
