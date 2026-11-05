"""Precompute linear spectral light transport for individually animated keys.

11 lighting bases: quiet crystal body, 6 side-silk positions, 4 crown positions.
The browser samples the field using light, key and view directions. Each
basis is traced at three IORs, then stored losslessly as RGBM (range 16).
No image sequence per key and no runtime transmission render targets.
"""
import argparse, json, math, struct, sys, time, zlib
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--variant',default='all')
parser.add_argument('--height',type=int,default=256)
parser.add_argument('--samples',type=int,default=128)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
USED=['Keycap_1_left','Keycap_1_center','Keycap_1_right','Keycap_2_right','Keycap_1_5_left','Keycap_1_5_right','Keycap_1_75_left','Keycap_2_25_right','Keycap_2_25_left','Keycap_2_75_right','Keycap_1_25_left','Keycap_6_25_center','Keycap_1_25_center','Keycap_1_25_right']
variants=USED if args.variant=='all' else args.variant.split(',')
OUT=ROOT/'assets/blender/optical-motion';OUT.mkdir(parents=True,exist_ok=True)
PUBLIC=ROOT/'public/models/motion';PUBLIC.mkdir(parents=True,exist_ok=True)
QA=ROOT/'docs/qa/optical-motion';QA.mkdir(parents=True,exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/blender/optical-keycap-study.blend'))
scene=bpy.context.scene
scene.render.engine='CYCLES'
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='METAL';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='METAL'
scene.cycles.device='GPU';scene.cycles.samples=args.samples
scene.cycles.use_denoising=True;scene.cycles.max_bounces=16
scene.cycles.transmission_bounces=12;scene.cycles.glossy_bounces=8
scene.render.use_persistent_data=True
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.65
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32'
camera=scene.camera;camera.data.type='ORTHO';camera.data.sensor_fit='HORIZONTAL'

panels=[]
for obj in list(scene.objects):
    if obj.type=='FONT' or obj.name.startswith('Crystal'):obj.hide_render=True
    elif obj.type=='MESH':
        obj.location*=6;obj.scale*=6
        panels.append(obj)
        obj['original_location']=list(obj.location)
        obj['original_scale']=list(obj.scale)
        strength=[n for n in obj.active_material.node_tree.nodes if n.type=='MATH' and n.operation=='MULTIPLY' and not n.inputs[1].is_linked and n.inputs[1].default_value>1]
        # The final multiply feeding emission is the light's radiance control.
        emission=next(n for n in obj.active_material.node_tree.nodes if n.type=='EMISSION')
        control=emission.inputs['Strength'].links[0].from_node
        obj['base_power']=control.inputs[1].default_value
        obj['power_node']=control.name

ambient=scene.world.node_tree.nodes.get('Background')
ambient_input=ambient.inputs['Strength']
ambient_link=ambient_input.links[0].from_socket
scene.world.node_tree.links.remove(ambient_input.links[0])
ambient_input.default_value=0
# The internal rainbow is dominated by the horizon reflected through the solid
# crystal. Move that optical source itself; merely moving exterior panels leaves
# the deep spectral band almost unchanged.
world_nodes=scene.world.node_tree.nodes;world_links=scene.world.node_tree.links
coord=next(n for n in world_nodes if n.type=='TEX_COORD')
width_node=next(n for n in world_nodes if n.type=='MATH' and n.operation=='DIVIDE')
normal=world_nodes.new('ShaderNodeVectorMath');normal.operation='DOT_PRODUCT';normal.name='Independent spectral silk direction'
world_links.new(coord.outputs['Normal'],normal.inputs[0]);world_links.new(normal.outputs['Value'],width_node.inputs[0])
normal.inputs[1].default_value=(0,0,1)

def power(obj,value):
    obj.active_material.node_tree.nodes[obj['power_node']].inputs[1].default_value=value

def panel_pose(obj,angle,lift):
    original=Vector(obj['original_location'])
    x=original.x*math.cos(angle)-original.y*math.sin(angle)
    y=original.x*math.sin(angle)+original.y*math.cos(angle)
    obj.location=(x,y,original.z+lift*6)
    obj.rotation_euler=(-obj.location).to_track_quat('Z','Y').to_euler()

silk=next(o for o in panels if o.name.startswith('06'))
crown=next(o for o in panels if o.name.startswith('09'))

def lighting(index):
    for obj in panels:power(obj,0)
    ambient_input.default_value=0
    if ambient_input.is_linked:scene.world.node_tree.links.remove(ambient_input.links[0])
    if index==0:
        # Seven fixed cards preserve the rim. The two travelling emitters must
        # NOT also appear in this static basis: that would leave a frozen rainbow
        # underneath the physically moving light field (revision 3's mistake).
        ambient_input.default_value=0
        for obj in panels:
            panel_pose(obj,0,0)
            power(obj,0 if obj in (silk,crown) else obj['base_power'])
    elif index<=6:
        phase=(index-1)*math.tau/6
        scene.world.node_tree.links.new(ambient_link,ambient_input)
        a=.32*math.sin(phase);b=.18*math.cos(phase)
        normal.inputs[1].default_value=Vector((math.sin(a)*math.cos(b),math.sin(b),math.cos(a)*math.cos(b))).normalized()
        panel_pose(silk,.42*math.sin(phase),.65*math.cos(phase))
        power(silk,17)
    else:
        phase=(index-7)*math.tau/4
        panel_pose(crown,.35*math.cos(phase),.42*math.sin(phase))
        power(crown,13)

with bpy.data.libraries.load(str(ROOT/'assets/blender/optical-keycaps-library.blend'),link=False) as (source,target):
    target.objects=[name for name in source.objects if name.startswith('Keycap_')]
geometries={obj.name:obj.data.copy() for obj in target.objects}
material=bpy.data.materials.new('Motion / independent wavelength transport');material.use_nodes=True
bsdf=material.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value=(.55,.56,.58,1)
bsdf.inputs['Transmission Weight'].default_value=1
bsdf.inputs['Roughness'].default_value=.038
absorb=material.node_tree.nodes.new('ShaderNodeVolumeAbsorption')
absorb.inputs['Color'].default_value=(.78,.81,.86,1);absorb.inputs['Density'].default_value=.25
material.node_tree.links.new(absorb.outputs[0],material.node_tree.nodes.get('Material Output').inputs['Volume'])

def png(path,rgba):
    h,w,_=rgba.shape
    def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+row.tobytes() for row in rgba)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))

def rgbm(linear):
    rgb=np.maximum(linear[:,:,:3],0)
    multiplier=np.maximum(np.ceil(np.clip(rgb.max(axis=2)/16,0,1)*255)/255,1/255)
    encoded=np.dstack((np.clip(rgb/(multiplier[:,:,None]*16),0,1),multiplier))
    return np.round(encoded*255).astype(np.uint8)

manifest_path=PUBLIC/'manifest.json'
manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'version':2,'encoding':'RGBM16','columns':2,'rows':6,'bases':11,'variants':{}}
manifest['version']=4

# A 64^3 log-domain LUT uses Blender's own AgX + look + exposure transform.
# This avoids a different Web tone mapper changing the approved glass finish.
lut_size=64;lut=np.zeros((512,512,4),dtype=np.float32)
for blue in range(lut_size):
    for green in range(lut_size):
        row=blue//8*64+green;col=blue%8*64
        lut[row,col:col+64,0]=np.exp2(np.arange(64)/63*19-14)
        lut[row,col:col+64,1]=2**(green/63*19-14)
        lut[row,col:col+64,2]=2**(blue/63*19-14)
        lut[row,col:col+64,3]=1
image=bpy.data.images.new('Blender AgX display LUT',width=512,height=512,float_buffer=True,alpha=True)
image.pixels.foreach_set(lut.ravel());scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='8'
image.save_render(str(PUBLIC/'agx-display-lut.png'),scene=scene);bpy.data.images.remove(image)
scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32'
started=time.time()
for name in variants:
    basename,sector=name.rsplit('_',1)
    mesh=geometries[basename].copy();obj=bpy.data.objects.new('Motion / '+name,mesh)
    scene.collection.objects.link(obj);mesh.materials.clear();mesh.materials.append(material)
    camera.location=Vector(({'left':.26,'center':0,'right':-.26}[sector],-.63,.78)).normalized()*8
    camera.rotation_euler=(-camera.location).to_track_quat('-Z','Y').to_euler()
    bpy.context.view_layer.update()
    inv=camera.matrix_world.inverted();points=[inv@v.co for v in mesh.vertices]
    width=max(p.x for p in points)-min(p.x for p in points)
    height=max(p.y for p in points)-min(p.y for p in points)
    original_width=min(2048,max(256,round(384*width/height)))
    scene.render.resolution_y=args.height
    scene.render.resolution_x=round(original_width*args.height/384)
    aspect=original_width/384
    camera.data.ortho_scale=max(width,height*aspect)*1.12
    w=scene.render.resolution_x;h=args.height
    bases=[];folder=OUT/name;folder.mkdir(exist_ok=True)
    for index in range(11):
        cached=folder/f'{index:02}.npy'
        refresh_base=index==0 and manifest['variants'].get(name,{}).get('revision',0)<4
        if cached.exists() and not refresh_base:
            result=np.load(cached)
            if result.shape!=(h,w,4):raise RuntimeError('Cache dimensions differ; use a separate cache before changing resolution')
        else:
            if cached.exists() and refresh_base:
                backup=folder/'00.revision3.npy'
                if not backup.exists():backup.write_bytes(cached.read_bytes())
            lighting(index)
            result=np.zeros((h*w,4),dtype=np.float32)
            for channel,ior in enumerate([1.47,1.535,1.62]):
                bsdf.inputs['IOR'].default_value=ior
                scene.cycles.seed=channel*71+index*13
                scene.render.filepath=str(OUT/f'working-{channel}.exr')
                bpy.ops.render.render(write_still=True)
                im=bpy.data.images.load(scene.render.filepath,check_existing=False)
                pixels=np.empty(result.size,dtype=np.float32);im.pixels.foreach_get(pixels)
                result[:,channel]=pixels.reshape((-1,4))[:,channel];bpy.data.images.remove(im)
            result[:,3]=1
            result=result.reshape(h,w,4)
            np.save(cached,result)
        bases.append(result)
        print('MOTION_BASIS',name,index,round(time.time()-started,1),'sec',flush=True)
    gutter=4;tw=w+gutter*2;th=h+gutter*2
    atlas=np.zeros((th*6,tw*2,4),dtype=np.uint8)
    for index,basis in enumerate(bases):
        encoded=np.flipud(rgbm(basis));padded=np.pad(encoded,((gutter,gutter),(gutter,gutter),(0,0)),mode='edge')
        row=index//2;col=index%2;atlas[row*th:(row+1)*th,col*tw:(col+1)*tw]=padded
    png(PUBLIC/f'{name}.png',atlas)
    manifest['variants'][name]={'revision':4,'width':w,'height':h,'gutter':gutter,'textureWidth':tw*2,'textureHeight':th*6}
    manifest_path.write_text(json.dumps(manifest,indent=2))
    # High-quality Blender display-transform contact sheet sources for the first key.
    if name=='Keycap_1_center':
        for frame in range(24):
            phase=frame/24*6;a=int(phase)%6;b=(a+1)%6;f=phase%1
            second=(frame/24*4+.65)%4;c=int(second);d=(c+1)%4;g=second%1
            composite=bases[0]+1.3*(bases[1+a]*(1-f)+bases[1+b]*f)+1.15*(bases[7+c]*(1-g)+bases[7+d]*g)
            composite[:,:,3]=1
            image=bpy.data.images.new('Optical motion proof',width=w,height=h,float_buffer=True,alpha=True)
            image.pixels.foreach_set(composite.ravel())
            scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='8'
            image.save_render(str(QA/f'study-{frame:02}.png'),scene=scene)
            bpy.data.images.remove(image)
        scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='32'
        lighting(0)
        scene.world.node_tree.links.new(ambient_link,ambient_input)
        # Match the Web rig's uneven physical travel; no material hue keyframes.
        def smooth_noise(t,seed):
            def h(n):
                value=math.sin(n*127.1+seed*311.7)*43758.5453
                return (value-math.floor(value))*2-1
            cell=math.floor(t);f=t-cell;blend=f*f*f*(f*(f*6-15)+10)
            return h(cell)*(1-blend)+h(cell+1)*blend
        for frame in range(1,722,4):
            t=(frame-1)/24
            phase=t*.27+1.6*smooth_noise(t*.065,52)+.32*smooth_noise(t*.21,61)
            crown_phase=t*.19+1.1*smooth_noise(t*.083,83)+.28*smooth_noise(t*.17,97)
            a=.32*math.sin(phase);b=.18*math.cos(phase)
            normal.inputs[1].default_value=Vector((math.sin(a)*math.cos(b),math.sin(b),math.cos(a)*math.cos(b))).normalized()
            normal.inputs[1].keyframe_insert(data_path='default_value',frame=frame)
            panel_pose(silk,.42*math.sin(phase),.65*math.cos(phase));power(silk,17)
            panel_pose(crown,.35*math.cos(crown_phase),.42*math.sin(crown_phase));power(crown,13)
            for light in (silk,crown):
                light.keyframe_insert(data_path='location',frame=frame)
                light.keyframe_insert(data_path='rotation_euler',frame=frame)
        scene.frame_start=1;scene.frame_end=721;scene.render.fps=24;scene.frame_set(1)
        bsdf.inputs['IOR'].default_value=1.535
        scene['optical_motion']='Angle-driven spectral transport: seven static cards, six side-silk positions and four crown positions. Runtime weights follow local light/view directions; no per-key color clock. RGBM16 then AgX.'
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/optical-motion-study.blend'))
        for light in (silk,crown):light.animation_data_clear()
    obj.hide_render=True
    print('MOTION_VARIANT_DONE',name,round(time.time()-started,1),'sec',flush=True)
print('OPTICAL_MOTION_COMPLETE',flush=True)
