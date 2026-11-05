"""Bake fixed-camera optical radiance onto genuine 3D key geometry.
The three camera sectors keep left/center/right keys consistent with the hero.
Three independent IOR renders are recombined before display conversion.
"""
import bpy, math, numpy as np
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/optical-keycap-study.blend'))
scene=bpy.context.scene
for obj in scene.objects:
    if obj.name.startswith('Crystal') or obj.type=='FONT':obj.hide_render=True
    elif obj.type=='MESH':
        obj.location*=6
        obj.scale*=6
camera=scene.camera;camera.data.type='ORTHO';camera.data.sensor_fit='HORIZONTAL'
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='METAL'
scene.cycles.device='GPU';scene.cycles.samples=96;scene.cycles.use_denoising=True
scene.cycles.max_bounces=12;scene.cycles.transmission_bounces=10
scene.view_settings.exposure=.65
destination=ROOT/'public/models/optical';destination.mkdir(exist_ok=True)
cache=ROOT/'assets/blender/bake-cache';cache.mkdir(exist_ok=True)
with bpy.data.libraries.load(str(ROOT/'assets/blender/optical-keycaps-library.blend'),link=False) as (source,target):
    target.objects=[name for name in source.objects if name.startswith('Keycap_')]
geometries={}
for obj in target.objects:
    geometries[obj.name]=obj.data.copy()

mat=bpy.data.materials.new('Baking / wavelength-specific crystal');mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value=(.55,.56,.58,1);bsdf.inputs['Transmission Weight'].default_value=1;bsdf.inputs['Roughness'].default_value=.038
absorb=mat.node_tree.nodes.new('ShaderNodeVolumeAbsorption');absorb.inputs['Color'].default_value=(.78,.81,.86,1);absorb.inputs['Density'].default_value=.25
mat.node_tree.links.new(absorb.outputs[0],mat.node_tree.nodes.get('Material Output').inputs['Volume'])
variants=[]
for u in [1,1.25,1.5,1.75,2,2.25,2.75,6.25]:
    basename='Keycap_'+str(u).replace('.','_')
    for sector,x in [('left',.26),('center',0),('right',-.26)]:
        name=basename+'_'+sector
        mesh=geometries[basename].copy();obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
        mesh.materials.clear();mesh.materials.append(mat)
        camera.location=Vector((x,-.63,.78)).normalized()*8
        camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
        bpy.context.view_layer.update()
        inv=camera.matrix_world.inverted()
        points=[inv@v.co for v in mesh.vertices]
        width=max(p.x for p in points)-min(p.x for p in points)
        height=max(p.y for p in points)-min(p.y for p in points)
        scene.render.resolution_y=384
        scene.render.resolution_x=min(2048,max(256,round(384*width/height)))
        scene.render.resolution_percentage=100
        aspect=scene.render.resolution_x/scene.render.resolution_y
        camera.data.ortho_scale=max(width,height*aspect)*1.12
        bpy.context.view_layer.update()
        uv=mesh.uv_layers.active or mesh.uv_layers.new(name='BakedOpticalView')
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                p=world_to_camera_view(scene,camera,mesh.vertices[mesh.loops[li].vertex_index].co)
                uv.data[li].uv=(p.x,p.y)
        result=np.zeros((scene.render.resolution_x*scene.render.resolution_y,4),dtype=np.float32)
        scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32'
        for channel,ior in enumerate([1.47,1.535,1.62]):
            bsdf.inputs['IOR'].default_value=ior
            scene.render.filepath=str(cache/f'pass-{channel}.exr')
            bpy.ops.render.render(write_still=True)
            image=bpy.data.images.load(scene.render.filepath,check_existing=False)
            pixels=np.empty(result.size,dtype=np.float32);image.pixels.foreach_get(pixels)
            result[:,channel]=pixels.reshape((-1,4))[:,channel];bpy.data.images.remove(image)
        result[:,3]=1
        combined=bpy.data.images.new(name,width=scene.render.resolution_x,height=scene.render.resolution_y,float_buffer=True,alpha=True)
        combined.pixels.foreach_set(result.ravel())
        scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='8'
        combined.save_render(str(destination/f'{name}.png'),scene=scene)
        bpy.data.images.remove(combined)
        obj.hide_render=True;variants.append(obj)
        print('BAKED_VARIANT',name,flush=True)

for obj in scene.objects:obj.select_set(False)
for obj in variants:obj.select_set(True)
# Geometry is the same solid optical model; only its UVs differ by view sector.
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/baked-keycaps.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_materials='NONE')
for obj in variants:
    name=obj.name
    baked=bpy.data.materials.new(name+' / baked optical radiance');baked.use_nodes=True
    n=baked.node_tree.nodes;n.clear();image=n.new('ShaderNodeTexImage');image.image=bpy.data.images.load(str(destination/f'{name}.png'))
    emission=n.new('ShaderNodeEmission');baked.node_tree.links.new(image.outputs['Color'],emission.inputs[0])
    output=n.new('ShaderNodeOutputMaterial');baked.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
    obj.data.materials.clear();obj.data.materials.append(baked)
scene['bake_scope']='Fixed hero camera. Actual 3D geometry, view-dependent precomputed optical radiance; not free-orbit path tracing.'
bpy.ops.file.make_paths_relative()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/baked-keycap-library.blend'))
print('BAKE_COMPLETE: 24 optical textures and real 3D meshes',flush=True)
