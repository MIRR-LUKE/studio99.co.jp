"""Compare browser RGBM + Blender LUT reconstruction to the Blender proof.
Run with the Codex runtime Python (numpy / Pillow), after the motion bake.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
folder=ROOT/'public/models/motion'
manifest=json.loads((folder/'manifest.json').read_text())
size=manifest['variants']['Keycap_1_center']
atlas=np.asarray(Image.open(folder/'Keycap_1_center.png').convert('RGBA'),dtype=np.float32)/255
g=size['gutter'];w=size['width'];h=size['height']
bases=[]
for index in range(11):
    x=index%2*(w+g*2)+g;y=index//2*(h+g*2)+g
    encoded=atlas[y:y+h,x:x+w]
    bases.append(encoded[:,:,:3]*encoded[:,:,3:4]*16)
linear=bases[0]+1.3*bases[1]+1.15*(bases[7]*.35+bases[8]*.65)
lut=np.flipud(np.asarray(Image.open(folder/'agx-display-lut.png').convert('RGB'),dtype=np.float32)/255)
position=np.clip((np.log2(np.maximum(linear,2**-14))+14)/19,0,1)*63
low=np.floor(position).astype(int);high=np.minimum(low+1,63);fraction=position-low
result=np.zeros_like(linear)
for dr in range(2):
    for dg in range(2):
        for db in range(2):
            r=high[:,:,0] if dr else low[:,:,0]
            green=high[:,:,1] if dg else low[:,:,1]
            b=high[:,:,2] if db else low[:,:,2]
            weight=(fraction[:,:,0] if dr else 1-fraction[:,:,0])*(fraction[:,:,1] if dg else 1-fraction[:,:,1])*(fraction[:,:,2] if db else 1-fraction[:,:,2])
            result+=lut[(b//8)*64+green,(b%8)*64+r]*weight[:,:,None]
reference=np.asarray(Image.open(ROOT/'docs/qa/optical-motion/study-00.png').convert('RGB'),dtype=np.float32)/255
error=np.abs(result-reference)
mask=np.max(reference,axis=2)>.05
report={'visiblePixelMeanError8Bit':float(error[mask].mean()*255),'visiblePixelP95Error8Bit':float(np.percentile(error[mask],95)*255),'psnrDb':float(-10*np.log10(np.mean(error**2)))}
Image.fromarray(np.round(np.clip(result,0,1)*255).astype('uint8')).save(ROOT/'docs/qa/optical-motion/web-color-reconstruction.png')
(ROOT/'docs/qa/optical-motion/color-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
