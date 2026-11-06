"""The hero's single floating key, rendered in Cycles on the poster's paper.

The keyboard's baked atlases are tuned for ~60px keys seen from the hero
keyboard camera over a black void. Magnified to a ~400px poster centrepiece on
paper they blur and lose their transparency. This renders the same keycap
geometry (optical-keycaps-library.blend: Keycap_1) with the same crystal
transport (three independent IOR paths 1.47/1.535/1.62, recombined in linear
RGB, Blender AgX) at the exact poster view, as a seamless floating loop.

The studio is a paper-grey cyclorama: through the glass you see the paper
(transparency), black flags give the crystal its dark edges, and white
softboxes travel slowly so the reflections and spectral bands keep moving.
Camera rays see nothing (film transparent): the page supplies the paper.

BLENDER --background --python scripts/render-world-key.py -- --preview
BLENDER --background --python scripts/render-world-key.py -- --frames 72 --samples 80
"""
import argparse, json, math, struct, sys, time, zlib
from pathlib import Path
import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--size', type=int, default=960)
parser.add_argument('--samples', type=int, default=80)
parser.add_argument('--frames', type=int, default=72)
parser.add_argument('--only', type=str, default='0')  # the still; e.g. "0,18,36" for reference frames
parser.add_argument('--preview', action='store_true')
parser.add_argument('--tag', default='')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
if args.preview:
    args.size, args.samples = 560, 48

OUT = ROOT / 'assets/blender/world-key'
FRAMES = OUT / 'frames'
QA = ROOT / 'docs/qa/world-key'
for folder in (OUT, FRAMES, QA): folder.mkdir(parents=True, exist_ok=True)
PAPER = (229, 228, 224)          # --paper in globals.css
INK = (0x18, 0x18, 0x1c)
IORS = [1.47, 1.535, 1.62]       # same three wavelengths as the keyboard bake

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'; prefs.get_devices()
for device in prefs.devices: device.use = device.type == 'METAL'
scene.cycles.device = 'GPU'
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 24; scene.cycles.transmission_bounces = 20; scene.cycles.glossy_bounces = 10
scene.cycles.transparent_max_bounces = 8
scene.cycles.sample_clamp_indirect = 0
scene.render.use_persistent_data = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = args.size
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = 0

# ── The keyboard's keycap, unchanged ───────────────────────────────────────
with bpy.data.libraries.load(str(ROOT / 'assets/blender/optical-keycaps-library.blend'), link=False) as (src, dst):
    dst.objects = ['Keycap_1']
key = dst.objects[0]; scene.collection.objects.link(key); key.hide_render = False; key.hide_viewport = False
key.data = key.data.copy(); key.data.materials.clear()
top = max(v.co.z for v in key.data.vertices)
# The world key's face is flat (user, 2026-11-06): the keyboard's dish is filled
# level with the polished rim, so the legend sits straight.
for v in key.data.vertices:
    if top - .09 < v.co.z < top - 1e-6 and max(abs(v.co.x), abs(v.co.y)) < .32:
        v.co.z = top
# The filled dish keeps its rings, so the face's shading normals stay truly flat;
# the bottom cap gets one inner ring for the same reason (a lone n-gon would
# spread the rounded rim's normals across the whole face, like a lens).
mesh = bmesh.new(); mesh.from_mesh(key.data)
bottom = min(mesh.faces, key=lambda f: f.calc_center_median().z)
bmesh.ops.inset_region(mesh, faces=[bottom], thickness=.02, depth=0, use_even_offset=True)
mesh.to_mesh(key.data); mesh.free()
for poly in key.data.polygons: poly.use_smooth = True
key.name = key.data.name = 'WorldKey'
bpy.ops.object.select_all(action='DESELECT'); key.select_set(True); bpy.context.view_layer.objects.active = key
(ROOT / 'public/models/world-key').mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/models/world-key/keycap.glb'), export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_materials='NONE', export_texcoords=False)
print('WORLD_KEY_MESH', len(key.data.vertices), 'vertices', sum(len(p.vertices) - 2 for p in key.data.polygons), 'triangles', flush=True)
key.select_set(False)

crystal = bpy.data.materials.new('World key / crystal'); crystal.use_nodes = True
bsdf = crystal.node_tree.nodes.get('Principled BSDF')
# The keyboard's crystal is the same glass; its darkness came from the black
# void around it. On paper the body stays clear with a faint cool body tint.
bsdf.inputs['Base Color'].default_value = (.93, .94, .955, 1)
bsdf.inputs['Transmission Weight'].default_value = 1
bsdf.inputs['Roughness'].default_value = .03
bsdf.inputs['IOR'].default_value = IORS[1]
absorb = crystal.node_tree.nodes.new('ShaderNodeVolumeAbsorption')
absorb.inputs['Color'].default_value = (.82, .85, .9, 1); absorb.inputs['Density'].default_value = .18
crystal.node_tree.links.new(absorb.outputs[0], crystal.node_tree.nodes.get('Material Output').inputs['Volume'])
key.data.materials.append(crystal)

# ── The legend: "world", printed on the flat face ───────────────────────────
font = bpy.data.fonts.load(str(ROOT / 'public/fonts/dm-sans-variable.ttf'))
curve = bpy.data.curves.new('world legend', 'FONT')
curve.body = 'world'; curve.font = font; curve.align_x = 'CENTER'; curve.align_y = 'CENTER'
curve.size = .205; curve.resolution_u = 24; curve.offset = .0028  # a little bolder than the regular instance
legend = bpy.data.objects.new('Legend / world', curve); scene.collection.objects.link(legend)
legend.location = (0, -.005, top + .05)
bpy.context.view_layer.objects.active = legend; legend.select_set(True)
bpy.ops.object.convert(target='MESH')
legend = bpy.context.view_layer.objects.active
wrap = legend.modifiers.new('onto the face', 'SHRINKWRAP')
wrap.target = key; wrap.wrap_method = 'PROJECT'; wrap.use_project_z = True
wrap.use_negative_direction = True; wrap.use_positive_direction = True; wrap.offset = .0016
bpy.ops.object.modifier_apply(modifier=wrap.name)
ink = bpy.data.materials.new('Legend / ink'); ink.use_nodes = True
p = ink.node_tree.nodes.get('Principled BSDF')
p.inputs['Base Color'].default_value = tuple((c / 255) ** 2.2 for c in INK) + (1,)
p.inputs['Roughness'].default_value = .42
legend.data.materials.clear(); legend.data.materials.append(ink)
legend.parent = key; legend.matrix_parent_inverse = key.matrix_world.inverted()

# ── Studio: paper cyclorama, black flags, travelling white softboxes ───────
def emission_material(name, power, feather=True):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    ns = mat.node_tree.nodes; ls = mat.node_tree.links; ns.clear()
    e = ns.new('ShaderNodeEmission'); e.inputs[0].default_value = (1, 1, 1, 1)
    o = ns.new('ShaderNodeOutputMaterial'); ls.new(e.outputs[0], o.inputs['Surface'])
    if not feather:
        e.inputs[1].default_value = power; return mat, e
    # Feathered softbox (same falloff as the keyboard's studio panels).
    coord = ns.new('ShaderNodeTexCoord'); sep = ns.new('ShaderNodeSeparateXYZ'); ls.new(coord.outputs['Generated'], sep.inputs[0])
    fades = []
    for axis, exponent in [('X', 2), ('Y', 6)]:
        sub = ns.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = .5; ls.new(sep.outputs[axis], sub.inputs[0])
        mul = ns.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 2; ls.new(sub.outputs[0], mul.inputs[0])
        ab = ns.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; ls.new(mul.outputs[0], ab.inputs[0])
        pw = ns.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = exponent; ls.new(ab.outputs[0], pw.inputs[0])
        inv = ns.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1; ls.new(pw.outputs[0], inv.inputs[1]); fades.append(inv)
    f = ns.new('ShaderNodeMath'); f.operation = 'MULTIPLY'; ls.new(fades[0].outputs[0], f.inputs[0]); ls.new(fades[1].outputs[0], f.inputs[1])
    s = ns.new('ShaderNodeMath'); s.operation = 'MULTIPLY'; s.inputs[1].default_value = power; ls.new(f.outputs[0], s.inputs[0]); ls.new(s.outputs[0], e.inputs[1])
    return mat, s

def card(name, location, size, material, target=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new()
    obj = bpy.data.objects.new(name, mesh); scene.collection.objects.link(obj)
    obj.location = location; obj.scale = (size[0], size[1], 1)
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('Z', 'Y').to_euler()
    mesh.materials.append(material)
    obj.visible_camera = False; obj.visible_shadow = False
    return obj

black = bpy.data.materials.new('Black flag'); black.use_nodes = True
bn = black.node_tree.nodes; bn.clear()
be = bn.new('ShaderNodeEmission'); be.inputs[1].default_value = 0
black.node_tree.links.new(be.outputs[0], bn.new('ShaderNodeOutputMaterial').inputs['Surface'])

# Flags: dark edges and the deep bands inside the walls.
card('Flag / left', (-2.4, .6, .2), (1.3, 6), black)
card('Flag / right back', (2.3, 2.0, .4), (1.2, 6), black)
card('Flag / below', (0, -.4, -2.6), (2.4, 2.0), black)
card('Flag / top back', (.4, 2.6, 2.4), (2.6, .5), black)

lights = {}
for name, power in [('side silk', 42), ('crown', 30), ('right strip', 34), ('key', 7)]:
    mat, control = emission_material('Softbox / ' + name, power)
    lights[name] = (card('Softbox / ' + name, (0, 0, 0), (1, 1), mat), control, power)

def place(name, location, size, target=(0, 0, 0), roll=0.0, gain=1.0):
    obj, control, power = lights[name]
    obj.location = location; obj.scale = (size[0], size[1], 1)
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('Z', 'Y').to_euler()
    if roll: obj.rotation_euler.rotate_axis('Z', roll)
    control.inputs[1].default_value = power * gain

world = bpy.data.worlds.new('Paper cyclorama'); world.use_nodes = True
background = world.node_tree.nodes.get('Background')
scene.world = world

# ── Camera: a long lens, slightly above, the key at the centre ────────────
cam_data = bpy.data.cameras.new('Poster camera'); cam_data.lens = 128; cam_data.sensor_width = 36
camera = bpy.data.objects.new('Poster camera', cam_data); scene.collection.objects.link(camera)
camera.location = (0, -6.4, 1.15)
camera.rotation_euler = (Vector((0, 0, .02)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
key.rotation_mode = 'ZYX'

# ── Paper calibration: the grey seen through the glass must be the page ───
def display(rgb_linear):
    """Blender's own view transform for an array of linear RGB rows."""
    rows = np.asarray(rgb_linear, dtype=np.float32).reshape(-1, 3)
    image = bpy.data.images.new('calibration', width=len(rows), height=1, float_buffer=True, alpha=True)
    image.pixels.foreach_set(np.hstack([rows, np.ones((len(rows), 1), np.float32)]).ravel())
    path = OUT / 'calibration.png'
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'; scene.render.image_settings.color_depth = '8'
    image.save_render(str(path), scene=scene); bpy.data.images.remove(image)
    back = bpy.data.images.load(str(path), check_existing=False)
    out = np.empty(len(rows) * 4, np.float32); back.pixels.foreach_get(out); bpy.data.images.remove(back)
    return out.reshape(-1, 4)[:, :3] * 255

paper = np.array([.75, .75, .75], np.float32)
for _ in range(14):
    shown = display([paper])[0]
    paper *= (np.array(PAPER) / np.maximum(shown, 1)) ** 1.6
print('PAPER_CALIBRATION', paper.tolist(), display([paper])[0].tolist(), flush=True)
# A real studio: the paper sweep behind and under the key, a dark room on the
# camera side and above. Through the glass you see the sweep (transparency);
# the thick walls and bevels reflect the dark room (definition).
wn = world.node_tree.nodes; wl = world.node_tree.links
direction = wn.new('ShaderNodeTexCoord'); split = wn.new('ShaderNodeSeparateXYZ')
wl.new(direction.outputs['Generated'], split.inputs[0])
sweep = wn.new('ShaderNodeMapRange'); sweep.inputs['From Min'].default_value = -.42; sweep.inputs['From Max'].default_value = .18
wl.new(split.outputs['Y'], sweep.inputs['Value'])
ceiling = wn.new('ShaderNodeMapRange'); ceiling.inputs['From Min'].default_value = .78; ceiling.inputs['From Max'].default_value = .45
wl.new(split.outputs['Z'], ceiling.inputs['Value'])
# A light tent: the ceiling is lit paper too (the glass must read as clear);
# only the camera side stays a soft grey. The black flags keep the edges.
both = wn.new('ShaderNodeMath'); both.operation = 'MULTIPLY'
wl.new(sweep.outputs[0], both.inputs[0]); both.inputs[1].default_value = 1
smooth = wn.new('ShaderNodeMapRange'); smooth.interpolation_type = 'SMOOTHERSTEP'
wl.new(both.outputs[0], smooth.inputs['Value'])
mix = wn.new('ShaderNodeMix'); mix.data_type = 'RGBA'
wl.new(smooth.outputs[0], mix.inputs['Factor'])
mix.inputs['A'].default_value = (*(paper * .2).tolist(), 1)
mix.inputs['B'].default_value = (*paper.tolist(), 1)
wl.new(mix.outputs['Result'], background.inputs['Color'])
background.inputs['Strength'].default_value = 1

# ── Loop: every motion has an integer number of cycles per loop ───────────
def pose(phase):
    tau = math.tau
    tilt = .44 + .045 * math.sin(tau * phase + .4) + .018 * math.sin(2 * tau * phase + 1.9)
    roll = -.07 + .03 * math.sin(tau * phase + 2.2)
    yaw = .34 + .11 * math.sin(tau * phase + 1.1) + .025 * math.sin(3 * tau * phase)
    key.rotation_euler = Euler((tilt, roll, yaw), 'ZYX')
    key.location = (0, 0, 0)
    # Two travelling emitters, uneven paths (as in the keyboard studio).
    a = tau * phase
    place('side silk', (-3.0 + .9 * math.sin(a + .3), -2.2 + 1.3 * math.cos(a), 1.6 + 1.1 * math.sin(2 * a + .8)), (.42, 4.2), roll=.25 * math.sin(a))
    place('crown', (1.4 * math.sin(a + 2.0), 2.4 + .4 * math.cos(2 * a), 3.0 + .5 * math.sin(a + .9)), (3.2, .22),
          gain=.8 + .2 * math.sin(a + 1.4))
    place('right strip', (2.5, 1.2 + .5 * math.sin(a + 2.6), 1.0), (.28, 3.8), roll=-.3)
    place('key', (-1.4, -3.4, 2.9), (1.6, .5), roll=.5)

def write_png(path, rgba):
    h, w, _ = rgba.shape
    def chunk(kind, data): return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data) & 0xffffffff)
    raw = b''.join(b'\0' + row.tobytes() for row in rgba)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

def render_frame(index, count, path):
    pose(index / count)
    size = args.size
    linear = np.zeros((size * size, 4), np.float32)
    for channel, ior in enumerate(IORS):
        bsdf.inputs['IOR'].default_value = ior
        scene.cycles.seed = 17 + channel * 71 + index * 3
        scene.render.image_settings.file_format = 'OPEN_EXR'; scene.render.image_settings.color_depth = '32'
        scene.render.filepath = str(OUT / f'working-{channel}.exr')
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(scene.render.filepath, check_existing=False)
        pixels = np.empty(size * size * 4, np.float32); image.pixels.foreach_get(pixels); bpy.data.images.remove(image)
        pixels = pixels.reshape(-1, 4)
        linear[:, channel] = pixels[:, channel]
        linear[:, 3] += pixels[:, 3] / 3
    alpha = np.clip(linear[:, 3], 0, 1)
    straight = linear[:, :3] / np.maximum(alpha, 1e-4)[:, None]
    shown = display(straight)  # AgX, exactly as the keyboard
    rgba = np.dstack([shown.reshape(size, size, 3), (alpha * 255).reshape(size, size)])
    rgba = np.flipud(np.clip(np.round(rgba), 0, 255).astype(np.uint8))
    write_png(path, rgba)

started = time.time()
if args.preview:
    frames = [int(x) for x in args.only.split(',')] if args.only else [0]
    for i in frames:
        path = QA / f'cycles-preview{args.tag}-{i:02}.png'
        render_frame(i, args.frames, path)
        print('WORLD_KEY_PREVIEW', path, round(time.time() - started, 1), 'sec', flush=True)
else:
    frames = [int(x) for x in args.only.split(',')] if args.only else range(args.frames)
    for i in frames:
        path = FRAMES / f'{i:03}.png'
        render_frame(i, args.frames, path)
        print('WORLD_KEY_FRAME', i, round(time.time() - started, 1), 'sec', flush=True)
    (OUT / 'render.json').write_text(json.dumps({'frames': args.frames, 'size': args.size, 'samples': args.samples,
                                                 'paper': PAPER, 'iors': IORS}, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'world-key.blend'))
