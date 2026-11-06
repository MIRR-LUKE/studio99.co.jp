'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { screenStore } from '@/lib/screen-store';

// The ice display: when a world opens, the keys clear away and this freezes
// into being where they were. It always faces the camera around the HTML
// twin's frame, so its optical look is a single Cycles bake per shape
// (scripts/bake-ice-display.py → public/models/ice). The page is added on top
// as light inside the ice, and the freezing is drawn over it.

type Shape = 'landscape' | 'portrait';
const EXPAND_X = .17, EXPAND_Y = .155; // must match scripts/bake-ice-display.py

// Same proportions as the Blender generator: the ice's outline around the frame.
function outline(frameW: number, frameH: number) {
  const base = Math.min(frameW, frameH * 1.78);
  const rim = base * (.064 + .047);
  // Slightly inside the glass's silhouette, so nothing is drawn beyond the ice.
  return { halfW: frameW / 2 + rim * .93, halfH: frameH / 2 + rim * .9, corner: base * .05 };
}

const vertexShader = `
  varying vec2 vUv;
  void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;

const fragmentShader = `
  uniform sampler2D bakeMap, pageMap;
  uniform float hasBake, hasPage;
  uniform vec2 region;      // crop size in frame widths
  uniform vec4 frame;       // frame offset (x, y from top) and size, in frame widths
  uniform vec3 shape;       // half width, half height, corner (frame widths)
  uniform vec3 pageXform;   // width fraction, view-height fraction, scroll fraction
  uniform float formation, frost, pageFade, reach;
  varying vec2 vUv;

  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
  }
  // Feathery frost: ridged noise, not cells.
  float feathers(vec2 p){
    float n=0.0,a=.5;
    for(int i=0;i<4;i++){n+=a*(1.0-abs(noise(p)*2.0-1.0));p=p*2.07+vec2(3.1,1.7);a*=.5;}
    return n;
  }
  // A few points of light where new crystals catch the studio.
  float sparkle(vec2 p){
    vec2 cell=floor(p*110.0);
    vec2 f=fract(p*110.0)-.5;
    return step(.986,hash(cell))*smoothstep(.42,0.0,length(f));
  }
  vec3 page(vec2 contentUv){
    if(contentUv.x<0.0||contentUv.x>1.0||contentUv.y<0.0||contentUv.y>1.0)return vec3(0.0);
    vec2 t=vec2(contentUv.x*pageXform.x,1.0-(contentUv.y*pageXform.y+pageXform.z));
    vec4 c=texture2D(pageMap,t);
    return c.rgb*c.a;
  }

  void main(){
    // Position in frame widths, from the crop's top-left.
    vec2 p=vec2(vUv.x,1.0-vUv.y)*region;
    vec2 centre=frame.xy+frame.zw*.5;
    // Inside distance to the ice's rounded outline.
    vec2 q=abs(p-centre)-(shape.xy-shape.z);
    float outside=length(max(q,0.0))+min(max(q.x,q.y),0.0)-shape.z;
    float edge=-outside;
    float jitter=(noise(p*9.0)-.5)*.05;
    float front=formation*reach+jitter;
    if(edge>front+.02||outside>0.0)discard;
    float grown=1.0-smoothstep(front-.004,front+.004,edge);
    // Just behind the growing edge the ice is still forming: a narrow band.
    float band=(1.0-smoothstep(0.0,.035,front-edge))*grown;
    float frostTexture=smoothstep(.6,.95,feathers(p*7.0));

    vec3 color=hasBake>.5?texture2D(bakeMap,vUv).rgb*grown:vec3(0.0);
    // The page as light inside the ice: a breath of dispersion away from the centre.
    float clear=(1.0-band)*(1.0-frost)*pageFade*hasPage;
    if(clear>.001){
      vec2 c=(p-frame.xy)/frame.zw;
      vec2 fromCentre=c-.5;
      vec3 light=vec3(page(.5+fromCentre*1.0018).r,page(c).g,page(.5+fromCentre*.9982).b);
      color+=(1.0-exp(-light*3.0*1.15))*clear;
    }
    // The growing edge is a fine, broken line of light; behind it, feathers of
    // frost and a few crystal points. Between worlds a faint frost veils the ice.
    float line=(1.0-smoothstep(0.0,.0025,abs(front-edge)))*(.3+.7*noise(p*70.0));
    // Linear light: small values already read clearly after the display curve.
    float glint=line*.5+band*(.02*frostTexture+.8*sparkle(p))+frost*grown*(.0012+.01*frostTexture+.5*sparkle(p+.37));
    color+=(1.0-exp(-vec3(.9,.94,1.0)*glint*1.4));
    gl_FragColor=vec4(color,1.0);
    #include <colorspace_fragment>
  }
`;

export default function IceDisplay({ reducedMotion }: { reducedMotion: boolean }) {
  const { camera, size, invalidate } = useThree();
  const mesh = useRef<THREE.Mesh>(null);
  const [bakes, setBakes] = useState<Partial<Record<Shape, THREE.Texture>>>({});
  const state = useRef({ formation: -1, frost: 1, fade: 0, since: 0, target: 0, key: '',
    page: { canvas: null as HTMLCanvasElement | null, texture: null as THREE.CanvasTexture | null, version: -1, w: 0, h: 0 } });
  const uniforms = useMemo(() => ({
    bakeMap: { value: null as THREE.Texture | null }, pageMap: { value: null as THREE.Texture | null },
    hasBake: { value: 0 }, hasPage: { value: 0 },
    region: { value: new THREE.Vector2(1, 1) }, frame: { value: new THREE.Vector4() }, shape: { value: new THREE.Vector3() },
    pageXform: { value: new THREE.Vector3(1, 1, 0) },
    formation: { value: 0 }, frost: { value: 1 }, pageFade: { value: 0 }, reach: { value: .4 },
  }), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), [uniforms]);
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);

  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const owned: THREE.Texture[] = [];
    for (const shape of ['landscape', 'portrait'] as Shape[]) {
      loader.load(`/models/ice/${shape}.png`, texture => {
        if (!alive) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; owned.push(texture);
        setBakes(previous => ({ ...previous, [shape]: texture }));
        invalidate();
      });
    }
    return () => { alive = false; owned.forEach(t => t.dispose()); };
  }, [invalidate]);
  useEffect(() => () => { material.dispose(); geometry.dispose(); state.current.page.texture?.dispose(); }, [material, geometry]);

  const scratch = useMemo(() => new THREE.Matrix4(), []);
  // A CSS point carried to camera space on the plane at the given depth.
  const atDepth = (x: number, y: number, depth: number) => {
    const v = new THREE.Vector3((x / size.width) * 2 - 1, 1 - (y / size.height) * 2, .5).unproject(camera).applyMatrix4(scratch.copy(camera.matrixWorld).invert());
    return v.multiplyScalar(depth / -v.z);
  };

  useFrame(({ clock }, delta) => {
    const m = mesh.current;
    if (!m) return;
    const s = state.current;
    const dt = Math.min(delta, .05);

    // Formation follows the world; it begins once the keys have cleared.
    const target = screenStore.power > .5 ? 1 : 0;
    if (target !== s.target) { s.target = target; s.since = clock.elapsedTime; }
    if (s.formation < 0) s.formation = target; // arriving by URL: already there
    if (reducedMotion) s.formation = target;
    else if (target === 1 && clock.elapsedTime - s.since > .55) s.formation = Math.min(1, s.formation + dt / .95);
    else if (target === 0) s.formation = Math.max(0, s.formation - dt / .6);
    const frostGoal = target === 1 && !screenStore.showPage ? 1 : 0;
    s.frost = reducedMotion ? frostGoal : THREE.MathUtils.clamp(s.frost + (frostGoal > s.frost ? dt * 3 : -dt * 1.25), 0, 1);
    const fadeGoal = screenStore.showPage ? 1 : 0;
    s.fade = reducedMotion ? fadeGoal : THREE.MathUtils.clamp(s.fade + (fadeGoal > s.fade ? dt * 2.2 : -dt * 4), 0, 1);
    const animating = (target === 1 && s.formation < 1) || (target === 0 && s.formation > 0) || Math.abs(s.frost - frostGoal) > .001 || Math.abs(s.fade - fadeGoal) > .001;
    uniforms.formation.value = THREE.MathUtils.smoothstep(s.formation, 0, 1);
    uniforms.frost.value = s.frost; uniforms.pageFade.value = s.fade;
    m.visible = s.formation > .001;
    document.documentElement.dataset.iceFormation = s.formation.toFixed(2);

    // The crop of the bake, placed around the HTML twin's frame.
    const rect = screenStore.display;
    if (rect && rect.width > 0 && m.visible) {
      const shape: Shape = rect.width >= rect.height ? 'landscape' : 'portrait';
      const depth = camera.position.length();
      const key = [shape, rect.x, rect.y, rect.width, rect.height, size.width, size.height, depth.toFixed(3), (camera as THREE.PerspectiveCamera).fov.toFixed(3), (camera as THREE.PerspectiveCamera).view?.offsetY ?? 0].join('|');
      if (key !== s.key) {
        s.key = key;
        const fw = rect.width;
        const x0 = rect.x - EXPAND_X * fw, x1 = rect.x + fw + EXPAND_X * fw;
        const y0 = rect.y - EXPAND_Y * fw, y1 = rect.y + rect.height + EXPAND_Y * fw;
        const corners = [atDepth(x0, y1, depth), atDepth(x1, y1, depth), atDepth(x1, y0, depth), atDepth(x0, y0, depth)];
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(c => [c.x, c.y, c.z]), 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        const o = outline(fw, rect.height);
        uniforms.region.value.set((x1 - x0) / fw, (y1 - y0) / fw);
        uniforms.frame.value.set(EXPAND_X, EXPAND_Y, 1, rect.height / fw);
        uniforms.shape.value.set(o.halfW / fw, o.halfH / fw, o.corner / fw);
        uniforms.reach.value = Math.min(o.halfW, o.halfH) / fw + .09;
        uniforms.bakeMap.value = bakes[shape] ?? null;
      }
      uniforms.hasBake.value = uniforms.bakeMap.value ? 1 : 0;
      if (!uniforms.bakeMap.value) { const shape: Shape = rect.width >= rect.height ? 'landscape' : 'portrait'; uniforms.bakeMap.value = bakes[shape] ?? null; }
      m.matrix.copy(camera.matrixWorld); m.matrixWorld.copy(camera.matrixWorld);
    }

    // The page texture, painted by the HTML twin at the frame's size.
    const pageLayer = screenStore.page, p = s.page;
    if (pageLayer.canvas !== p.canvas || (pageLayer.canvas && (pageLayer.canvas.width !== p.w || pageLayer.canvas.height !== p.h))) {
      p.texture?.dispose();
      p.canvas = pageLayer.canvas; p.w = pageLayer.canvas?.width ?? 0; p.h = pageLayer.canvas?.height ?? 0;
      p.texture = pageLayer.canvas ? new THREE.CanvasTexture(pageLayer.canvas) : null;
      if (p.texture) { p.texture.colorSpace = THREE.SRGBColorSpace; p.texture.anisotropy = 8; p.texture.minFilter = THREE.LinearMipmapLinearFilter; }
      p.version = -1;
    }
    if (p.texture && p.version !== pageLayer.version) { p.texture.needsUpdate = true; p.version = pageLayer.version; }
    uniforms.pageMap.value = p.texture; uniforms.hasPage.value = p.texture ? 1 : 0;
    if (p.canvas && pageLayer.cssWidth > 0) {
      uniforms.pageXform.value.set(pageLayer.cssWidth * pageLayer.scale / p.canvas.width, pageLayer.cssHeight * pageLayer.scale / p.canvas.height, pageLayer.scroll * pageLayer.scale / p.canvas.height);
    }
    if (animating) invalidate();
  });

  return <mesh ref={mesh} geometry={geometry} material={material} matrixAutoUpdate={false} frustumCulled={false} renderOrder={5} raycast={() => {}} visible={false} />;
}
