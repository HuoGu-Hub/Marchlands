
"""把 Quaternius 角色 FBX 加工成游戏用 GLB：贴图、比例、细分、换武器、裁动画。

用法：
  blender -b --python tools/character-build/build.py -- source=... texture=... output=... [weapon=... weaponPack=...]
"""
import bpy
import math
import os
import sys
from mathutils import Matrix, Quaternion, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CONFIG = {}
for item in ARGS:
    key, _, value = item.partition("=")
    CONFIG[key] = value

SOURCE = CONFIG["source"]
OUTPUT = CONFIG["output"]
TEXTURE = CONFIG.get("texture", "")
WEAPON = CONFIG.get("weapon", "")
WEAPON_PACK = CONFIG.get("weaponPack", "")
WEAPON_LENGTH = float(CONFIG.get("weaponLength", "0.45"))
WEAPON_GRIP = float(CONFIG.get("weaponGrip", "0.0"))
WEAPON_TILT = float(CONFIG.get("weaponTilt", "0.0"))
SUBDIV = int(CONFIG.get("subdiv", "1"))
TORSO = float(CONFIG.get("torso", "1.0"))
ARMS = float(CONFIG.get("arms", "1.0"))
HEAD = float(CONFIG.get("head", "1.0"))
LEGS = float(CONFIG.get("legs", "1.0"))
HEIGHT = float(CONFIG.get("height", "1.6"))
SMOOTH_ANGLE = float(CONFIG.get("smoothAngle", "34"))

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SOURCE)

armature = next(obj for obj in bpy.data.objects if obj.type == "ARMATURE")
bpy.context.view_layer.update()


def meshes():
    return [obj for obj in bpy.data.objects if obj.type == "MESH"]


def stretch(name, factor):
    if abs(factor - 1.0) < 1e-4:
        return
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="EDIT")
    edit_bone = armature.data.edit_bones[name]
    head = edit_bone.head.copy()
    edit_bone.tail = head + (edit_bone.tail - head) * factor
    bpy.ops.object.mode_set(mode="OBJECT")


def scale_block(names, factor):
    for name in names:
        if name in armature.data.bones:
            stretch(name, factor)


scale_block(["Abdomen", "Torso"], TORSO)
scale_block(["UpperArm.L", "UpperArm.R", "LowerArm.L", "LowerArm.R"], ARMS)
scale_block(["UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R"], LEGS)
scale_block(["Head"], HEAD)

# 贴图：Quaternius 每个角色一张图集，统一换成同一张
if TEXTURE:
    image = bpy.data.images.load(os.path.abspath(TEXTURE))
    material = bpy.data.materials.new(name="CharacterAtlas")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Roughness"].default_value = 0.85
    if "Specular IOR Level" in shader.inputs:
        shader.inputs["Specular IOR Level"].default_value = 0.2
    texture_node = nodes.new("ShaderNodeTexImage")
    texture_node.image = image
    texture_node.interpolation = "Closest"
    material.node_tree.links.new(texture_node.outputs["Color"], shader.inputs["Base Color"])
    material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    for obj in meshes():
        obj.data.materials.clear()
        obj.data.materials.append(material)

# 只细分身体，头发/五官是插片，细分会把它们糊成一团
SKIP_SUBDIV = ("Face", "ShoulderPad", "Hair")
for obj in meshes():
    smooth_this = not obj.name.startswith(SKIP_SUBDIV)
    if SUBDIV > 0 and smooth_this:
        modifier = obj.modifiers.new(name="Smooth", type="SUBSURF")
        modifier.levels = SUBDIV
        modifier.render_levels = SUBDIV
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(SMOOTH_ANGLE))

# 换武器：保持原武器的骨骼父子关系，只把新武器网格变换到它的局部空间再替换 mesh。
WEAPON_HINTS = ("Sword", "Staff", "Dagger", "Bow", "Axe", "Hammer", "Weapon")
old_weapon = next((obj for obj in meshes() if any(hint in obj.name for hint in WEAPON_HINTS)), None)

if WEAPON and old_weapon is not None:
    old_vertices = [v.co.copy() for v in old_weapon.data.vertices]
    old_min = Vector((min(v.x for v in old_vertices), min(v.y for v in old_vertices), min(v.z for v in old_vertices)))
    old_max = Vector((max(v.x for v in old_vertices), max(v.y for v in old_vertices), max(v.z for v in old_vertices)))
    old_center = (old_min + old_max) * 0.5

    pack_dir = os.path.join(os.path.dirname(WEAPON_PACK), os.path.basename(WEAPON_PACK), "Object") + os.sep
    bpy.ops.wm.append(filepath=os.path.join(pack_dir, WEAPON), directory=pack_dir, filename=WEAPON)
    source = bpy.data.objects[WEAPON]
    mesh = source.data.copy()

    coords = [v.co.copy() for v in mesh.vertices]
    new_min = Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
    new_max = Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
    new_center = (new_min + new_max) * 0.5

    body_height = max(
        obj.dimensions.z for obj in meshes() if not obj.name.startswith(SKIP_SUBDIV) and obj is not old_weapon
    )
    # 原武器对象带骨骼继承缩放，目标长度要先换算回它的局部空间
    inherited = max(old_weapon.matrix_world.to_scale()) or 1.0
    target_length = (body_height * WEAPON_LENGTH) / inherited
    scale = target_length / max(1e-6, new_max.z - new_min.z)

    # 刀柄都在 -Z 端：把新武器的柄端对齐到原武器的柄端，横向居中；tilt 用来贴合手部朝向
    tilt = math.radians(WEAPON_TILT)
    cos_t, sin_t = math.cos(tilt), math.sin(tilt)
    for vertex in mesh.vertices:
        x = vertex.co.x - new_center.x
        y = vertex.co.y - new_center.y
        z = vertex.co.z - new_min.z
        vertex.co.x = old_center.x + x * scale
        vertex.co.y = old_center.y + (y * cos_t - z * sin_t) * scale
        vertex.co.z = old_min.z + (y * sin_t + z * cos_t) * scale

    mesh.name = old_weapon.data.name
    old_weapon.data = mesh
    bpy.data.objects.remove(source, do_unlink=True)
    bpy.context.view_layer.update()
    print(
        "WEAPON_SWAP",
        WEAPON,
        "scale", round(scale, 3),
        "target_local", round(target_length, 3),
        "world_dims", [round(v, 3) for v in old_weapon.dimensions],
        "world_scale", [round(v, 3) for v in old_weapon.matrix_world.to_scale()],
    )


# 身高不在这里归一：glTF 蒙皮会把骨架缩放烘进骨骼，客户端按包围盒自动适配更稳。
bpy.context.view_layer.update()
lowest = min((obj.matrix_world @ Vector(corner)).z for obj in meshes() for corner in obj.bound_box)
for obj in [o for o in bpy.data.objects if o.parent is None and o.type in {"MESH", "ARMATURE"}]:
    obj.location.z -= lowest

# 四个动作：不同角色攻击动作命名不同（Sword_Attack / Staff_Attack / Punch），逐级回退
def short_name(action):
    return action.name.split("|")[-1]


actions = list(bpy.data.actions)
picked = {
    "idle": next((a for a in actions if short_name(a) == "Idle"), None),
    "walk": next((a for a in actions if short_name(a) == "Walk"), None),
    "death": next((a for a in actions if short_name(a) == "Death"), None),
    "attack": (
        next((a for a in actions if short_name(a) == "Sword_Attack"), None)
        or next((a for a in actions if "Attack" in short_name(a) and "Fast" not in short_name(a)), None)
        or next((a for a in actions if "Attack" in short_name(a)), None)
        or next((a for a in actions if short_name(a) == "Punch"), None)
    ),
}
keep = {id(action) for action in picked.values() if action is not None}
for action in actions:
    if id(action) not in keep:
        bpy.data.actions.remove(action)
for clip, action in picked.items():
    if action is None:
        print("MISSING_CLIP", clip)
        continue
    action.name = clip
    action.use_fake_user = True

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUTPUT,
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_bake_animation=True,
    export_optimize_animation_size=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
)
print("BUILD_OK", OUTPUT, os.path.getsize(OUTPUT))
