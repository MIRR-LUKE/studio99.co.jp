'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { screenStore, type ScreenLayer } from '@/lib/screen-store';

// Light in the void behind the keyboard: what you type, its prediction, the ⌘
// map and the signatures. There is no surface here, only light, softening and
// dimming toward the edges of a gently curved field. Pages live in the ice
// display instead (IceDisplay).

const vertexShader = `
  attribute vec2 viewUv;
  attribute float arc;
  varying vec2 vViewUv;
  varying float vArc;
  void main(){
    vViewUv=viewUv; vArc=arc;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D overlayMap;
  uniform vec4 overlayXform;
  uniform float hasOverlay, time;
  uniform vec4 caretRect;
  uniform float caretVisible;
  varying vec2 vViewUv;
  varying float vArc;

  vec3 layer(sampler2D map, vec4 xf, vec2 v, float bias){
    vec2 uv=vec2(xf.x*v.x+xf.y, 1.0-(xf.z*v.y+xf.w));
    if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0)return vec3(0.0);
    vec4 sharp=texture2D(map,uv,bias);
    // Halation: only the brightest strokes spread a little light.
    vec4 wide=texture2D(map,uv,bias+3.6);
    vec3 glow=wide.rgb*wide.a*smoothstep(.35,.95,dot(wide.rgb,vec3(.333)));
    return sharp.rgb*sharp.a+glow*.22;
  }

  void main(){
    float edge=abs(vArc);
    float bias=smoothstep(.45,1.15,edge)*1.4;
    float falloff=mix(1.0,.42,smoothstep(.25,1.12,edge))*mix(1.0,.78,smoothstep(.3,.62,abs(vViewUv.y-.5)));
    vec3 light=hasOverlay>.5?layer(overlayMap,overlayXform,vViewUv,bias):vec3(0.0);
    vec2 c=vViewUv;
    float caret=step(caretRect.x,c.x)*step(c.x,caretRect.x+caretRect.z)*step(caretRect.y,c.y)*step(c.y,caretRect.y+caretRect.w);
    light+=vec3(.86,.84,.9)*caret*caretVisible*step(fract(time/1.4),.56);
    gl_FragColor=vec4(light*falloff,1.0);
    #include <colorspace_fragment>
  }
`;

function buildGeometry(camera: THREE.PerspectiveCamera, width: number, height: number, distance: number, curvature: number, margin: number) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  const radius = distance * curvature;
  // Canvas-normalized coordinates, through the camera's (possibly offset) view.
  const view = camera.view?.enabled ? camera.view : null;
  const fullW = view ? view.fullWidth : width, fullH = view ? view.fullHeight : height;
  const offsetX = view ? view.offsetX : 0, offsetY = view ? view.offsetY : 0;
  const columns = 160, rows = 2;
  const positions: number[] = [], viewUv: number[] = [], arc: number[] = [], index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const vy = -margin + (1 + 2 * margin) * (j / rows);
    for (let i = 0; i <= columns; i++) {
      const vx = -margin + (1 + 2 * margin) * (i / columns);
      const flatX = (((vx * width + offsetX) / fullW) * 2 - 1) * distance * tanH;
      const y = (1 - ((vy * height + offsetY) / fullH) * 2) * distance * tanV;
      const theta = flatX / radius;
      positions.push(radius * Math.sin(theta), y, -distance + radius * (1 - Math.cos(theta)));
      viewUv.push(vx, vy);
      arc.push(vx * 2 - 1);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * (columns + 1) + i, b = a + 1, c = a + columns + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('viewUv', new THREE.Float32BufferAttribute(viewUv, 2));
  geometry.setAttribute('arc', new THREE.Float32BufferAttribute(arc, 1));
  geometry.setIndex(index);
  return geometry;
}

type LayerTexture = { texture: THREE.CanvasTexture | null; canvas: HTMLCanvasElement | null; version: number; width?: number; height?: number };

function syncLayer(slot: LayerTexture, source: ScreenLayer, xform: THREE.Vector4, present: { value: number }) {
  // A canvas that changed size needs new GPU storage, not a sub-image upload.
  if (source.canvas !== slot.canvas || (source.canvas && (source.canvas.width !== slot.width || source.canvas.height !== slot.height))) {
    slot.width = source.canvas?.width; slot.height = source.canvas?.height;
    slot.texture?.dispose();
    slot.canvas = source.canvas;
    slot.texture = source.canvas ? new THREE.CanvasTexture(source.canvas) : null;
    if (slot.texture) {
      slot.texture.colorSpace = THREE.SRGBColorSpace;
      slot.texture.anisotropy = 4;
      slot.texture.minFilter = THREE.LinearMipmapLinearFilter;
    }
    slot.version = -1;
  }
  if (slot.texture && slot.version !== source.version) { slot.texture.needsUpdate = true; slot.version = source.version; }
  present.value = slot.texture ? 1 : 0;
  if (slot.canvas) {
    const { width, height } = screenStore.viewport;
    const cw = slot.canvas.width, ch = slot.canvas.height;
    xform.set(width * source.scale / cw, -source.originX * source.scale / cw, height * source.scale / ch, -source.originY * source.scale / ch);
  }
  return slot.texture;
}

export default function ProjectionScreen({ curvature = 1, reducedMotion }: { curvature?: number; reducedMotion: boolean }) {
  const { camera, size, invalidate } = useThree();
  const mesh = useRef<THREE.Mesh>(null);
  const slot = useRef<LayerTexture>({ texture: null, canvas: null, version: -1 });
  const uniforms = useMemo(() => ({
    overlayMap: { value: null as THREE.Texture | null }, overlayXform: { value: new THREE.Vector4() }, hasOverlay: { value: 0 },
    time: { value: 0 }, caretRect: { value: new THREE.Vector4() }, caretVisible: { value: 0 },
  }), []);
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  }), [uniforms]);
  const geometry = useRef<THREE.BufferGeometry | null>(null);
  const shape = useRef('');
  const blink = useRef(0);

  useEffect(() => {
    screenStore.invalidate = () => invalidate();
    return () => { screenStore.invalidate = () => {}; };
  }, [invalidate]);
  useEffect(() => () => {
    material.dispose(); geometry.current?.dispose(); slot.current.texture?.dispose(); clearTimeout(blink.current);
  }, [material]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    // Rebuild the curved field only when the camera's projection changes.
    const perspective = camera as THREE.PerspectiveCamera;
    const distance = perspective.position.length() + 14;
    const view = perspective.view?.enabled ? perspective.view : null;
    const key = [perspective.fov.toFixed(3), perspective.aspect.toFixed(4), size.width, size.height, Math.round(distance * 4), view ? `${view.fullWidth},${view.fullHeight},${view.offsetX},${view.offsetY}` : '', curvature].join('|');
    if (key !== shape.current) {
      shape.current = key;
      geometry.current?.dispose();
      geometry.current = buildGeometry(perspective, size.width, size.height, distance, curvature, screenStore.margin);
      m.geometry = geometry.current;
    }
    m.matrix.copy(camera.matrixWorld);
    m.matrixWorld.copy(camera.matrixWorld);
    uniforms.overlayMap.value = syncLayer(slot.current, screenStore.overlay, uniforms.overlayXform.value, uniforms.hasOverlay);
    const { width, height } = screenStore.viewport;
    const caret = screenStore.caret;
    uniforms.caretRect.value.set(caret.x / width, caret.y / height, caret.width / width, caret.height / height);
    uniforms.caretVisible.value = caret.visible ? 1 : 0;
    uniforms.time.value = reducedMotion ? .2 : clock.elapsedTime;
    // The caret wakes the renderer only at each on/off edge, so a still world stays still.
    if (caret.visible && !reducedMotion && !blink.current) {
      const phase = (clock.elapsedTime / 1.4) % 1;
      const next = (phase < .56 ? .56 - phase : 1 - phase) * 1400 + 16;
      blink.current = window.setTimeout(() => { blink.current = 0; invalidate(); }, next);
    }
  }, -1);

  return <mesh ref={mesh} material={material} frustumCulled={false} matrixAutoUpdate={false} renderOrder={-10} raycast={() => {}} />;
}
