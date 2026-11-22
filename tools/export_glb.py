"""Export the low-poly house scene to a .glb for the web game.

Run: Blender --background <scene.blend> --python export_glb.py -- <out.glb>
"""
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]

# glTF only carries meshes: turn the shirt initials (text objects) into meshes first.
texts = [o for o in bpy.data.objects if o.type == "FONT"]
if texts:
    bpy.ops.object.select_all(action="DESELECT")
    for o in texts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = texts[0]
    bpy.ops.object.convert(target="MESH")

bpy.context.scene.frame_set(1)
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_apply=True,          # bake the roof's Solidify modifier
    export_cameras=False,
    export_lights=False,
    export_animations=True,     # the waving arms and the beating heart
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_extras=False,
    export_yup=True,
)
print("EXPORTED", out)
