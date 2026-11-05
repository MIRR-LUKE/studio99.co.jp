'use client';

import {useEffect,useState} from 'react';
import * as THREE from 'three';
import {CROWN_DIRECTIONS,SIDE_DIRECTIONS,createTransportState,localTransportDirection,sampleDirectionalField} from '@/lib/optical-transport';

type AtlasSize={revision:number;width:number;height:number;gutter:number;textureWidth:number;textureHeight:number;file?:string};
export type OpticalAtlas={texture:THREE.Texture;lut:THREE.Texture;size:AtlasSize};
export type OpticalLight={position:THREE.Vector3;right:THREE.Vector3;up:THREE.Vector3;normal:THREE.Vector3};
export function createOpticalLight():OpticalLight{return {position:new THREE.Vector3(),right:new THREE.Vector3(),up:new THREE.Vector3(),normal:new THREE.Vector3()};}
export function positionOpticalLight(light:OpticalLight,x:number,y:number,z:number){
  light.position.set(x,y,z);light.normal.copy(light.position).negate().normalize();
  light.right.set(0,1,0).cross(light.normal).normalize();light.up.copy(light.normal).cross(light.right).normalize();
}

// The existing optical still appears immediately. Lossless motion bases upload
// gradually; every key of the same shape/view shares the same GPU texture.
export function useOpticalAtlases(gl:THREE.WebGLRenderer,names:string[]) {
  const [atlases,setAtlases]=useState<Record<string,OpticalAtlas>>({});
  useEffect(()=>{
    setAtlases({});
    let active=true;
    const owned:THREE.Texture[]=[];
    async function load(url:string,flipY=false){
      const loader=new THREE.ImageBitmapLoader().setOptions({imageOrientation:flipY?'flipY':'none',premultiplyAlpha:'none',colorSpaceConversion:'none'});
      const bitmap=await loader.loadAsync(url);
      if(!active){bitmap.close();return null;}
      const texture=new THREE.Texture(bitmap);texture.needsUpdate=true;
      texture.colorSpace=THREE.NoColorSpace;texture.flipY=false;
      texture.generateMipmaps=!flipY;texture.minFilter=flipY?THREE.LinearFilter:THREE.LinearMipmapLinearFilter;
      texture.magFilter=THREE.LinearFilter;texture.anisotropy=flipY?1:Math.min(8,gl.capabilities.getMaxAnisotropy());
      owned.push(texture);return texture;
    }
    async function start(){
      const response=await fetch('/models/motion/manifest.json');
      if(!response.ok)return;
      const manifest=await response.json() as {variants:Record<string,AtlasSize>};
      const lut=await load('/models/motion/agx-display-lut.png',true);
      if(!lut)return;
      gl.initTexture(lut);
      for(let i=0;i<names.length;i+=3){
        const batch=await Promise.all(names.slice(i,i+3).map(async name=>{
          const size=manifest.variants[name];
          if(!size||size.revision!==4)return null;
          const texture=await load(`/models/motion/${size.file??`${name}.png`}`);
          return texture?{name,texture,size}:null;
        }));
        for(const item of batch){
          if(!active)return;
          if(!item)continue;
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          if(!active)return;
          gl.initTexture(item.texture);
          setAtlases(previous=>({...previous,[item.name]:{texture:item.texture,lut,size:item.size}}));
        }
      }
    }
    start().catch(error=>{if(active)console.warn('Optical motion unavailable; retaining the glass still.',error);});
    return()=>{active=false;owned.forEach(texture=>{texture.dispose();(texture.image as ImageBitmap).close();});};
  },[gl,names]);
  useEffect(()=>{document.documentElement.dataset.opticalAtlasCount=String(Object.keys(atlases).length);},[atlases]);
  return atlases;
}

const fragmentShader=`
  #include <common>
  #include <iridescence_fragment>
  uniform sampler2D opticalAtlas;
  uniform sampler2D displayLut;
  uniform sampler2D stillMap;
  uniform float loadBlend;
  uniform vec4 tileSize;
  uniform float gutter;
  uniform float sideWeights[6],crownWeights[4];
  uniform vec2 lightStrength;
  uniform float filmThickness;
  uniform vec3 lightPositionA,lightRightA,lightUpA,lightNormalA;
  uniform vec3 lightPositionB,lightRightB,lightUpB,lightNormalB;
  varying vec2 opticalUv;
  varying vec3 opticalWorldPosition,opticalWorldNormal;

  float silkReflection(vec3 ray,vec3 position,vec3 right,vec3 up,vec3 normal,vec2 halfSize){
    float denominator=dot(ray,normal);
    if(abs(denominator)<.0001)return 0.0;
    float distance=dot(position-opticalWorldPosition,normal)/denominator;
    if(distance<=0.0)return 0.0;
    vec3 hit=opticalWorldPosition+ray*distance-position;
    vec2 p=vec2(dot(hit,right),dot(hit,up))/halfSize;
    // Finite diffusing cloth: a soft interior, rounded falloff, no infinite glow.
    return exp(-pow(abs(p.x),4.0)-pow(abs(p.y),4.0))*step(0.0,-denominator);
  }

  vec3 radiance(float index){
    vec2 cell=vec2(mod(index,2.0),floor(index/2.0));
    vec2 pixel=cell*(tileSize.xy+2.0*gutter)+gutter+.5+opticalUv*(tileSize.xy-1.0);
    vec4 encoded=texture2D(opticalAtlas,pixel/tileSize.zw);
    return encoded.rgb*encoded.a*16.0;
  }
  vec3 coatedReflection(vec3 position,vec3 normal,vec3 view,float footprint){
    vec3 toLight=normalize(position-opticalWorldPosition);
    vec3 halfDirection=normalize(toLight+view);
    float cosTheta=clamp(dot(view,halfDirection),.001,1.0);
    // Three.js' dielectric thin-film Fresnel: Snell's law + wavelength-dependent
    // optical path difference. Thickness is fixed to the material, never time.
    vec3 film=evalIridescence(1.0,1.38,cosTheta,filmThickness,vec3(.045));
    vec3 clear=F_Schlick(vec3(.045),1.0,cosTheta);
    return mix(clear,film,.72)*footprint*smoothstep(-.04,.04,dot(normal,toLight));
  }
  vec3 blenderDisplay(vec3 linearColor){
    vec3 position=clamp((log2(max(linearColor,vec3(.00006103515625)))+14.0)/19.0,0.0,1.0)*63.0;
    float blue=floor(position.b),nextBlue=min(blue+1.0,63.0);
    vec2 a=(vec2(mod(blue,8.0),floor(blue/8.0))*64.0+position.rg+.5)/512.0;
    vec2 b=(vec2(mod(nextBlue,8.0),floor(nextBlue/8.0))*64.0+position.rg+.5)/512.0;
    return mix(texture2D(displayLut,a).rgb,texture2D(displayLut,b).rgb,fract(position.b));
  }
  void main(){
    vec3 light=radiance(0.0);
    for(int i=0;i<6;i++)light+=radiance(1.0+float(i))*sideWeights[i]*lightStrength.x;
    for(int i=0;i<4;i++)light+=radiance(7.0+float(i))*crownWeights[i]*lightStrength.y;
    vec3 normal=normalize(opticalWorldNormal);
    vec3 view=normalize(cameraPosition-opticalWorldPosition);
    vec3 ray=reflect(-view,normal);
    float side=silkReflection(ray,lightPositionA,lightRightA,lightUpA,lightNormalA,vec2(1.65,9.0));
    float crown=silkReflection(ray,lightPositionB,lightRightB,lightUpB,lightNormalB,vec2(6.0,.96));
    light+=vec3(1.0,.985,.965)*(coatedReflection(lightPositionA,normal,view,side)*17.0+coatedReflection(lightPositionB,normal,view,crown)*13.0);
    vec3 color=blenderDisplay(light);
    if(loadBlend<1.0){
      vec3 still=texture2D(stillMap,opticalUv).rgb;
      still=mix(1.055*pow(max(still,vec3(0.0)),vec3(1.0/2.4))-.055,12.92*still,step(still,vec3(.0031308)));
      color=mix(still,color,loadBlend);
    }
    gl_FragColor=vec4(color,1.0);
  }
`;

export function createOpticalMaterial(atlas:OpticalAtlas,stillMap:THREE.Texture,lights:OpticalLight[],index:number){
  const {size}=atlas;
  return new THREE.ShaderMaterial({
    defines:{USE_IRIDESCENCE:''},
    uniforms:{
      opticalAtlas:{value:atlas.texture},displayLut:{value:atlas.lut},
      stillMap:{value:stillMap},loadBlend:{value:0},
      tileSize:{value:new THREE.Vector4(size.width,size.height,size.textureWidth,size.textureHeight)},gutter:{value:size.gutter},
      sideWeights:{value:new Float32Array(6)},crownWeights:{value:new Float32Array(4)},lightStrength:{value:new THREE.Vector2(1.3,1.15)},
      filmThickness:{value:325+45*Math.sin((index+1)*71.73)},
      lightPositionA:{value:lights[0].position},lightRightA:{value:lights[0].right},lightUpA:{value:lights[0].up},lightNormalA:{value:lights[0].normal},
      lightPositionB:{value:lights[1].position},lightRightB:{value:lights[1].right},lightUpB:{value:lights[1].up},lightNormalB:{value:lights[1].normal},
    },
    vertexShader:'#include <common>\nvarying vec2 opticalUv; varying vec3 opticalWorldPosition,opticalWorldNormal; void main(){opticalUv=uv;opticalWorldPosition=(modelMatrix*vec4(position,1.0)).xyz;opticalWorldNormal=inverseTransformDirection(normalMatrix*normal,viewMatrix);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader,toneMapped:false,
  });
}

export function updateOpticalMaterial(material:THREE.ShaderMaterial,state:ReturnType<typeof createTransportState>,object:THREE.Object3D,camera:THREE.Camera,lights:OpticalLight[]){
  object.updateWorldMatrix(true,false);
  object.getWorldPosition(state.position);object.getWorldQuaternion(state.inverse).invert();
  state.view.copy(camera.position).sub(state.position).normalize().applyQuaternion(state.inverse);
  sampleDirectionalField(localTransportDirection(state,lights[0].position),SIDE_DIRECTIONS,material.uniforms.sideWeights.value);
  sampleDirectionalField(localTransportDirection(state,lights[1].position),CROWN_DIRECTIONS,material.uniforms.crownWeights.value);
  // No clock or per-key hue animation. Identical light/view/geometry means
  // identical radiance, including while a key is hovered but has settled.
}
