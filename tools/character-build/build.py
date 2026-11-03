
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

# 记录原武器的世界矩阵，换武器时沿用它的握把位置和刀身方向
old_weapon = next((obj for obj in meshes() if obj.name.endswith("_Sword") or "Weapon" in obj.name), None)
old_matrix = old_weapon.matrix_world.copy() if old_weapon else None
old_axis = None
if old_weapon is not None:
    dims = old_weapon.dimensions
    index = max(range(3), key=lambda i: dims[i])
    local_axis = Vector((0.0, 0.0, 0.0))
    local_axis[index] = 1.0
    old_axis = (old_matrix.to_3x3() @ local_axis).normalized()
    bpy.data.objects.remove(old_weapon, do_unlink=True)

if WEAPON:
    pack_dir = os.path.join(os.path.dirname(WEAPON_PACK), os.path.basename(WEAPON_PACK), "Object") + os.sep
    bpy.ops.wm.append(filepath=os.path.join(pack_dir, WEAPON), directory=pack_dir, filename=WEAPON)
    weapon = bpy.data.objects[WEAPON]
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = weapon
    weapon.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    body_height = max(obj.dimensions.z for obj in meshes() if not obj.name.startswith(SKIP_SUBDIV)) if meshes() else 1.0
    target = body_height * WEAPON_LENGTH
    dims = weapon.dimensions
    index = max(range(3), key=lambda i: dims[i])
    current = dims[index]
    factor = target / current if current > 0 else 1.0

    local_axis = Vector((0.0, 0.0, 0.0))
    local_axis[index] = 1.0
    target_axis = old_axis if old_axis is not None else Vector((0.0, 0.0, 1.0))
    rotation = local_axis.rotation_difference(target_axis)

    grip = old_matrix.translation.copy() if old_matrix is not None else armature.matrix_world @ armature.data.bones["Weapon.R"].head_local
    # 让握把落在手心里：沿刀身轴把模型往回推
    grip = grip - target_axis * (target * WEAPON_GRIP)

    weapon.matrix_world = (
        Matrix.Translation(grip)
        @ rotation.to_matrix().to_4x4()
        @ Matrix.Diagonal((factor, factor, factor, 1.0))
    )
    bpy.context.view_layer.update()

    bone_name = next((name for name in ("Weapon.R", "Fist.R", "Hand.R") if name in armature.data.bones), None)
    bpy.ops.object.select_all(action="DESELECT")
    weapon.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    if bone_name:
        armature.data.bones.active = armature.data.bones[bone_name]
    bpy.ops.object.parent_set(type="BONE", keep_transform=True)

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
