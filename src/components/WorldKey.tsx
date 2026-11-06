'use client';

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { KeyBody, jellyGLSL } from '@/lib/key-physics';
import { smoothNoise } from '@/lib/motion';
import { ABSORPTION, CAMERA, EXPOSURE, FLAGS, INK, IORS, PAPER, PROFILE, ROOM, STATEMENT_Z, TINT, profileSamples, restingPose, softboxes, type Card, type LightAngles } from '@/lib/world-key-studio';

// The poster's single key, live and light.
//
// Surface: the Blender keycap (flat face; scripts/render-world-key.py), deformed
// as soft crystal jelly by the physics (src/lib/key-physics.ts).
// Inside: light is traced through the keycap's own profile — the generator's 13
// cross-section rings as a smooth distance field — so there are no textures or
// triangle searches per bounce: entry Fresnel with a thin-film coat, internal
// bounces with total internal reflection and absorption, and each exit split
// into three IORs (1.47 / 1.535 / 1.62) where the spectrum opens.
// Around it: the Cycles studio (paper sweep, dark room, black flags, travelling
// white softboxes) plus the statement printed behind the key, so the words are
// refracted through the glass. Blender's own AgX shows the result.

/** The canvas is larger than the poster's key square so the key can swing freely. */
export const CANVAS_SCALE = 1.6;
const BOUNCES = 3;
const SOLVE = 7;
const PROFILE_SAMPLES = 1024;
/** Pixel budget for the canvas width: ~1.5× on a desktop, 2× on a phone. */
const PIXEL_BUDGET = 1400;
const pixelRatio = (cssWidth: number) => Math.max(1, Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2, PIXEL_BUDGET / Math.max(cssWidth, 1)));
/** Flags in front of the page; those behind it can never be seen through the glass. */
const VISIBLE_FLAGS = FLAGS.filter(f => f.position.z > STATEMENT_Z - .05);
const STATEMENT_TEXTURE = 1536;

const keyVertex = /* glsl */`
  ${jellyGLSL}
  varying vec3 vWorldPosition, vWorldNormal, vRest, vRestNormal;
  void main(){
    vec3 p=position,n=normal;
    vRest=position;vRestNormal=normal;
    jellyDeform(p,n);
    vec4 world=modelMatrix*vec4(p,1.0);
    vWorldPosition=world.xyz;
    vWorldNormal=normalize(mat3(modelMatrix)*n);
    gl_Position=projectionMatrix*viewMatrix*world;
  }
`;

const keyFragment = /* glsl */`
  #include <common>
  #include <iridescence_fragment>
  #define BOUNCES ${BOUNCES}
  #define SOLVE ${SOLVE}
  uniform sampler2D displayLut, statementMap;
  uniform mat4 keyMatrix, keyMatrixInverse, statementViewProjection;
  uniform float exposure, filmThickness, ink, statementZ, trapped;
  uniform vec3 paper, room, tint, absorption, iors;
  uniform sampler2D profile;
  uniform vec2 profileRange;
  uniform float profileScale, profileOffset;
  uniform vec3 boxMin, boxMax;
  uniform vec3 softPosition[4], softX[4], softY[4], softNormal[4];
  uniform vec2 softHalf[4];
  uniform float softPower[4];
  #define FLAGS ${VISIBLE_FLAGS.length}
  uniform vec3 flagPosition[FLAGS], flagX[FLAGS], flagY[FLAGS], flagNormal[FLAGS];
  uniform vec2 flagHalf[FLAGS];
  varying vec3 vWorldPosition, vWorldNormal, vRest, vRestNormal;

  // ── The keycap as a distance field: its cross-section rings, Hermite-smoothed
  // and sampled into a small lookup (half width, half depth, radius, slope).
  float roundRect(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-r;}
  // Distance to the nearest surface from inside (positive inside).
  vec4 section(float y){
    return texture2D(profile,vec2((clamp(y,profileRange.x,profileRange.y)-profileRange.x)/(profileRange.y-profileRange.x)*profileScale+profileOffset,.5));
  }
  float inside(vec3 p){
    vec4 s=section(p.y);
    return min(min(profileRange.y-p.y,p.y-profileRange.x),-roundRect(p.xz,s.xy,s.z)*inversesqrt(1.0+s.w*s.w));
  }
  // The keycap is convex: from a point inside, the ray leaves it exactly once,
  // before it leaves the bounding box. Bracket that crossing and close in on it
  // (Illinois regula falsi): robust at grazing angles and ~10 evaluations.
  float exitDistance(vec3 o,vec3 d){
    vec3 safe=d+vec3(equal(d,vec3(0.0)))*1e-6;
    vec3 a=(boxMin-o)/safe,b=(boxMax-o)/safe,far=max(a,b);
    float hi=min(min(far.x,far.y),far.z),lo=.0015;
    float fhi=inside(o+d*hi),flo=inside(o+d*lo);
    // At a grazing rim the start can sit a hair outside the field: move in first.
    for(int k=0;k<3;k++){if(flo>0.0)break;lo*=4.0;flo=inside(o+d*lo);}
    if(flo<=0.0)return lo;
    for(int i=0;i<SOLVE;i++){
      float t=clamp(hi-fhi*(hi-lo)/(fhi-flo),lo,hi);
      float f=inside(o+d*t);
      if(f>0.0){lo=t;flo=f;fhi*=.5;}else{hi=t;fhi=f;flo*=.5;}
    }
    return hi;
  }
  // Outward normal, analytic: flat top or bottom, else the rounded section's
  // own direction tilted by the wall's slope (smooth, no finite differences).
  vec3 outward(vec3 p){
    vec4 s=section(p.y);
    vec2 q=abs(p.xz)-s.xy+s.z;
    float lateral=-(length(max(q,0.0))+min(max(q.x,q.y),0.0)-s.z)*inversesqrt(1.0+s.w*s.w);
    float top=profileRange.y-p.y,bottom=p.y-profileRange.x;
    vec2 g=max(q.x,q.y)>0.0?normalize(max(q,0.0))*sign(p.xz):(q.x>q.y?vec2(sign(p.x),0.0):vec2(0.0,sign(p.z)));
    vec3 n=normalize(vec3(g.x,-s.w,g.y));
    // Blend across the polished rims instead of switching faces per pixel.
    n=mix(n,vec3(0.0,1.0,0.0),smoothstep(.004,-.004,top-lateral));
    n=mix(n,vec3(0.0,-1.0,0.0),smoothstep(.004,-.004,bottom-min(lateral,top)));
    return normalize(n);
  }


  // ── The studio (render-world-key.py) and the statement behind the key.
  vec3 world(vec3 d){
    float x=clamp((-d.z+.42)/.60,0.0,1.0);
    return mix(room,paper,x*x*x*(x*(x*6.0-15.0)+10.0));
  }
  // What a ray leaving the crystal sees. Behind the key is the poster itself —
  // paper with the statement printed where the page shows it — so the glass is
  // a window onto the page. Around and in front: the studio's dark room and
  // black flags; the white softboxes light it from wherever they travel.
  vec3 studio(vec3 o,vec3 d){
    vec3 color=world(d);
    float limit=1e9;
    if(d.z<-1e-4){
      float t=(statementZ-o.z)/d.z;
      if(t>0.0){
        limit=t;
        vec4 clip=statementViewProjection*vec4(o+d*t,1.0);
        vec2 uv=clip.xy/clip.w*.5+.5;
        float printed=uv.x>0.0&&uv.y>0.0&&uv.x<1.0&&uv.y<1.0?texture2D(statementMap,uv).a:0.0;
        color=mix(paper,vec3(ink),printed);
      }
    }
    for(int i=0;i<4;i++){
      vec3 n=softNormal[i];
      float den=dot(d,n);
      if(abs(den)<1e-5)continue;
      float t=dot(softPosition[i]-o,n)/den;
      if(t<=0.0)continue;
      vec3 q=o+d*t-softPosition[i];
      vec2 uv=vec2(dot(q,softX[i]),dot(q,softY[i]))/softHalf[i];
      if(abs(uv.x)>1.0||abs(uv.y)>1.0)continue;
      limit=t;
      color=vec3(softPower[i]*max(1.0-uv.x*uv.x,0.0)*max(1.0-pow(abs(uv.y),6.0),0.0));
    }
    for(int i=0;i<FLAGS;i++){
      vec3 n=flagNormal[i];
      float den=dot(d,n);
      if(abs(den)<1e-5)continue;
      float t=dot(flagPosition[i]-o,n)/den;
      if(t<=0.0||t>=limit)continue;
      vec3 q=o+d*t-flagPosition[i];
      vec2 inside=flagHalf[i]-abs(vec2(dot(q,flagX[i]),dot(q,flagY[i])));
      color*=1.0-smoothstep(-.012,.012,min(inside.x,inside.y));
    }
    return color;
  }
  float dielectric(float cosi,float eta){
    float c=abs(cosi),g=eta*eta-1.0+c*c;
    if(g<0.0)return 1.0;
    g=sqrt(g);
    float a=(g-c)/(g+c),b=(c*(g+c)-1.0)/(c*(g-c)+1.0);
    return .5*a*a*(1.0+b*b);
  }
  vec3 blenderDisplay(vec3 linearColor){
    vec3 position=clamp((log2(max(linearColor,vec3(.00006103515625)))+14.0)/19.0,0.0,1.0)*63.0;
    float blue=floor(position.b),nextBlue=min(blue+1.0,63.0);
    vec2 a=(vec2(mod(blue,8.0),floor(blue/8.0))*64.0+position.rg+.5)/512.0;
    vec2 b=(vec2(mod(nextBlue,8.0),floor(nextBlue/8.0))*64.0+position.rg+.5)/512.0;
    return mix(texture2D(displayLut,a).rgb,texture2D(displayLut,b).rgb,fract(position.b));
  }

  void main(){
    vec3 N=normalize(vWorldNormal);
    vec3 V=normalize(vWorldPosition-cameraPosition);
    if(dot(N,V)>0.0)N=-N;
    float cosi=clamp(-dot(V,N),0.0,1.0);
    vec3 film=evalIridescence(1.0,1.38,max(cosi,.001),filmThickness,vec3(.045));
    vec3 reflectance=mix(vec3(dielectric(cosi,iors.r),dielectric(cosi,iors.g),dielectric(cosi,iors.b)),film,.5);
    vec3 light=reflectance*studio(vWorldPosition,reflect(V,N));
    // One path through the crystal, split into three wavelengths at each exit.
    // Start just inside the surface, so the field and the mesh never disagree about it.
    vec3 pos=vRest-normalize(vRestNormal)*.006;
    vec3 dir=normalize((keyMatrixInverse*vec4(refract(V,N,1.0/iors.g),0.0)).xyz);
    vec3 weight=(1.0-reflectance)*tint;
    for(int b=0;b<BOUNCES;b++){
      float dist=exitDistance(pos,dir);
      pos+=dir*dist;
      weight*=exp(-absorption*dist);
      vec3 n=outward(pos);
      float cosT=max(dot(dir,n),.0);
      vec3 worldPos=(keyMatrix*vec4(pos,1.0)).xyz;
      vec3 inner;
      for(int c=0;c<3;c++){
        vec3 exitDirection=refract(dir,-n,iors[c]);
        if(dot(exitDirection,exitDirection)<1e-6){inner[c]=1.0;continue;}
        inner[c]=dielectric(cosT,1.0/iors[c]);
        light[c]+=weight[c]*(1.0-inner[c])*tint[c]*studio(worldPos,normalize((keyMatrix*vec4(exitDirection,0.0)).xyz))[c];
      }
      weight*=inner;
      if(max(weight.r,max(weight.g,weight.b))<.004)break;
      dir=reflect(dir,-n);
    }
    // Light still trapped by total internal reflection leaves eventually (Cycles
    // follows it for 20 bounces): it carries the studio's average, mostly paper.
    light+=weight*mix(room,paper,trapped);
    gl_FragColor=vec4(blenderDisplay(light*exposure),1.0);
  }
`;

const legendVertex = /* glsl */`
  ${jellyGLSL}
  varying vec2 vUv;
  void main(){
    vec3 p=position,n=vec3(0.0,1.0,0.0);
    jellyDeform(p,n);
    vUv=uv;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
  }
`;
const legendFragment = /* glsl */`
  uniform sampler2D map;
  varying vec2 vUv;
  void main(){ vec4 c=texture2D(map,vUv); gl_FragColor=vec4(c.rgb,c.a); }
`;

/** The profile lookup and the keycap's bounding box. */
function profileUniforms() {
  const { data, bottom, top } = profileSamples(PROFILE_SAMPLES);
  // Half floats filter linearly on every WebGL2 device (full floats may not).
  const half16 = Uint16Array.from(data, v => THREE.DataUtils.toHalfFloat(v));
  const texture = new THREE.DataTexture(half16, PROFILE_SAMPLES, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const half = Math.max(...PROFILE.map(r => r.halfX)), depth = Math.max(...PROFILE.map(r => r.halfZ));
  return {
    profile: { value: texture }, profileRange: { value: new THREE.Vector2(bottom, top) },
    // Sample centres: texel n sits at (n + .5) / count.
    profileScale: { value: (PROFILE_SAMPLES - 1) / PROFILE_SAMPLES }, profileOffset: { value: .5 / PROFILE_SAMPLES },
    boxMin: { value: new THREE.Vector3(-half, bottom, -depth) }, boxMax: { value: new THREE.Vector3(half, top, depth) },
  };
}

function useDisplayLut() {
  const { invalidate } = useThree();
  return useMemo(() => {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.NoColorSpace; texture.flipY = false;
    texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
      .loadAsync('/models/motion/agx-display-lut.png').then(bitmap => { texture.image = bitmap; texture.needsUpdate = true; invalidate(); });
    return texture;
  }, [invalidate]);
}

// "world", printed flat on the face (a grid, so the jelly can bend it).
function buildLegend(top: number) {
  const W = .5, H = .2, NX = 40, NZ = 16;
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    positions.push((i / NX - .5) * W, top + .0016, (j / NZ - .5) * H + .005);
    uvs.push(i / NX, 1 - j / NZ);
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = Math.round(2048 * H / W);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace; texture.anisotropy = 8;
  const draw = () => {
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#131316'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const font = (px: number) => `560 ${px}px "DM Sans", Arial, sans-serif`;
    c.font = font(400);
    const px = 400 * (.37 / W * canvas.width) / c.measureText('world').width;
    c.font = font(px);
    c.fillText('world', canvas.width / 2, canvas.height / 2 + px * .04);
    texture.needsUpdate = true;
  };
  draw();
  document.fonts?.load('560 200px "DM Sans"').then(draw).catch(() => {});
  return { geometry, texture };
}

// The statement as the glass sees it: the page's own lines, drawn where the
// page lays them out, in the canvas's frame (the plane maps through the camera).
function useStatement(statement: RefObject<HTMLElement | null>) {
  const { gl, invalidate } = useThree();
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = STATEMENT_TEXTURE;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    return t;
  }, []);
  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    const draw = () => {
      const element = statement.current; if (!element) return;
      const box = gl.domElement.getBoundingClientRect(); if (!box.width) return;
      const c = canvas.getContext('2d')!;
      const scale = STATEMENT_TEXTURE / box.width;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
      c.setTransform(scale, 0, 0, scale, 0, 0);
      c.fillStyle = '#000'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      for (const line of element.querySelectorAll<HTMLElement>('[data-statement-line]')) {
        const style = getComputedStyle(line), rect = line.getBoundingClientRect(), text = line.textContent ?? '';
        c.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        const m = c.measureText(text);
        const baseline = rect.top - box.top + (rect.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
        c.fillText(text, rect.left - box.left, baseline);
      }
      texture.needsUpdate = true; invalidate();
    };
    draw();
    document.fonts?.ready.then(draw).catch(() => {});
    const observer = new ResizeObserver(draw);
    observer.observe(gl.domElement);
    if (statement.current) observer.observe(statement.current);
    return () => observer.disconnect();
  }, [gl, statement, texture, invalidate]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

type Props = { reducedMotion: boolean; onReady: () => void; statement: RefObject<HTMLElement | null> };

function Key({ reducedMotion, onReady, statement }: Props) {
  const { gl, camera, invalidate, setDpr } = useThree();
  const { nodes } = useGLTF('/models/world-key/keycap.glb');
  const lut = useDisplayLut();
  const statementMap = useStatement(statement);
  const jelly = useMemo(() => ({
    jelly: { value: new THREE.Vector4() }, dent: { value: 0 },
    dentCenter: { value: new THREE.Vector3(0, .3, 0) }, dentDirection: { value: new THREE.Vector3(0, -1, 0) },
  }), []);
  const { geometry, material, legend, legendMaterial } = useMemo(() => {
    const geometry = (nodes.WorldKey as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    const soft = softboxes({ side: 0, crown: 0, strip: 0 });
    const material = new THREE.ShaderMaterial({
      vertexShader: keyVertex, fragmentShader: keyFragment, toneMapped: false, defines: { USE_IRIDESCENCE: '' },
      uniforms: {
        ...jelly, ...profileUniforms(),
        displayLut: { value: lut }, statementMap: { value: statementMap },
        statementViewProjection: { value: new THREE.Matrix4() }, statementZ: { value: STATEMENT_Z }, ink: { value: INK },
        keyMatrix: { value: new THREE.Matrix4() }, keyMatrixInverse: { value: new THREE.Matrix4() },
        exposure: { value: EXPOSURE }, filmThickness: { value: 340 }, trapped: { value: .62 },
        paper: { value: new THREE.Vector3(...PAPER) }, room: { value: new THREE.Vector3(...ROOM) },
        tint: { value: new THREE.Vector3(...TINT) }, absorption: { value: new THREE.Vector3(...ABSORPTION) }, iors: { value: new THREE.Vector3(...IORS) },
        softPosition: { value: soft.map(c => c.position.clone()) }, softX: { value: soft.map(c => c.x.clone()) }, softY: { value: soft.map(c => c.y.clone()) },
        softHalf: { value: soft.map(c => c.half.clone()) }, softPower: { value: soft.map(c => c.power) },
        softNormal: { value: soft.map(c => new THREE.Vector3().crossVectors(c.x, c.y)) },
        flagPosition: { value: VISIBLE_FLAGS.map(c => c.position) }, flagX: { value: VISIBLE_FLAGS.map(c => c.x) }, flagY: { value: VISIBLE_FLAGS.map(c => c.y) },
        flagHalf: { value: VISIBLE_FLAGS.map(c => c.half) }, flagNormal: { value: VISIBLE_FLAGS.map(c => new THREE.Vector3().crossVectors(c.x, c.y)) },
      },
    });
    const legend = buildLegend(geometry.boundingBox!.max.y);
    const legendMaterial = new THREE.ShaderMaterial({
      vertexShader: legendVertex, fragmentShader: legendFragment, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { ...jelly, map: { value: legend.texture } },
    });
    return { geometry, material, legend, legendMaterial };
  }, [nodes, lut, statementMap, jelly]);
  const soft = useRef<Card[]>(softboxes({ side: 0, crown: 0, strip: 0 }));
  useEffect(() => () => { material.dispose(); (material.uniforms.profile.value as THREE.Texture).dispose(); legend.geometry.dispose(); legend.texture.dispose(); legendMaterial.dispose(); }, [material, legend, legendMaterial]);

  const body = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const physics = useMemo(() => {
    const key = new KeyBody();
    if (reducedMotion) {
      // Felt, never ringing: everything critically damped.
      const p = { ...key.params, modes: key.params.modes.map(m => ({ ...m, zeta: 1 })) };
      p.damping = 2 * Math.sqrt(p.stiffness * p.mass);
      p.angularDamping = 2 * Math.sqrt(p.angularStiffness * p.inertia.y);
      return new KeyBody(p);
    }
    return key;
  }, [reducedMotion]);
  const rest = useMemo(() => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), euler: new THREE.Euler() }), []);
  const lean = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const frames = useRef({ count: 0, time: 0, dpr: pixelRatio(gl.domElement.clientWidth), ready: false, warm: 0 });
  const angles = useRef<LightAngles>({ side: 0, crown: 0, strip: 0 });

  useEffect(() => { camera.lookAt(CAMERA.target); camera.updateMatrixWorld(); camera.updateProjectionMatrix(); invalidate(); }, [camera, invalidate]);

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
    const move = (event: PointerEvent) => {
      if (!reducedMotion) {
        lean.current.tx = (event.clientY / window.innerHeight - .5) * .22;
        lean.current.ty = (event.clientX / window.innerWidth - .5) * .42;
      }
      if (!physics.grab) return;
      const rect = canvas.getBoundingClientRect();
      ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      plane.setFromNormalAndCoplanarPoint(physics.grab.normal, physics.grab.anchor);
      if (raycaster.ray.intersectPlane(plane, hit)) physics.drag(hit);
      invalidate();
    };
    const up = () => { if (physics.grab) { physics.release(); document.body.style.cursor = ''; invalidate(); } };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [gl, camera, physics, rest, invalidate, reducedMotion]);

  const down = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    physics.press(event.point, event.ray.direction, rest.position, rest.quaternion);
    document.body.style.cursor = 'grabbing';
    invalidate();
  };

  useFrame(({ clock }, delta) => {
    const group = body.current, key = mesh.current;
    if (!group || !key) return;
    const dt = Math.min(delta, 1 / 20);
    const t = reducedMotion ? 0 : clock.elapsedTime;
    const l = lean.current, k = 1 - Math.exp(-2.4 * dt);
    l.x += (l.tx - l.x) * k; l.y += (l.ty - l.y) * k;
    restingPose(t / 21, rest.euler);
    rest.euler.x += l.x; rest.euler.y += l.y;
    rest.quaternion.setFromEuler(rest.euler);
    rest.position.set(0, reducedMotion ? 0 : .028 * Math.sin(t * .62) + .011 * Math.sin(t * 1.37 + 1.3), 0);
    physics.step(dt, rest.position, rest.quaternion);
    group.position.copy(rest.position).add(physics.position);
    physics.orientation(rest.quaternion, group.quaternion);
    group.updateMatrixWorld(true);
    const u = material.uniforms;
    u.keyMatrix.value.copy(key.matrixWorld);
    u.keyMatrixInverse.value.copy(key.matrixWorld).invert();
    u.statementViewProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    jelly.jelly.value.set(physics.q[0], physics.q[1], physics.q[2], physics.q[3]);
    jelly.dent.value = physics.q[4];
    jelly.dentCenter.value.copy(physics.dentCenter);
    jelly.dentDirection.value.copy(physics.dentDirection);
    // The softboxes travel unevenly and never stop: the spectrum keeps flowing.
    if (!reducedMotion) {
      const a = angles.current;
      a.side = t * .31 + 1.4 * smoothNoise(t * .07, 52);
      a.crown = t * .23 + 1.1 * smoothNoise(t * .083, 83);
      a.strip = t * .37 + .9 * smoothNoise(t * .11, 97);
      softboxes(a, soft.current);
      for (let i = 0; i < 4; i++) {
        (u.softPosition.value as THREE.Vector3[])[i].copy(soft.current[i].position);
        (u.softX.value as THREE.Vector3[])[i].copy(soft.current[i].x);
        (u.softY.value as THREE.Vector3[])[i].copy(soft.current[i].y);
        (u.softHalf.value as THREE.Vector2[])[i].copy(soft.current[i].half);
        (u.softPower.value as number[])[i] = soft.current[i].power;
        (u.softNormal.value as THREE.Vector3[])[i].crossVectors(soft.current[i].x, soft.current[i].y);
      }
    } else if (!physics.atRest() || Math.abs(l.tx - l.x) > 1e-4) invalidate();
    // Keep the frame rate: after warm-up, step resolution down if frames run long.
    const f = frames.current;
    if (!reducedMotion && ++f.warm > 30) {
      f.count++; f.time += delta;
      if (f.count === 60) {
        if (f.time / f.count > 1 / 50 && f.dpr > 1) { f.dpr = Math.max(1, f.dpr * .85); setDpr(f.dpr); }
        f.count = 0; f.time = 0;
      }
    }
    if (!f.ready) { f.ready = true; requestAnimationFrame(() => onReady()); }
  });

  return <group ref={body}>
    <mesh ref={mesh} geometry={geometry} material={material} onPointerDown={down}
      onPointerOver={() => { if (!physics.grab) document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { if (!physics.grab) document.body.style.cursor = ''; }} />
    <mesh geometry={legend.geometry} material={legendMaterial} raycast={() => {}} />
  </group>;
}

export default function WorldKey(props: Props) {
  const [dpr, setDpr] = useState(1);
  const host = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (host.current) setDpr(pixelRatio(host.current.clientWidth)); }, []);
  const fov = 2 * Math.atan(Math.tan(CAMERA.fov * Math.PI / 360) * CANVAS_SCALE) * 180 / Math.PI;
  const inset = `${-(CANVAS_SCALE - 1) / 2 * 100}%`, extent = `${CANVAS_SCALE * 100}%`;
  return <Canvas className="world-key-canvas" style={{ position: 'absolute', left: inset, top: inset, width: extent, height: extent, pointerEvents: 'auto', touchAction: 'none' }}
    dpr={dpr} ref={host}
    camera={{ position: CAMERA.position.toArray(), fov, near: .1, far: 40 }}
    gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
    frameloop={props.reducedMotion ? 'demand' : 'always'}>
    <Key {...props} />
  </Canvas>;
}
