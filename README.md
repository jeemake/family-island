# Family Island — Heart Hunt

A small 3D browser game built on a low-poly Blender scene: a house, a red truck,
palm trees and a family of four (JM, M, N and H).

Play as **JM**: collect hearts for the family before time runs out, and dodge the
coconuts falling on the red circles.

- **Move:** WASD / arrow keys, or drag anywhere on a phone
- **Hearts:** +1 each; quick pickups build a combo (up to x5)
- **Golden hearts:** +5 and +3 seconds
- **Coconuts:** three hits and it's over

Built with [Three.js](https://threejs.org). The island (`assets/island.glb`) is
exported from Blender with `tools/export_glb.py`.

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
