"""Look-development study for the ice display that replaces the keyboard when a
world opens. Same optical language as the keys: thick clear crystal, polished
round bevels, three-IOR dispersion, white studio light only. The page lives
inside the ice as light; nothing glows outside the glass.

BLENDER --background --python scripts/build-ice-display-study.py -- --scene about --samples 256
Scenes: about, unknown, works, freeze (crystallising in from the edges).
"""
import bpy
import bmesh
import math
import sys
import argparse
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--scene', default='about', choices=['about', 'unknown', 'works', 'freeze'])
parser.add_argument('--samples', type=int, default=128)
parser.add_argument('--preview', action='store_true')
parser.add_argument('--curvature', type=float, default=34.0, help='bend radius in scene units')
parser.add_argument('--freeze', type=float, default=.55, help='0..1 how far the ice has grown inward')
parser.add_argument('--output', default='')
parser.add_argument('--save-blend', action='store_true')
parser.add_argument('--clay', action='store_true', help='shape check: matte material, simple light')
parser.add_argument('--page-depth', type=float, default=.12, help='depth of the light inside the ice, as a fraction of thickness')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves):
    for item in list(block):
        if item.users == 0:
            block.remove(item)

# ── Hero camera, identical to the web (three.js Y-up → Blender Z-up) ─────────
DISTANCE = 22.5
camera_data = bpy.data.cameras.new('Hero camera')
camera_data.sensor_fit = 'VERTICAL'
camera_data.angle_y = math.radians(34)
camera_data.clip_end = 200
camera = bpy.data.objects.new('Hero camera', camera_data)
bpy.context.collection.objects.link(camera)
camera.location = Vector((0, -DISTANCE * .63, DISTANCE * .78))
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
toward_camera = camera.location.normalized()
right = Vector((1, 0, 0))
up = toward_camera.cross(right).normalized() * -1  # display "up", leaning back to face the camera
if up.z < 0:
    up = -up


def crystal_material(name, frost_mask=False):
    """Clear crystal with RGB dispersion (one Glass closure per primary)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    n, l = nt.nodes, nt.links
    n.clear()
    out = n.new('ShaderNodeOutputMaterial')
    glasses = []
    for color, ior in [((1, 0, 0, 1), 1.50), ((0, 1, 0, 1), 1.535), ((0, 0, 1, 1), 1.585)]:
        g = n.new('ShaderNodeBsdfGlass')
        g.distribution = 'BECKMANN'
        g.inputs['Color'].default_value = color
        g.inputs['Roughness'].default_value = .02
        g.inputs['IOR'].default_value = ior
        glasses.append(g)
    a1 = n.new('ShaderNodeAddShader'); a2 = n.new('ShaderNodeAddShader')
    l.new(glasses[0].outputs[0], a1.inputs[0]); l.new(glasses[1].outputs[0], a1.inputs[1])
    l.new(a1.outputs[0], a2.inputs[0]); l.new(glasses[2].outputs[0], a2.inputs[1])
    clear = a2.outputs[0]
    absorb = n.new('ShaderNodeVolumeAbsorption')
    absorb.inputs['Color'].default_value = (.80, .84, .90, 1)
    absorb.inputs['Density'].default_value = .18
    l.new(absorb.outputs[0], out.inputs['Volume'])
    if not frost_mask:
        l.new(clear, out.inputs['Surface'])
        return mat, None
    # Crystallisation: formed ice grows in from the edges; just behind the
    # growing front it is still frosted, then it clears.
    frost = n.new('ShaderNodeBsdfGlass')
    frost.inputs['Roughness'].default_value = .42
    frost.inputs['IOR'].default_value = 1.31
    frost.inputs['Color'].default_value = (.92, .94, .98, 1)
    mix_frost = n.new('ShaderNodeMixShader')
    l.new(clear, mix_frost.inputs[1]); l.new(frost.outputs[0], mix_frost.inputs[2])
    transparent = n.new('ShaderNodeBsdfTransparent')
    mix_formed = n.new('ShaderNodeMixShader')
    l.new(transparent.outputs[0], mix_formed.inputs[1]); l.new(mix_frost.outputs[0], mix_formed.inputs[2])
    l.new(mix_formed.outputs[0], out.inputs['Surface'])
    return mat, (mix_frost, mix_formed)


def edge_distance_nodes(mat, width, height):
    """Distance (scene units) from the nearest outer edge, from undeformed coordinates."""
    n, l = mat.node_tree.nodes, mat.node_tree.links
    coord = n.new('ShaderNodeTexCoord')
    sep = n.new('ShaderNodeSeparateXYZ'); l.new(coord.outputs['Generated'], sep.inputs[0])

    def edge(axis, size):
        inv = n.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1
        l.new(sep.outputs[axis], inv.inputs[1])
        mn = n.new('ShaderNodeMath'); mn.operation = 'MINIMUM'
        l.new(sep.outputs[axis], mn.inputs[0]); l.new(inv.outputs[0], mn.inputs[1])
        sc = n.new('ShaderNodeMath'); sc.operation = 'MULTIPLY'; sc.inputs[1].default_value = size
        l.new(mn.outputs[0], sc.inputs[0])
        return sc
    dx, dy = edge('X', width), edge('Y', height)
    d = n.new('ShaderNodeMath'); d.operation = 'MINIMUM'
    l.new(dx.outputs[0], d.inputs[0]); l.new(dy.outputs[0], d.inputs[1])
    # An uneven growth front, like frost finding its way across a surface.
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 3.2; noise.inputs['Detail'].default_value = 6
    l.new(coord.outputs['Generated'], noise.inputs['Vector'])
    jitter = n.new('ShaderNodeMath'); jitter.operation = 'MULTIPLY_ADD'
    jitter.inputs[1].default_value = 1.6; jitter.inputs[2].default_value = -.8
    l.new(noise.outputs['Fac'], jitter.inputs[0])
    dd = n.new('ShaderNodeMath'); dd.operation = 'ADD'
    l.new(d.outputs[0], dd.inputs[0]); l.new(jitter.outputs[0], dd.inputs[1])
    return dd


# ── Geometry, computed directly (no modifier stack) ──────────────────────────
# Display-local axes: x across, y up, z toward the viewer. The front face is a
# cylinder of radius R curving toward the viewer; depth runs into the ice.
def cylinder(u, v, depth, radius):
    r = radius + depth
    a = u / radius
    return Vector((r * math.sin(a), v, radius - r * math.cos(a)))


def rounded_rect(w, h, r, corner=10, side_x=90, side_y=46):
    """Closed outline with dense straight sides, so the curve is carried faithfully."""
    pts = []
    corners = [(w/2 - r, h/2 - r, 0), (-w/2 + r, h/2 - r, 90), (-w/2 + r, -h/2 + r, 180), (w/2 - r, -h/2 + r, 270)]
    for k, (cx, cy, start) in enumerate(corners):
        for i in range(corner):
            a = math.radians(start + i * 90 / corner)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        a = math.radians(start + 90)
        ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
        nx, ny = corners[(k + 1) % 4][0], corners[(k + 1) % 4][1]
        na = math.radians(corners[(k + 1) % 4][2])
        tx, ty = nx + r * math.cos(na), ny + r * math.sin(na)
        steps = side_x if k in (0, 2) else side_y
        for i in range(steps):
            t = i / steps
            pts.append((ex + (tx - ex) * t, ey + (ty - ey) * t))
    return pts


# The keycap's own section (z, inset, corner radius), from heel to crown edge.
KEY_SECTION = [(-.405, .035, .055), (-.399, .018, .053), (-.383, .005, .052), (-.36, 0, .05), (-.33, .003, .05), (-.18, .025, .049),
               (0, .060, .048), (.18, .104, .048), (.31, .137, .048), (.355, .149, .047), (.382, .164, .047), (.394, .181, .045), (.398, .198, .043)]


def ice_slab(name, width, height, thickness, radius, taper, corner):
    rings = []  # each: (outline points (u, v), depth)
    back_w, back_h = width, height
    # Back cap: concentric outlines closing toward the centre, flat at full depth.
    for sc in [.04, .14, .28, .44, .6, .74, .86, .95]:
        rings.append((rounded_rect(back_w * sc, back_h * sc, corner * sc), thickness))
    for z, inset, cr in KEY_SECTION:
        depth = thickness * (.398 - z) / .803
        i = inset / .198 * taper
        rings.append((rounded_rect(back_w - 2 * i, back_h - 2 * i, corner * cr / .05), depth))
    front_w, front_h, front_r = back_w - 2 * taper, back_h - 2 * taper, corner * .043 / .05
    for sc in [.97, .9, .8, .66, .5, .34, .19, .07]:
        rings.append((rounded_rect(front_w * sc, front_h * sc, front_r * sc), 0.0))
    bm = bmesh.new()
    layers = []
    for outline, depth in rings:
        layers.append([bm.verts.new(cylinder(u, v, depth, radius)) for u, v in outline])
    back_centre = bm.verts.new(cylinder(0, 0, thickness, radius))
    front_centre = bm.verts.new(cylinder(0, 0, 0, radius))
    n = len(layers[0])
    for a, b in zip(layers, layers[1:]):
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((a[j], a[k], b[k], b[j]))
    for j in range(n):
        k = (j + 1) % n
        bm.faces.new((back_centre, layers[0][k], layers[0][j]))
        bm.faces.new((front_centre, layers[-1][j], layers[-1][k]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    mesh = bpy.data.meshes.new(name + 'Mesh'); bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    return obj


def curved_plane(name, width, height, depth, radius, columns=200, rows=6):
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new('UVMap')
    grid = [[bm.verts.new(cylinder((i / columns - .5) * width, (j / rows - .5) * height, depth, radius)) for i in range(columns + 1)] for j in range(rows + 1)]
    for j in range(rows):
        for i in range(columns):
            face = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for loop, (a, b) in zip(face.loops, [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]):
                loop[uv_layer].uv = (a / columns, b / rows)
    mesh = bpy.data.meshes.new(name + 'Mesh'); bm.to_mesh(mesh); bm.free()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    return obj


LEAN = math.radians(9)  # lean back a little more than facing the camera: the top thickness shows


def face_camera(obj, center):
    obj.location = center
    rotation = (camera.location - center).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    obj.rotation_euler = (rotation @ Matrix.Rotation(-LEAN, 4, 'X')).to_euler()


# ── The ice display ───────────────────────────────────────────────────────────
W, H, T = 14.4, 8.1, 1.25
center = Vector((0, .2, .35))
freeze = args.scene == 'freeze'
ice = ice_slab('Ice display', W, H, T, args.curvature, taper=.55, corner=.42)
face_camera(ice, center)
ice_mat, frost_mix = crystal_material('Ice / clear crystal, RGB dispersion', frost_mask=freeze)
ice.data.materials.append(ice_mat)

# The page, as light frozen inside the thickness.
inner_w = W - 2.6
inner_h = inner_w * 9 / 16
page = curved_plane('Light inside the ice', inner_w, inner_h, T * args.page_depth, args.curvature)
face_camera(page, center)
page.visible_shadow = False
light_mat = bpy.data.materials.new('Page light / emission inside ice')
light_mat.use_nodes = True
ln, ll = light_mat.node_tree.nodes, light_mat.node_tree.links
ln.clear()
lout = ln.new('ShaderNodeOutputMaterial')
tex = ln.new('ShaderNodeTexImage')
content = {'about': 'about', 'unknown': 'unknown', 'works': 'works', 'freeze': 'about'}[args.scene]
tex.image = bpy.data.images.load(str(ROOT / 'assets/blender/display-study' / f'{content}.png'))
tex.interpolation = 'Cubic'
uv = ln.new('ShaderNodeUVMap')
ll.new(uv.outputs[0], tex.inputs[0])
emission = ln.new('ShaderNodeEmission'); emission.inputs['Strength'].default_value = 3.2
ll.new(tex.outputs['Color'], emission.inputs['Color'])
transparent = ln.new('ShaderNodeBsdfTransparent')
add = ln.new('ShaderNodeAddShader')
ll.new(transparent.outputs[0], add.inputs[0])
if freeze:
    # The page appears only where the ice has formed and cleared.
    d = edge_distance_nodes(light_mat, inner_w, inner_h)
    front = args.freeze * 4.2
    clear_ramp = light_mat.node_tree.nodes.new('ShaderNodeMapRange')
    clear_ramp.inputs['From Min'].default_value = front - 1.9; clear_ramp.inputs['From Max'].default_value = front - .9
    clear_ramp.inputs['To Min'].default_value = 1; clear_ramp.inputs['To Max'].default_value = 0
    ll.new(d.outputs[0], clear_ramp.inputs['Value'])
    gain = ln.new('ShaderNodeMath'); gain.operation = 'MULTIPLY'; gain.inputs[1].default_value = 3.2
    ll.new(clear_ramp.outputs[0], gain.inputs[0]); ll.new(gain.outputs[0], emission.inputs['Strength'])
# Light leaves only toward the viewer, as from a display; light sent backward
# would mirror off the back face into a drop-shadow ghost.
facing = ln.new('ShaderNodeNewGeometry')
one_sided = ln.new('ShaderNodeMath'); one_sided.operation = 'SUBTRACT'; one_sided.inputs[0].default_value = 1
ll.new(facing.outputs['Backfacing'], one_sided.inputs[1])
front_strength = ln.new('ShaderNodeMath'); front_strength.operation = 'MULTIPLY'
strength_source = emission.inputs['Strength'].links[0].from_socket if emission.inputs['Strength'].links else None
if strength_source is not None:
    ll.new(strength_source, front_strength.inputs[0])
else:
    front_strength.inputs[0].default_value = emission.inputs['Strength'].default_value
ll.new(one_sided.outputs[0], front_strength.inputs[1]); ll.new(front_strength.outputs[0], emission.inputs['Strength'])
ll.new(emission.outputs[0], add.inputs[1])
ll.new(add.outputs[0], lout.inputs['Surface'])
page.data.materials.append(light_mat)

if freeze:
    d = edge_distance_nodes(ice_mat, W, H)
    front = args.freeze * 4.6
    n, l = ice_mat.node_tree.nodes, ice_mat.node_tree.links
    formed = n.new('ShaderNodeMapRange')
    formed.inputs['From Min'].default_value = front; formed.inputs['From Max'].default_value = front + .06
    formed.inputs['To Min'].default_value = 1; formed.inputs['To Max'].default_value = 0
    l.new(d.outputs[0], formed.inputs['Value']); l.new(formed.outputs[0], frost_mix[1].inputs[0])
    frosty = n.new('ShaderNodeMapRange')
    frosty.inputs['From Min'].default_value = front - .9; frosty.inputs['From Max'].default_value = front - .05
    frosty.inputs['To Min'].default_value = 0; frosty.inputs['To Max'].default_value = 1
    l.new(d.outputs[0], frosty.inputs['Value']); l.new(frosty.outputs[0], frost_mix[0].inputs[0])
    # Facets of new ice catch light only inside the frost band; the growing edge is a fine bright line.
    vor = n.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs['Scale'].default_value = 7
    coord = n.new('ShaderNodeTexCoord'); l.new(coord.outputs['Object'], vor.inputs['Vector'])
    facet = n.new('ShaderNodeMapRange'); facet.inputs['From Min'].default_value = 0; facet.inputs['From Max'].default_value = .06
    facet.inputs['To Min'].default_value = 1; facet.inputs['To Max'].default_value = 0
    l.new(vor.outputs['Distance'], facet.inputs['Value'])
    # A thin band centred on the growing edge.
    offset = n.new('ShaderNodeMath'); offset.operation = 'SUBTRACT'; offset.inputs[1].default_value = front
    l.new(d.outputs[0], offset.inputs[0])
    away = n.new('ShaderNodeMath'); away.operation = 'ABSOLUTE'; l.new(offset.outputs[0], away.inputs[0])
    line = n.new('ShaderNodeMapRange'); line.inputs['From Min'].default_value = 0; line.inputs['From Max'].default_value = .07
    line.inputs['To Min'].default_value = 1; line.inputs['To Max'].default_value = 0
    l.new(away.outputs[0], line.inputs['Value'])
    # Facets only in ice that already exists, just behind the edge.
    band = n.new('ShaderNodeMath'); band.operation = 'MULTIPLY'
    l.new(frosty.outputs[0], band.inputs[0]); l.new(formed.outputs[0], band.inputs[1])
    sparkle = n.new('ShaderNodeMath'); sparkle.operation = 'MULTIPLY'
    l.new(facet.outputs[0], sparkle.inputs[0]); l.new(band.outputs[0], sparkle.inputs[1])
    # The edge is not a drawn line: it glints where facets meet it.
    glint = n.new('ShaderNodeMath'); glint.operation = 'MULTIPLY_ADD'; glint.inputs[1].default_value = .75; glint.inputs[2].default_value = .25
    l.new(facet.outputs[0], glint.inputs[0])
    edge_light = n.new('ShaderNodeMath'); edge_light.operation = 'MULTIPLY'
    l.new(line.outputs[0], edge_light.inputs[0]); l.new(glint.outputs[0], edge_light.inputs[1])
    glow = n.new('ShaderNodeMath'); glow.operation = 'MULTIPLY_ADD'; glow.inputs[1].default_value = .16
    l.new(sparkle.outputs[0], glow.inputs[0]); l.new(edge_light.outputs[0], glow.inputs[2])
    # Only the face toward the viewer carries it; the back face would double it.
    geometry = n.new('ShaderNodeNewGeometry')
    front_only = n.new('ShaderNodeMath'); front_only.operation = 'SUBTRACT'; front_only.inputs[0].default_value = 1
    l.new(geometry.outputs['Backfacing'], front_only.inputs[1])
    facing = n.new('ShaderNodeMath'); facing.operation = 'MULTIPLY'
    l.new(glow.outputs[0], facing.inputs[0]); l.new(front_only.outputs[0], facing.inputs[1])
    glow = facing
    shine = n.new('ShaderNodeEmission'); shine.inputs['Color'].default_value = (.9, .94, 1, 1)
    strength = n.new('ShaderNodeMath'); strength.operation = 'MULTIPLY'; strength.inputs[1].default_value = 1.1
    l.new(glow.outputs[0], strength.inputs[0]); l.new(strength.outputs[0], shine.inputs['Strength'])
    lit = n.new('ShaderNodeAddShader')
    surface = frost_mix[1].outputs[0].links[0].to_socket
    l.new(frost_mix[1].outputs[0], lit.inputs[0]); l.new(shine.outputs[0], lit.inputs[1]); l.new(lit.outputs[0], surface)

# ── The single ESC key that stays: the way home ──────────────────────────────
def perimeter(w, d, r):
    out = []
    for cx, cy, start in [(w/2-r, d/2-r, 0), (-w/2+r, d/2-r, 90), (-w/2+r, -d/2+r, 180), (w/2-r, -d/2+r, 270)]:
        for i in range(13):
            a = math.radians(start + i * 90 / 12)
            out.append((cx + r*math.cos(a), cy + r*math.sin(a)))
    return out


def optical_key():
    w = d = 1.26
    rings = [(-.405, .035, .055), (-.399, .018, .053), (-.383, .005, .052), (-.36, 0, .05), (-.33, .003, .05), (-.18, .025, .049), (0, .060, .048),
             (.18, .104, .048), (.31, .137, .048), (.355, .149, .047), (.382, .164, .047), (.394, .181, .045), (.398, .198, .043)]
    vertices = []
    for z, inset, radius in rings:
        vertices.extend((x, y, z) for x, y in perimeter(w - 2*inset, d - 2*inset, radius))
    for s in [.93, .84, .72, .59, .45, .31, .18, .07]:
        z = .398 - .078 * (1 - s*s) ** 1.25
        vertices.extend((x, y, z) for x, y in perimeter((w - .396)*s, (d - .396)*s, min(.043, s*.12)))
    N = 52; count = len(vertices) // N; faces = []
    for ring in range(count - 1):
        for j in range(N):
            nxt = (j + 1) % N
            faces.append((ring*N + j, ring*N + nxt, (ring+1)*N + nxt, (ring+1)*N + j))
    faces.append(tuple(reversed(range(N)))); faces.append(tuple((count-1)*N + j for j in range(N)))
    mesh = bpy.data.meshes.new('EscKeyMesh'); mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new('ESC / the way home', mesh); bpy.context.collection.objects.link(obj)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


def point_on_screen(ndc_x, ndc_y, depth):
    """World point that projects to the given NDC at a distance along the view."""
    forward = (Vector((0, 0, 0)) - camera.location).normalized()
    cam_right = forward.cross(Vector((0, 0, 1))).normalized()
    cam_up = cam_right.cross(forward).normalized()
    tan_v = math.tan(camera_data.angle_y / 2); tan_h = tan_v * 1440 / 900
    return camera.location + forward * depth + cam_right * (ndc_x * tan_h * depth) + cam_up * (ndc_y * tan_v * depth)


if args.scene != 'freeze':
    esc = optical_key()
    esc.location = point_on_screen(-.68, -.62, 18.5)
    esc.rotation_euler = (math.radians(6), math.radians(-4), math.radians(-16))
    esc.scale = (1.25, 1.25, 1.25)
    key_mat, _ = crystal_material('ESC / crystal')
    esc.data.materials.append(key_mat)
    legend_mat = bpy.data.materials.new('Legend / white'); legend_mat.use_nodes = True
    bsdf = legend_mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (.95, .96, 1, 1)
    bsdf.inputs['Emission Color'].default_value = (.95, .96, 1, 1); bsdf.inputs['Emission Strength'].default_value = .7
    curve = bpy.data.curves.new('esc.', 'FONT'); curve.body = 'esc.'; curve.align_x = 'CENTER'; curve.align_y = 'CENTER'; curve.size = .19
    legend = bpy.data.objects.new('Legend / esc.', curve); bpy.context.collection.objects.link(legend)
    legend.parent = esc; legend.location = (0, -.01, .344); legend.data.materials.append(legend_mat)
    legend.visible_glossy = False; legend.visible_transmission = False

# ── Studio light: long white strips, invisible to the camera ─────────────────
def strip(name, offset, size, power, aim=None):
    position = center + toward_camera * offset[0] + right * offset[1] + up * offset[2]
    bpy.ops.mesh.primitive_plane_add(size=1, location=position)
    obj = bpy.context.object; obj.name = name
    target = aim if aim is not None else center
    obj.rotation_euler = (target - obj.location).to_track_quat('Z', 'Y').to_euler()
    obj.scale = (size[0], size[1], 1)
    mat = bpy.data.materials.new(name + ' / white'); mat.use_nodes = True
    ns, ls = mat.node_tree.nodes, mat.node_tree.links; ns.clear()
    e = ns.new('ShaderNodeEmission'); e.inputs['Strength'].default_value = power
    o = ns.new('ShaderNodeOutputMaterial'); ls.new(e.outputs[0], o.inputs['Surface'])
    # Feathered softbox, never a hard glowing polygon in the reflections.
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
    return obj

# A long soft sheen across the upper face, like a product shot of a curved screen.
strip('01 / overhead sheen', (10, 0, 14), (26, 1.1), 3.5)
# Edge lights sit beside and behind, so they live in the bevels, not on the face.
strip('02 / left edge silk', (-2, -17, 2), (.8, 13), 55)
strip('03 / right edge silk', (-3, 18, -1), (.7, 12), 30)
strip('04 / top rim from behind', (-11, 0, 10), (24, .8), 80)
strip('05 / low rim', (2, 1, -11), (22, .6), 45)

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
scene.world = world; scene.camera = camera; scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices()
for device in prefs.devices:
    device.use = device.type == 'METAL'
scene.cycles.device = 'GPU'
scene.cycles.samples = 48 if args.preview else args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 24; scene.cycles.transmission_bounces = 20; scene.cycles.glossy_bounces = 12
scene.cycles.transparent_max_bounces = 16
scene.render.resolution_x = 720 if args.preview else 1440
scene.render.resolution_y = 450 if args.preview else 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Medium High Contrast'; scene.view_settings.exposure = .3
name = args.output or f'{args.scene}{"-preview" if args.preview else ""}'
scene.render.filepath = str(ROOT / 'docs/qa/display-study' / f'{name}.png')
if args.clay:
    clay = bpy.data.materials.new('Clay'); clay.use_nodes = True
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.visible_camera:
            obj.data.materials.clear(); obj.data.materials.append(clay)
    bg.inputs[1].default_value = .6
    wl.new(bg.outputs[0], wn.get('World Output').inputs['Surface'])
    print('ice bounds', [tuple(round(c, 2) for c in ice.matrix_world @ Vector(corner)) for corner in ice.bound_box][:8:7])
if args.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/blender/ice-display-study.blend'))
bpy.ops.render.render(write_still=True)
print('rendered', scene.render.filepath)
