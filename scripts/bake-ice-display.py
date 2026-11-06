"""Bakes the ice display's optical appearance for the web.

The display always faces the camera (it is placed in camera space around the
HTML twin's frame), so its look from the camera is a single image per shape:
Cycles renders it once with the studio strips, three-IOR dispersion and the
thick tapered crystal; the browser shows that image and adds the page's light
and the freezing on top. Same idea as the keycaps' fixed-camera bakes.

BLENDER --background --python scripts/bake-ice-display.py -- --samples 384
Writes public/models/ice/{landscape,portrait}.png and manifest.json.
"""
import bpy
import bmesh
import json
import math
import sys
import argparse
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--samples', type=int, default=384)
parser.add_argument('--only', choices=['landscape', 'portrait'], default=None)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = ROOT / 'public/models/ice'
OUT.mkdir(parents=True, exist_ok=True)

# Canonical frames, identical to the CSS (.display-frame) at these viewports.
# fov: the camera's vertical field over the whole canvas in that layout.
SHAPES = {
    'landscape': {'viewport': (1440, 900), 'fov': 34.0, 'frame': (345.6, 203.4, 748.8, 421.2), 'distance': 22.5},
    'portrait': {'viewport': (390, 844), 'fov': 61.9, 'frame': (40, 164.18, 310, 465), 'distance': 17.6},
}
EXPAND_X, EXPAND_Y = .17, .155  # crop around the frame, in units of the frame width
LEAN = math.radians(5)
KEY_SECTION = [(-.405, .035, .055), (-.399, .018, .053), (-.383, .005, .052), (-.36, 0, .05), (-.33, .003, .05), (-.18, .025, .049),
               (0, .060, .048), (.18, .104, .048), (.31, .137, .048), (.355, .149, .047), (.382, .164, .047), (.394, .181, .045), (.398, .198, .043)]
# Studio strips in the display's frame: toward viewer, across, up, size, power (units of 11.8 content width).
STRIPS = [(10, 0, 14, 26, 1.1, 3.5), (-2, -17, 2, .8, 13, 55), (-3, 18, -1, .7, 12, 30), (-11, 0, 10, 24, .8, 80), (2, 1, -11, 22, .6, 18)]


def proportions(cw, ch):
    """Same as src/lib/ice-geometry.ts."""
    base = min(cw, ch * 1.78)
    margin, taper = base * .064, base * .047
    front = (cw + 2 * margin, ch + 2 * margin)
    return {'taper': taper, 'back': (front[0] + 2 * taper, front[1] + 2 * taper), 'thickness': base * .106,
            'corner': base * .036, 'radius': cw * 2.9}


def cylinder(u, v, depth, radius):
    r = radius + depth
    a = u / radius
    return Vector((r * math.sin(a), v, radius - r * math.cos(a)))


def rounded_rect(w, h, r, corner=10, side_x=96, side_y=52):
    pts = []
    corners = [(w/2 - r, h/2 - r, 0), (-w/2 + r, h/2 - r, 90), (-w/2 + r, -h/2 + r, 180), (w/2 - r, -h/2 + r, 270)]
    for k, (cx, cy, start) in enumerate(corners):
        for i in range(corner):
            a = math.radians(start + i * 90 / corner)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        a = math.radians(start + 90)
        ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
        nx, ny, ns = corners[(k + 1) % 4]
        na = math.radians(ns)
        tx, ty = nx + r * math.cos(na), ny + r * math.sin(na)
        steps = side_x if k in (0, 2) else side_y
        for i in range(steps):
            t = i / steps
            pts.append((ex + (tx - ex) * t, ey + (ty - ey) * t))
    return pts


def ice_slab(p):
    (bw, bh), thickness, taper, corner, radius = p['back'], p['thickness'], p['taper'], p['corner'], p['radius']
    rings = [(rounded_rect(bw * s, bh * s, corner * s), thickness) for s in [.04, .14, .28, .44, .6, .74, .86, .95]]
    for z, inset, cr in KEY_SECTION:
        i = inset / .198 * taper
        rings.append((rounded_rect(bw - 2 * i, bh - 2 * i, corner * cr / .05), thickness * (.398 - z) / .803))
    fw, fh, fr = bw - 2 * taper, bh - 2 * taper, corner * .043 / .05
    rings += [(rounded_rect(fw * s, fh * s, fr * s), 0.0) for s in [.97, .9, .8, .66, .5, .34, .19, .07]]
    bm = bmesh.new()
    layers = [[bm.verts.new(cylinder(u, v, d, radius)) for u, v in outline] for outline, d in rings]
    back_c, front_c = bm.verts.new(cylinder(0, 0, thickness, radius)), bm.verts.new(cylinder(0, 0, 0, radius))
    n = len(layers[0])
    for a, b in zip(layers, layers[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    for j in range(n):
        bm.faces.new((back_c, layers[0][(j + 1) % n], layers[0][j]))
        bm.faces.new((front_c, layers[-1][j], layers[-1][(j + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new('Ice'); bm.to_mesh(mesh); bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new('Ice display', mesh); bpy.context.collection.objects.link(obj)
    return obj


def crystal():
    mat = bpy.data.materials.new('Ice / clear crystal, RGB dispersion'); mat.use_nodes = True
    n, l = mat.node_tree.nodes, mat.node_tree.links; n.clear()
    out = n.new('ShaderNodeOutputMaterial')
    shaders = []
    for color, ior in [((1, 0, 0, 1), 1.50), ((0, 1, 0, 1), 1.535), ((0, 0, 1, 1), 1.585)]:
        g = n.new('ShaderNodeBsdfGlass'); g.distribution = 'BECKMANN'
        g.inputs['Color'].default_value = color; g.inputs['Roughness'].default_value = .02; g.inputs['IOR'].default_value = ior
        shaders.append(g)
    a = n.new('ShaderNodeAddShader'); b = n.new('ShaderNodeAddShader')
    l.new(shaders[0].outputs[0], a.inputs[0]); l.new(shaders[1].outputs[0], a.inputs[1])
    l.new(a.outputs[0], b.inputs[0]); l.new(shaders[2].outputs[0], b.inputs[1]); l.new(b.outputs[0], out.inputs['Surface'])
    absorb = n.new('ShaderNodeVolumeAbsorption'); absorb.inputs['Color'].default_value = (.80, .84, .90, 1); absorb.inputs['Density'].default_value = .18
    l.new(absorb.outputs[0], out.inputs['Volume'])
    return mat


def strip(name, world_pos, target, size, power):
    bpy.ops.mesh.primitive_plane_add(size=1, location=world_pos)
    obj = bpy.context.object; obj.name = name
    obj.rotation_euler = (target - obj.location).to_track_quat('Z', 'Y').to_euler()
    obj.scale = (size[0], size[1], 1)
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    ns, ls = mat.node_tree.nodes, mat.node_tree.links; ns.clear()
    e = ns.new('ShaderNodeEmission'); o = ns.new('ShaderNodeOutputMaterial'); ls.new(e.outputs[0], o.inputs['Surface'])
    coord = ns.new('ShaderNodeTexCoord'); sep = ns.new('ShaderNodeSeparateXYZ'); ls.new(coord.outputs['Generated'], sep.inputs[0])
    fades = []
    for axis, exponent in [('X', 2), ('Y', 6)]:
        sub = ns.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = .5; ls.new(sep.outputs[axis], sub.inputs[0])
        mul = ns.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 2; ls.new(sub.outputs[0], mul.inputs[0])
        ab = ns.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; ls.new(mul.outputs[0], ab.inputs[0])
        pw = ns.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = exponent; ls.new(ab.outputs[0], pw.inputs[0])
        inv = ns.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1; ls.new(pw.outputs[0], inv.inputs[1]); fades.append(inv)
    f = ns.new('ShaderNodeMath'); f.operation = 'MULTIPLY'; ls.new(fades[0].outputs[0], f.inputs[0]); ls.new(fades[1].outputs[0], f.inputs[1])
    s = ns.new('ShaderNodeMath'); s.operation = 'MULTIPLY'; s.inputs[1].default_value = power; ls.new(f.outputs[0], s.inputs[0]); ls.new(s.outputs[0], e.inputs['Strength'])
    obj.data.materials.append(mat); obj.visible_camera = False


def bake(name, shape):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Render on a canvas padded around the viewport (same focal length), so the
    # crop around the display never falls outside the image on narrow screens.
    pad = 160
    vw, vh = shape['viewport'][0] + 2 * pad, shape['viewport'][1] + 2 * pad
    fx, fy, fw, fh = shape['frame']; fx += pad; fy += pad
    D = shape['distance']
    fov = 2 * math.atan(math.tan(math.radians(shape['fov']) / 2) * vh / shape['viewport'][1])
    cam_data = bpy.data.cameras.new('Camera'); cam_data.sensor_fit = 'VERTICAL'; cam_data.angle_y = fov; cam_data.clip_end = 300
    cam = bpy.data.objects.new('Camera', cam_data); bpy.context.collection.objects.link(cam)
    cam.location = Vector((0, -D * .63, D * .78))
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    forward = (Vector((0, 0, 0)) - cam.location).normalized()
    right = forward.cross(Vector((0, 0, 1))).normalized(); up = right.cross(forward).normalized()
    tan_v = math.tan(cam_data.angle_y / 2); tan_h = tan_v * vw / vh

    def at(px, py):  # a frame point carried to the plane at depth D
        nx, ny = px / vw * 2 - 1, 1 - py / vh * 2
        return cam.location + forward * D + right * (nx * tan_h * D) + up * (ny * tan_v * D)
    cx, cy = fx + fw / 2, fy + fh / 2
    centre = at(cx, cy)
    cw, ch = (at(fx + fw, cy) - at(fx, cy)).length, (at(cx, fy) - at(cx, fy + fh)).length
    p = proportions(cw, ch)
    ice = ice_slab(p)
    basis = Matrix((right, up, -forward)).transposed().to_4x4() @ Matrix.Rotation(-LEAN, 4, 'X')
    ice.matrix_world = Matrix.Translation(centre) @ basis
    ice.data.materials.append(crystal())
    # Strips scale with the display's long side. A tall display would mirror the
    # overhead sheen straight across its face, so portrait goes without it.
    unit = max(cw, ch) / 11.8
    for i, (toward, across, upward, w, h, power) in enumerate(STRIPS):
        if name == 'portrait' and i == 0:
            continue
        if name == 'portrait' and i == 3:
            upward *= 1.9  # seen straight through the tall top otherwise
        pos = ice.matrix_world @ Vector((across * unit, upward * unit, toward * unit))
        strip(f'strip {i}', pos, centre, (w * unit, h * unit), power)
    world = bpy.data.worlds.new('Void'); world.use_nodes = True
    wn, wl = world.node_tree.nodes, world.node_tree.links
    bg = wn.get('Background'); bg.inputs[0].default_value = (.8, .85, 1, 1); bg.inputs[1].default_value = .025
    black = wn.new('ShaderNodeBackground'); black.inputs[0].default_value = (0, 0, 0, 1)
    lp = wn.new('ShaderNodeLightPath'); mix = wn.new('ShaderNodeMixShader')
    seen = wn.new('ShaderNodeMath'); seen.operation = 'MAXIMUM'
    wl.new(lp.outputs['Is Camera Ray'], seen.inputs[0]); wl.new(lp.outputs['Is Transmission Ray'], seen.inputs[1])
    wl.new(seen.outputs[0], mix.inputs[0]); wl.new(bg.outputs[0], mix.inputs[1]); wl.new(black.outputs[0], mix.inputs[2])
    wl.new(mix.outputs[0], wn.get('World Output').inputs['Surface'])
    scene = bpy.context.scene
    scene.world = world; scene.camera = cam; scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    scene.cycles.device = 'GPU'; scene.cycles.samples = args.samples; scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 24; scene.cycles.transmission_bounces = 20; scene.cycles.glossy_bounces = 12
    scale = 2 if name == 'landscape' else 3
    scene.render.resolution_x = vw * scale; scene.render.resolution_y = vh * scale; scene.render.resolution_percentage = 100
    # Crop to the display: the frame plus room for the rim.
    x0, x1 = fx - EXPAND_X * fw, fx + fw + EXPAND_X * fw
    y0, y1 = fy - EXPAND_Y * fw, fy + fh + EXPAND_Y * fw
    scene.render.use_border = True; scene.render.use_crop_to_border = True
    scene.render.border_min_x, scene.render.border_max_x = x0 / vw, x1 / vw
    scene.render.border_min_y, scene.render.border_max_y = 1 - y1 / vh, 1 - y0 / vh
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Medium High Contrast'; scene.view_settings.exposure = .3
    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('baked', name, scene.render.filepath)


for name, shape in SHAPES.items():
    if args.only and args.only != name:
        continue
    bake(name, shape)
manifest = {'revision': 1, 'expand': [EXPAND_X, EXPAND_Y], 'shapes': {k: {'frameAspect': v['frame'][2] / v['frame'][3]} for k, v in SHAPES.items()}}
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2))
