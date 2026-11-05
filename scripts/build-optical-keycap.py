"""Cycles optical study for the user's single crystal Esc reference.

Blender's RGB renderer approximates wavelength dispersion using three Glass
BSDF closures with independent IORs. White studio emitters only; no emissive
rainbow material. This Cycles shader is not directly glTF-compatible.

BLENDER --background --python scripts/build-optical-keycap.py -- --samples 128
"""
import bpy
import math
import argparse
import sys
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--samples',type=int,default=96)
parser.add_argument('--size',type=int,default=850)
parser.add_argument('--portrait',action='store_true')
parser.add_argument('--output',default='crystal-study-01')
parser.add_argument('--spectral',action='store_true')
parser.add_argument('--export-web',action='store_true')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def perimeter(w,d,r):
    out=[]
    for cx,cy,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]:
        for i in range(13):
            a=math.radians(start+i*90/12)
            out.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return out

def optical_key(units=1):
    w=1.26+(units-1)*1.36;d=1.26
    # Polished heel -> long planar trapezoid walls -> narrow crown bevel.
    rings=[(-.405,.035,.055),(-.399,.018,.053),(-.383,.005,.052),(-.36,0,.05),
           (-.33,.003,.05),(-.18,.025,.049),(0,.060,.048),(.18,.104,.048),(.31,.137,.048),(.355,.149,.047),(.382,.164,.047),(.394,.181,.045),(.398,.198,.043)]
    vertices=[]
    for z,inset,radius in rings:
        vertices.extend((x,y,z) for x,y in perimeter(w-2*inset,d-2*inset,radius))
    # Dished top, continuous concentric sampling prevents a flat top box.
    for s in [.93,.84,.72,.59,.45,.31,.18,.07]:
        z=.398-.078*(1-s*s)**1.25
        if units>5: z=.398+.022*(1-s*s)
        vertices.extend((x,y,z) for x,y in perimeter((w-.396)*s,(d-.396)*s,min(.043,s*.12)))
    N=52;count=len(vertices)//N;faces=[]
    for ring in range(count-1):
        for j in range(N):
            nxt=(j+1)%N
            faces.append((ring*N+j,ring*N+nxt,(ring+1)*N+nxt,(ring+1)*N+j))
    faces.append(tuple(reversed(range(N))))
    faces.append(tuple((count-1)*N+j for j in range(N)))
    mesh=bpy.data.meshes.new('OpticalKeycapMesh')
    mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('Crystal / Esc',mesh);bpy.context.collection.objects.link(obj)
    for p in mesh.polygons:p.use_smooth=True
    uv=mesh.uv_layers.new(name='OpticalUV')
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv=((v.x/w)+.5,(v.y/d)+.5)
    return obj

crystal=bpy.data.materials.new('Crown optical crystal / RGB dispersion')
crystal.use_nodes=True
nodes=crystal.node_tree.nodes;nodes.clear();links=crystal.node_tree.links
out=nodes.new('ShaderNodeOutputMaterial');out.location=(600,50)
glasses=[]
for i,(color,ior) in enumerate([((1,0,0,1),1.50),((0,1,0,1),1.535),((0,0,1,1),1.585)]):
    g=nodes.new('ShaderNodeBsdfGlass');g.location=(-400,240-i*210)
    g.label=['RED / long wavelength','GREEN / middle wavelength','BLUE / short wavelength'][i]
    g.distribution='BECKMANN';g.inputs['Color'].default_value=color
    g.inputs['Roughness'].default_value=.036;g.inputs['IOR'].default_value=ior
    glasses.append(g)
add1=nodes.new('ShaderNodeAddShader');add1.location=(0,130)
add2=nodes.new('ShaderNodeAddShader');add2.location=(270,50)
links.new(glasses[0].outputs[0],add1.inputs[0]);links.new(glasses[1].outputs[0],add1.inputs[1])
links.new(add1.outputs[0],add2.inputs[0]);links.new(glasses[2].outputs[0],add2.inputs[1]);links.new(add2.outputs[0],out.inputs['Surface'])
absorb=nodes.new('ShaderNodeVolumeAbsorption');absorb.location=(260,-170)
absorb.inputs['Color'].default_value=(.78,.81,.86,1);absorb.inputs['Density'].default_value=.25
links.new(absorb.outputs[0],out.inputs['Volume'])
key=optical_key();key.data.materials.append(crystal)

white=bpy.data.materials.new('Laser legend / warm white');white.use_nodes=True
p=white.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.95,.96,1,1)
p.inputs['Roughness'].default_value=.25;p.inputs['Emission Color'].default_value=(.95,.96,1,1);p.inputs['Emission Strength'].default_value=.7
curve=bpy.data.curves.new('esc. legend','FONT');curve.body='esc.';curve.align_x='CENTER';curve.align_y='CENTER';curve.size=.17;curve.extrude=.0003;curve.resolution_u=16
label=bpy.data.objects.new('Legend / esc.',curve);bpy.context.collection.objects.link(label);label.location=(0,-.01,.344);label.data.materials.append(white)
label.visible_glossy=False;label.visible_transmission=False

def emitter(name,pos,scale,power,target=(0,0,0),rotation=0):
    pos=(-pos[0],pos[1],pos[2])
    bpy.ops.mesh.primitive_plane_add(size=1,location=pos)
    obj=bpy.context.object;obj.name=name
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('Z','Y').to_euler()
    if rotation:obj.rotation_euler.rotate_axis('Z',rotation)
    obj.scale=(scale[0],scale[1],1)
    mat=bpy.data.materials.new(name+' / white radiance');mat.use_nodes=True
    mat.node_tree.nodes.clear();e=mat.node_tree.nodes.new('ShaderNodeEmission');e.inputs[0].default_value=(1,1,1,1);e.inputs[1].default_value=power
    o=mat.node_tree.nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(e.outputs[0],o.inputs['Surface'])
    # Feather the softbox instead of reflecting a hard-edged glowing polygon.
    ns=mat.node_tree.nodes;ls=mat.node_tree.links
    coord=ns.new('ShaderNodeTexCoord');sep=ns.new('ShaderNodeSeparateXYZ');ls.new(coord.outputs['Generated'],sep.inputs[0])
    fades=[]
    for axis,exponent in [('X',2),('Y',6)]:
        sub=ns.new('ShaderNodeMath');sub.operation='SUBTRACT';sub.inputs[1].default_value=.5;ls.new(sep.outputs[axis],sub.inputs[0])
        mul=ns.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=2;ls.new(sub.outputs[0],mul.inputs[0])
        ab=ns.new('ShaderNodeMath');ab.operation='ABSOLUTE';ls.new(mul.outputs[0],ab.inputs[0])
        pw=ns.new('ShaderNodeMath');pw.operation='POWER';pw.inputs[1].default_value=exponent;ls.new(ab.outputs[0],pw.inputs[0])
        inv=ns.new('ShaderNodeMath');inv.operation='SUBTRACT';inv.inputs[0].default_value=1;ls.new(pw.outputs[0],inv.inputs[1]);fades.append(inv)
    factor=ns.new('ShaderNodeMath');factor.operation='MULTIPLY';ls.new(fades[0].outputs[0],factor.inputs[0]);ls.new(fades[1].outputs[0],factor.inputs[1])
    strength=ns.new('ShaderNodeMath');strength.operation='MULTIPLY';strength.inputs[1].default_value=power;ls.new(factor.outputs[0],strength.inputs[0]);ls.new(strength.outputs[0],e.inputs[1])
    obj.data.materials.append(mat);obj.visible_camera=False
    return obj

# White panels are refracted by the solid crystal into spectral bands.
emitter('01 / long silk left',(-2.2,-1.4,2.1),(.4,4.0),7)
emitter('02 / right strip',(2.1,.6,.8),(.6,3.6),.8)
emitter('03 / back crown',(-.6,2.3,2.3),(2.7,.13),1.3)
emitter('04 / lower bounce',(-2.5,-.5,-.8),(.65,3.0),2.5)
emitter('05 / diagonal card',(1.5,-2.8,-.4),(.3,2.4),1.4,rotation=.4)
emitter('06 / front facet silk',(-4.5,-3.5,-1.0),(.55,3.0),12)
emitter('07 / right facet silk',(3.0,4.0,-1.0),(.5,3.0),10)
emitter('08 / crown line',(-2.0,1.0,3.0),(2.0,.22),4)
emitter('09 / heel rim',(1.0,-2.0,-2.0),(2.0,.32),12)

world=bpy.data.worlds.new('Void / no ambient fill');world.use_nodes=True
wn=world.node_tree.nodes;wl=world.node_tree.links
ambient=wn.get('Background');ambient.inputs[0].default_value=(.8,.85,1,1);ambient.inputs[1].default_value=.035
coord=wn.new('ShaderNodeTexCoord');sep=wn.new('ShaderNodeSeparateXYZ');wl.new(coord.outputs['Normal'],sep.inputs[0])
width=wn.new('ShaderNodeMath');width.operation='DIVIDE';width.inputs[1].default_value=.065;wl.new(sep.outputs['Z'],width.inputs[0])
sq=wn.new('ShaderNodeMath');sq.operation='MULTIPLY';wl.new(width.outputs[0],sq.inputs[0]);wl.new(width.outputs[0],sq.inputs[1])
negative=wn.new('ShaderNodeMath');negative.operation='MULTIPLY';negative.inputs[1].default_value=-1;wl.new(sq.outputs[0],negative.inputs[0])
gauss=wn.new('ShaderNodeMath');gauss.operation='EXPONENT';wl.new(negative.outputs[0],gauss.inputs[0])
gain=wn.new('ShaderNodeMath');gain.operation='MULTIPLY_ADD';gain.inputs[1].default_value=5;gain.inputs[2].default_value=.018;wl.new(gauss.outputs[0],gain.inputs[0]);wl.new(gain.outputs[0],ambient.inputs[1])
black=wn.new('ShaderNodeBackground');black.inputs[0].default_value=(0,0,0,1);black.inputs[1].default_value=0
lp=wn.new('ShaderNodeLightPath');mix=wn.new('ShaderNodeMixShader');wl.new(lp.outputs['Is Camera Ray'],mix.inputs[0]);wl.new(ambient.outputs[0],mix.inputs[1]);wl.new(black.outputs[0],mix.inputs[2]);wl.new(mix.outputs[0],wn.get('World Output').inputs['Surface'])
bpy.context.scene.world=world
camera_data=bpy.data.cameras.new('Reference camera');camera=bpy.data.objects.new('Reference camera',camera_data);bpy.context.collection.objects.link(camera)
camera.location=(-3.1,-3.5,3.8);target=Vector((0,0,0))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.type='ORTHO';camera_data.ortho_scale=6.1 if args.portrait else 2.8
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES'
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='METAL'
scene.cycles.device='GPU';scene.cycles.samples=args.samples
scene.cycles.use_denoising=True;scene.cycles.max_bounces=16;scene.cycles.transmission_bounces=12;scene.cycles.glossy_bounces=8
scene.cycles.sample_clamp_indirect=0
scene.render.resolution_x=730 if args.portrait else args.size
scene.render.resolution_y=1308 if args.portrait else args.size
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.45
scene.render.film_transparent=False
scene.render.filepath=str(ROOT/'docs/qa'/f'{args.output}.png')
scene['art_direction']='User single-key reference: polished transparent trapezoid, dished face, white edge reflections, internal spectral separation. No neon emission.'
if args.spectral:
    # Trace each wavelength independently. Mixing RGB closures at every bounce
    # can switch wavelength along a path and adds noise inside thick glass.
    import numpy as np
    spectral=nodes.new('ShaderNodeBsdfPrincipled');spectral.label='Render pass wavelength';spectral.inputs['Base Color'].default_value=(.55,.56,.58,1)
    spectral.inputs['Transmission Weight'].default_value=1
    spectral.inputs['Roughness'].default_value=.038
    spectral.inputs['Thin Film Thickness'].default_value=0
    spectral.inputs['Thin Film IOR'].default_value=1.36
    links.new(spectral.outputs[0],out.inputs['Surface'])
    result=np.zeros((scene.render.resolution_y*scene.render.resolution_x,4),dtype=np.float32)
    pass_dir=ROOT/'assets/blender/spectral-passes';pass_dir.mkdir(exist_ok=True)
    scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32'
    for channel,ior in enumerate([1.47,1.535,1.62]):
        spectral.inputs['IOR'].default_value=ior
        scene.render.filepath=str(pass_dir/f'{args.output}-{channel}.exr')
        bpy.ops.render.render(write_still=True)
        im=bpy.data.images.load(scene.render.filepath,check_existing=False)
        pixels=np.empty(result.size,dtype=np.float32);im.pixels.foreach_get(pixels)
        rgba=pixels.reshape((-1,4));result[:,channel]=rgba[:,channel]
        bpy.data.images.remove(im)
    result[:,3]=1
    combined=bpy.data.images.new('Dispersion / linear RGB recombination',width=scene.render.resolution_x,height=scene.render.resolution_y,alpha=True,float_buffer=True)
    combined.pixels.foreach_set(result.ravel())
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='8'
    scene.render.filepath=str(ROOT/'docs/qa'/f'{args.output}.png')
    combined.save_render(scene.render.filepath,scene=scene)
    links.new(add2.outputs[0],out.inputs['Surface'])
    nodes.remove(spectral)
    scene['render_pipeline']='Use build-optical-keycap.py --spectral: 3 independent IOR paths, linear RGB assembly, then AgX. Saved material is realtime editable approximation.'
else:
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/optical-keycap-study.blend'))
if args.export_web:
    web=bpy.data.materials.new('Optical crystal / glTF baseline');web.use_nodes=True
    p=web.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.8,.81,.84,1)
    p.inputs['Transmission Weight'].default_value=1;p.inputs['IOR'].default_value=1.535;p.inputs['Roughness'].default_value=.04
    bpy.ops.object.select_all(action='DESELECT')
    library=[]
    for u in [1,1.25,1.5,1.75,2,2.25,2.75,6.25]:
        obj=optical_key(u);obj.name='Keycap_'+str(u).replace('.','_');obj.data.name=obj.name
        factor=(u*1.06-.10)/(1.26+(u-1)*1.36)
        for vertex in obj.data.vertices:
            vertex.co.x*=factor;vertex.co.y*=.76;vertex.co.z*=.76
        obj.data.materials.clear();obj.data.materials.append(web);obj.select_set(True);library.append(obj)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/optical-keycaps.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
    for obj in library:obj.hide_render=True
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/optical-keycaps-library.blend'))
print('OPTICAL_STUDY_OUTPUT',scene.render.filepath)
