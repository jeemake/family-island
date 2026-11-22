# Family Island — Heart Hunt

A small 3D browser game on a low-poly island, styled after an architectural
axonometric illustration: brick walls, a white corrugated roof, salmon paving,
orange running-track paths, soft pastel lawn, fluffy trees, a beach, water,
a wooden pier and a boat.

Pick **JM** or **M**, then collect hearts for the family before time runs out,
dodging the coconuts that fall on the orange rings.

- **Move:** WASD / arrow keys, or drag anywhere on a phone
- **Sprint:** double-tap a direction (or hold Shift); on a phone, double-tap and hold. Uses stamina.
- **Jump:** Space, or the Jump button on a phone
- **Boat:** E (or the Board button) next to the boat at the end of the pier; E again at the pier to dock
- **Fish:** sail to the ripples, Space / Fish to cast, then Space / Reel the moment the bobber dips
- **Hearts:** +1 each, sky hearts +2 (jump for them); quick pickups build a combo (up to ×5)
- **Golden hearts:** +5 and +3 seconds
- **Fish:** blue tang +3, red snapper +4, golden koi +10 and +5 seconds
- **Coconuts:** fall on the orange rings, then roll — jump over one for +1. Three hits and it's over.

## How it's made

- [Three.js](https://threejs.org), orthographic axonometric camera, soft shadows and
  GTAO ambient occlusion (switched off automatically on slow devices).
- `assets/island.glb` — house and palms exported from Blender (`tools/export_glb.py`).
- `characters.js` — the family, built in code with hips, knees, ankles, shoulders and
  elbows, and a procedural run cycle (heel kick, arm pump, lean, bounce, banking).
- `world.js` — restyling, beach, water shader, paths, court, benches, pier and boat.
- `assets/textures/` — brick, grass, paving, sand, foliage and fabric textures generated
  with fal (FLUX dev; `tools/gen_textures.py`) and made tileable with `tools/make_tileable.py`.

- `assets/audio/` — music and sound effects generated with ElevenLabs (`tools/gen_audio.py`).

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
