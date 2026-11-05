"""Reproducible, tapered, beveled, dished crystal keycaps. Blender 5.x.
Initial prototype, retained as a production study. The current pipeline is
build-optical-keycap.py. Z-up authoring; glTF exporter converts to Y-up.
"""
import bpy
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

glass = bpy.data.materials.new('Obsidian optical crystal')
glass.use_nodes = True
p = glass.node_tree.nodes.get('Principled BSDF')
p.inputs['Base Color'].default_value = (0.24, 0.25, 0.29, 1)
p.inputs['Roughness'].default_value = 0.095
p.inputs['IOR'].default_value = 1.52
p.inputs['Transmission Weight'].default_value = 0.92
p.inputs['Coat Weight'].default_value = 0.35
p.inputs['Coat Roughness'].default_value = 0.065
if 'Thin Film Thickness' in p.inputs:
    p.inputs['Thin Film Thickness'].default_value = 380
    p.inputs['Thin Film IOR'].default_value = 1.36

def perimeter(w, d, radius):
    pts = []
    for cx, cy, start in [(w/2-radius,d/2-radius,0),(-w/2+radius,d/2-radius,90),(-w/2+radius,-d/2+radius,180),(w/2-radius,-d/2+radius,270)]:
        for j in range(9):
            a = math.radians(start + j*90/8)
            pts.append((cx + radius*math.cos(a), cy + radius*math.sin(a)))
    return pts

def keycap(units):
    w = units * 1.06 - 0.10
    d = 0.94
    # Cross-section: rounded heel, substantial optical wall, sloping shoulder,
    # polished crown and a smoothly dished top. Not a rounded box primitive.
    profiles = [(-.23,.065),(-.224,.035),(-.205,.012),(-.178,0),(-.135,0),(.105,.045),(.155,.058),(.19,.075),(.207,.09),(.213,.105)]
    verts, faces = [], []
    for z, inset in profiles:
        pts = perimeter(w-2*inset,d-2*inset,max(.055,.115-inset*.23))
        verts.extend((x,y,z) for x,y in pts)
    N=36
    # Concentric crown rings gently sag in the middle; long spacebar is convex.
    topw, topd = w-.21, d-.21
    for scale in [.80,.55,.28,.06]:
        z = .213 - .012*(1-scale*scale)
        if units > 5:
            z = .213 + .016*(1-scale*scale)
        verts.extend((x,y,z) for x,y in perimeter(topw*scale,topd*scale,min(.06,topd*scale/3)))
    rings = len(verts)//N
    for r in range(rings-1):
        for j in range(N):
            nj=(j+1)%N
            faces.append((r*N+j,r*N+nj,(r+1)*N+nj,(r+1)*N+j))
    faces.append(tuple(reversed(range(N))))
    faces.append(tuple((rings-1)*N+j for j in range(N)))
    mesh=bpy.data.meshes.new(f'Keycap_{str(units).replace(".","_")}')
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj=bpy.data.objects.new(mesh.name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(glass)
    for poly in mesh.polygons:
        poly.use_smooth=True
    return obj

objects = [keycap(u) for u in [1,1.25,1.5,1.75,2,2.25,2.75,6.25]]
# A reusable asset library, all transforms at origin. Hide variants in Blender
# for a single-key material study while still exporting selected meshes.
for obj in objects:
    obj.select_set(True)
    obj.hide_render = obj != objects[0]
bpy.context.view_layer.objects.active=objects[0]

world=bpy.data.worlds.new('Black studio')
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.006,.006,.009,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.15
bpy.context.scene.world=world
from mathutils import Vector
def softbox(name, location, color, energy, size, target=(0,0,0)):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=energy
    data.color=color
    data.shape='RECTANGLE'
    data.size=size
    data.size_y=.25
    obj=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location=location
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
softbox('Silk / key',(-3,-1,4),(1,.94,.86),500,4)
softbox('Cool edge',(2,1,1),(.4,.64,1),180,3)
softbox('Warm edge',(-1,2,.4),(1,.48,.21),80,2)
camera_data=bpy.data.cameras.new('Material study camera')
camera=bpy.data.objects.new('Material study camera',camera_data)
bpy.context.collection.objects.link(camera)
camera.location=(1.4,-2.4,2.3)
camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.lens=60
bpy.context.scene.camera=camera
bpy.context.scene.render.engine='CYCLES'
bpy.context.scene.cycles.samples=48
bpy.context.scene.render.resolution_x=900
bpy.context.scene.render.resolution_y=900
bpy.context.scene.render.resolution_percentage=100

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in objects:
    obj.select_set(True)
(ROOT/'public/models').mkdir(parents=True,exist_ok=True)
(ROOT/'assets/blender').mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/keycaps.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/keycaps.blend'))
print('Generated 8 shared keycap geometries, editable .blend and web GLB.')
