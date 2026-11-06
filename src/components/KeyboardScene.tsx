'use client';

import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Environment, Lightformer, useGLTF, useTexture } from '@react-three/drei';
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { COMMANDS } from '@/lib/commands';
import type { World } from '@/lib/world';
import { screenStore } from '@/lib/screen-store';
import ProjectionScreen from './ProjectionScreen';
import IceDisplay from './IceDisplay';
import * as THREE from 'three';
import {RectAreaLightUniformsLib} from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { KEYBOARD_LAYOUT, LOGO_CODE, type KeySpec } from '@/lib/keyboard-layout';
import type { InputAction, InputState } from '@/lib/input-machine';
import { DEPARTURE_SECONDS, KEY_DEPARTURE_SECONDS, advanceFloatingKeys, createFloatingKey, setFloatingAttention, smoothNoise, type FloatingKey } from '@/lib/motion';
import {bakedLightPosition,createTransportState} from '@/lib/optical-transport';
import {advanceKeyResponse,createKeyResponse,exciteKey} from '@/lib/key-response';
import {useOpticalAtlases,createOpticalMaterial,updateOpticalMaterial,createOpticalLight,positionOpticalLight,type OpticalAtlas,type OpticalLight} from './OpticalMotion';

RectAreaLightUniformsLib.init();

const variantFor=(spec:KeySpec)=>`Keycap_${String(spec.u).replace('.','_')}_${spec.x < -3?'left':spec.x > 3?'right':'center'}`;
const desktopOpticalNames=[...new Set(KEYBOARD_LAYOUT.map(spec=>variantFor(spec)))];

type Props = { state:InputState; dispatch:(action:InputAction)=>void; world:World; worldMode:boolean; hints:boolean; preview:string; reducedMotion:boolean; mobile:boolean; editing:boolean; eventSource:RefObject<HTMLDivElement|null>; onReady:()=>void; onFailure:()=>void };
function useLegends() {
  return useMemo(()=>{
    const canvas=document.createElement('canvas'); canvas.width=2048;canvas.height=2048;
    const c=canvas.getContext('2d')!; c.fillStyle='#e9e8ee';c.textAlign='center';c.textBaseline='middle';
    const draw=()=>{
    c.clearRect(0,0,2048,2048);
    KEYBOARD_LAYOUT.forEach((key,index)=>{
      const x=(index%8)*256+128,y=Math.floor(index/8)*192+96;
      const lines=key.label.split('\n');
      if(key.code===LOGO_CODE){c.font='500 50px "DM Sans", Arial, sans-serif';c.fillText(key.label,x,y,226);return;}
      const fontSize=lines.length>1?44:key.code.startsWith('Arrow')?95:key.code.startsWith('F')?55:key.small?39:72;
      c.font=`${key.small?'500':'400'} ${fontSize}px Arial, sans-serif`;
      lines.forEach((line,j)=>c.fillText(line,x,y+(j-(lines.length-1)/2)*58,230));
    });
    };
    draw();
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    document.fonts?.load('500 50px "DM Sans"').then(()=>{draw();texture.needsUpdate=true;}).catch(()=>{});
    return texture;
  },[]);
}

function Keycap({spec,index,geometry,material,reflectionMaterial,legend,state,dispatch,preview,reducedMotion,departure,escAnchor,animationTime,pose,optics,lights,mobile,study,tilt}: {
  spec:KeySpec;index:number;geometry:THREE.BufferGeometry;material:THREE.MeshBasicMaterial;reflectionMaterial:THREE.MeshPhysicalMaterial;legend:THREE.Texture;
  state:InputState;dispatch:Props['dispatch'];preview:string;reducedMotion:boolean;
  departure:RefObject<number>;escAnchor:RefObject<THREE.Vector3|null>;
  animationTime:RefObject<number>;
  pose:FloatingKey;
  optics?:OpticalAtlas;
  lights:OpticalLight[];
  mobile:boolean;
  study:boolean;tilt:number;
}) {
  const group=useRef<THREE.Group>(null);const body=useRef<THREE.Mesh>(null);const elastic=useRef<THREE.Group>(null);
  const spring=useRef(createKeyResponse());
  const pointerInside=useRef(false);
  const motion=pose.seed;
  const opticalMaterial=useMemo(()=>optics?createOpticalMaterial(optics,material.map!,lights,index):null,[optics,material,lights,index]);
  const transport=useMemo(()=>createTransportState(study?-.26:spec.x<-3?.26:spec.x>3?-.26:0),[spec,study]);
  useEffect(()=>()=>{opticalMaterial?.dispose();},[opticalMaterial]);
  const pressed=!!state.pressed[spec.code];
  const shifting=!!(state.pressed.ShiftLeft||state.pressed.ShiftRight);
  const labelGeometry=useMemo(()=>{
    const g=new THREE.PlaneGeometry(spec.small?Math.min(spec.u*.9,1.7):.82,.72*(spec.depth??1));
    const uv=g.getAttribute('uv');
    for(let i=0;i<uv.count;i++) uv.setXY(i,((index%8)*256+uv.getX(i)*256)/2048,1-(Math.floor(index/8)*192+(1-uv.getY(i))*192)/2048);
    return g;
  },[spec,index]);
  useEffect(()=>()=>labelGeometry.dispose(),[labelGeometry]);
  useFrame(({camera},delta)=>{
    if(!group.current) return;
    setFloatingAttention(pose,pointerInside.current||pressed);
    const t=reducedMotion?0:animationTime.current;
    const previewIndex=preview.indexOf(spec.key.toUpperCase());
    const wave=previewIndex>=0 && Math.floor(t*6)%Math.max(preview.length,1)===previewIndex;
    const s=spring.current;
    const stroke=state.strokes?.[spec.code]??0;
    // Preserve even a down/up pair arriving between animation frames.
    if(stroke>s.stroke)exciteKey(s,'press',motion.turn<0?-1:1);s.stroke=stroke;
    advanceKeyResponse(s,delta,pressed,reducedMotion);
    const compression=s.amount;
    if(elastic.current){
      elastic.current.position.y=-.17*compression+(wave?.025:0);
      elastic.current.scale.set(1+.045*compression,1-.115*compression,1+.045*compression);
      elastic.current.rotation.x=.022*compression+s.twist*.45;
      elastic.current.rotation.z=motion.turn*.014*compression+s.twist;
    }
    // A world clears the stage: every key leaves on its own path and timing,
    // except ESC, which comes forward to wait beside the ice as the way home.
    const progress=THREE.MathUtils.clamp((departure.current-motion.delay)/KEY_DEPARTURE_SECONDS,0,1);
    const exit=progress*progress*(3-2*progress);
    const anchor=spec.code==='Escape'?escAnchor.current:null;
    let x:number,y:number,z:number,rx=pose.rx+tilt,ry=pose.ry,rz=pose.rz,size=1;
    if(anchor){
      const k=THREE.MathUtils.smoothstep(departure.current/DEPARTURE_SECONDS,0,1);
      x=THREE.MathUtils.lerp(pose.x,anchor.x,k);y=THREE.MathUtils.lerp(pose.y,anchor.y,k);z=THREE.MathUtils.lerp(pose.z,anchor.z,k);
      rx=THREE.MathUtils.lerp(rx,.1,k);ry=THREE.MathUtils.lerp(ry,-.06,k);rz=THREE.MathUtils.lerp(rz,-.28,k);size=1+.3*k;
    }else{
      const directionX=spec.x/8+motion.turn*.3;
      const directionY=-spec.z/3.3+motion.lift*.3;
      const length=Math.hypot(directionX,directionY)||1;
      const nx=directionX/length,ny=directionY/length;
      x=pose.x+nx*27*exit;y=pose.y+(ny*19+motion.lift*2)*exit;z=pose.z+(-ny*9-4)*exit;
      rx+=motion.turn*.3*exit;ry+=motion.lift*.24*exit;rz+=motion.turn*.4*exit;
    }
    group.current.visible=!!anchor||exit<.999;
    group.current.scale.setScalar(size);
    // Anchors attract the keys back into the layout without locking them together.
    const follow=reducedMotion?1:1-Math.exp(-12*Math.min(delta,.05));
    group.current.position.set(
      THREE.MathUtils.lerp(group.current.position.x,x,follow),
      THREE.MathUtils.lerp(group.current.position.y,y,follow),
      THREE.MathUtils.lerp(group.current.position.z,z,follow),
    );
    group.current.rotation.set(rx,ry,rz);
    if(body.current){
      body.current.scale.set(1,1,spec.depth??1);
      if(opticalMaterial){
        updateOpticalMaterial(opticalMaterial,transport,body.current,camera,lights);
        opticalMaterial.uniforms.loadBlend.value=reducedMotion?1:Math.min(1,opticalMaterial.uniforms.loadBlend.value+delta*1.6);
      }
    }
    if(study&&process.env.NODE_ENV!=='production')document.documentElement.dataset.keyResponse=JSON.stringify({amount:s.amount,twist:s.twist,side:opticalMaterial?Array.from(opticalMaterial.uniforms.sideWeights.value):[],crown:opticalMaterial?Array.from(opticalMaterial.uniforms.crownWeights.value):[]});
  });
  const down=(e:ThreeEvent<PointerEvent>)=>{
    // Clicks meant for projected links or fields never press the glass behind them,
    // and keys that have left the stage cannot be pressed.
    if((e.nativeEvent.target as Element|null)?.closest?.('a,button,input,textarea,select,label'))return;
    if(departure.current>.3&&spec.code!=='Escape')return;
    e.stopPropagation();
    setFloatingAttention(pose,true);
    (e.target as unknown as {setPointerCapture:(id:number)=>void}).setPointerCapture(e.pointerId);
    dispatch({type:'down',code:spec.code,key:shifting?(spec.shift??spec.key.toUpperCase()):spec.key,source:`pointer:${e.pointerId}`,visualOnly:mobile&&spec.code!==LOGO_CODE&&spec.code!=='Escape'});
  };
  const up=(e:ThreeEvent<PointerEvent>)=>{
    e.stopPropagation();dispatch({type:'up',code:spec.code,source:`pointer:${e.pointerId}`});
    setFloatingAttention(pose,pointerInside.current);
    (e.target as unknown as {releasePointerCapture:(id:number)=>void}).releasePointerCapture(e.pointerId);
  };
  return <group ref={group} name={spec.code} position={[spec.x,0,spec.z]}>
    <group ref={elastic}>
    <mesh ref={body} geometry={geometry} material={opticalMaterial??material} onPointerDown={down} onPointerUp={up}
      onPointerOver={e=>{e.stopPropagation();if(e.pointerType!=='touch'){
        pointerInside.current=true;setFloatingAttention(pose,true);
        const s=spring.current,now=performance.now();
        if(now-s.hoverAt>180&&!reducedMotion){exciteKey(s,'hover',motion.turn<0?-1:1);s.hoverAt=now;}
        document.body.style.cursor='pointer';
      }}}
      onPointerOut={()=>{pointerInside.current=false;setFloatingAttention(pose,pressed);document.body.style.cursor='';}} />
    <mesh geometry={geometry} material={reflectionMaterial} visible={!opticalMaterial} scale={[1.001,1.001,1.001*(spec.depth??1)]} raycast={()=>{}}/>
    {spec.label && <mesh geometry={labelGeometry} rotation={[-Math.PI/2,0,0]} position={[0,.309,-.012]} raycast={()=>{}}>
      <meshBasicMaterial map={legend} transparent opacity={.88} depthWrite={false} toneMapped={false}/>
    </mesh>}
    {shifting && <mesh geometry={geometry} scale={[.97,.97,.97*(spec.depth??1)]} raycast={()=>{}}><meshBasicMaterial color="#b6c4e4" wireframe transparent opacity={.04}/></mesh>}
    </group>
  </group>;
}

// The map behind ⌘: each known world is the path its letters trace across the
// glass. Thin white light, drawn letter by letter, following the wandering keys.
const TRACE_WORDS=COMMANDS.filter(c=>c.featured).map(c=>c.word);
function Traces({keyboard,visible,preview,reducedMotion}:{keyboard:RefObject<THREE.Group|null>;visible:boolean;preview:string;reducedMotion:boolean}){
  const {invalidate}=useThree();
  const traces=useMemo(()=>TRACE_WORDS.map(word=>{
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(word.length*3),3));
    const material=new THREE.LineBasicMaterial({color:'#f6f3fa',transparent:true,opacity:0,depthTest:false,depthWrite:false,toneMapped:false});
    const line=new THREE.Line(geometry,material);line.renderOrder=20;line.frustumCulled=false;line.raycast=()=>{};
    return {word,line,drawn:0};
  }),[]);
  useEffect(()=>()=>traces.forEach(t=>{t.line.geometry.dispose();(t.line.material as THREE.Material).dispose();}),[traces]);
  useFrame((_,delta)=>{
    const group=keyboard.current;
    if(!group)return;
    let moving=false;
    traces.forEach((trace,index)=>{
      const material=trace.line.material as THREE.LineBasicMaterial;
      const goal=visible?(preview?(preview===trace.word?.95:.16):.55):0;
      material.opacity=reducedMotion?goal:THREE.MathUtils.lerp(material.opacity,goal,1-Math.exp(-8*Math.min(delta,.05)));
      const letters=Array.from(trace.word);
      const target=visible?letters.length:0;
      // Staggered per world, then letter by letter.
      trace.drawn=reducedMotion?target:visible?Math.min(target,trace.drawn+delta*(trace.drawn<0?2:9)):0;
      if(visible&&trace.drawn===0)trace.drawn=-index*.35;
      trace.line.geometry.setDrawRange(0,Math.max(0,Math.ceil(trace.drawn)));
      const position=trace.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      letters.forEach((letter,i)=>{
        const key=group.getObjectByName(`Key${letter}`);
        if(key)position.setXYZ(i,key.position.x,key.position.y+.36,key.position.z);
      });
      position.needsUpdate=true;
      moving||=Math.abs(material.opacity-goal)>.01||(visible&&trace.drawn<target);
    });
    if(moving)invalidate();
  });
  return <>{traces.map(t=><primitive key={t.word} object={t.line}/>)}</>;
}

function Keyboard(props:Props) {
  const {nodes}=useGLTF('/models/baked-keycaps.glb');
  const mobile=props.mobile;const layout=KEYBOARD_LAYOUT;
  const opticalNames=desktopOpticalNames;
  const legend=useLegends();const group=useRef<THREE.Group>(null);
  const {camera,size,gl,scene,invalidate}=useThree();
  const optics=useOpticalAtlases(gl,opticalNames);
  const departure=useRef(props.worldMode?DEPARTURE_SECONDS:0);
  const escAnchor=useRef<THREE.Vector3|null>(null);
  const animationTime=useRef(0);
  const lights=useMemo(()=>[createOpticalLight(),createOpticalLight()],[]);
  const topLight=useRef<THREE.RectAreaLight>(null),frontLight=useRef<THREE.RectAreaLight>(null);
  const opticalTextures=useTexture(opticalNames.map(name=>`/models/optical/${name}.png`));
  const materials=useMemo(()=>Object.fromEntries(opticalNames.map((name,index)=>{
    const texture=opticalTextures[index];texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;texture.anisotropy=8;
    return [name,new THREE.MeshBasicMaterial({map:texture,toneMapped:false})];
  })),[opticalTextures,opticalNames]);
  const reflectionMaterial=useMemo(()=>new THREE.MeshPhysicalMaterial({
    color:'#ffffff',metalness:1,roughness:.075,transparent:true,opacity:.18,blending:THREE.AdditiveBlending,
    depthWrite:false,envMapIntensity:1.15,iridescence:.35,iridescenceIOR:1.3,iridescenceThicknessMinimum:180,iridescenceThicknessMaximum:400,
  }),[]);
  const softbox=useMemo(()=>{
    const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d')!;
    const image=ctx.createImageData(256,128);
    for(let y=0;y<128;y++)for(let x=0;x<256;x++){
      const v=Math.pow(Math.max(0,1-Math.pow((x-128)/128,2)),1.5)*Math.max(0,1-Math.pow((y-64)/64,6));
      const i=(y*256+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=v*255;image.data[i+3]=255;
    }
    ctx.putImageData(image,0,0);return new THREE.CanvasTexture(c);
  },[]);
  const study=!mobile&&typeof window!=='undefined' && new URLSearchParams(window.location.search).has('material');
  const qa=useMemo(()=>{
    const p=new URLSearchParams(window.location.search);
    return {frozen:process.env.NODE_ENV!=='production'&&p.has('freeze'),light:Number(p.get('light'))||0,tilt:process.env.NODE_ENV!=='production'?Number(p.get('tilt'))||0:0};
  },[]);
  const rendered=useMemo(()=>study?[{...KEYBOARD_LAYOUT.find(k=>k.code==='KeyA')!,x:0,z:0}]:layout,[study,layout]);
  const poses=useMemo(()=>rendered.map(spec=>createFloatingKey(spec,layout.findIndex(k=>k.code===spec.code))),[rendered,layout]);
  const cameraPose=useRef({distance:0,x:0,initialized:false});
  // The canvas fills the screen so the projection can; the keyboard keeps the
  // framing of its CSS frame (a smaller rectangle on phones).
  const frameRect=screenStore.frame&&screenStore.frame.width>0&&screenStore.frame.height>0?screenStore.frame:{x:0,y:0,width:size.width,height:size.height};
  const frameKey=`${Math.round(frameRect.x)},${Math.round(frameRect.y)},${Math.round(frameRect.width)},${Math.round(frameRect.height)}`;
  const cameraTarget=useMemo(()=>{
    const aspect=frameRect.width/frameRect.height;
    // Keep the optical study's elevation. A dolly changes the framing, not the
    // material or layout: a close crop at rest, the complete keyboard to type.
    const distance=study?3.6:mobile
      ?Math.max((props.editing?23.5:9.6)/aspect,8.8)/(2*Math.tan(THREE.MathUtils.degToRad(34/2)))
      :aspect<1?33/aspect:size.height<600?26:22.5;
    return {distance,x:study?-distance*.26:mobile&&!props.editing?-1.15:0};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[size,study,mobile,props.editing,frameKey]);
  useEffect(()=>{ props.onReady(); return ()=>{Object.values(materials).forEach(m=>m.dispose());legend.dispose();softbox.dispose();reflectionMaterial.dispose();}; },[materials,legend,softbox,reflectionMaterial]); // resource lifetime follows scene
  useEffect(()=>{
    const canvas=gl.domElement;
    const lost=(e:Event)=>{e.preventDefault();props.onFailure();};
    canvas.addEventListener('webglcontextlost',lost);
    return ()=>canvas.removeEventListener('webglcontextlost',lost);
  },[gl,props.onFailure]);
  const frameStats=useRef({frames:0,total:0});
  useFrame((_,delta)=>{
    if(!group.current)return;
    const elapsed=Math.min(delta,.1);
    const c=cameraPose.current;
    const follow=props.reducedMotion||!c.initialized?1:1-Math.exp(-7*Math.min(delta,.05));
    c.distance=THREE.MathUtils.lerp(c.distance,cameraTarget.distance,follow);
    c.x=THREE.MathUtils.lerp(c.x,cameraTarget.x,follow);c.initialized=true;
    camera.position.set(c.x,c.distance*.78,c.distance*.63);
    camera.lookAt(study?0:c.x,0,0);camera.updateMatrixWorld();
    // Same focal length as the frame, widened to the full canvas, with the
    // principal point at the frame's centre: the keyboard's framing is unchanged.
    const live=screenStore.frame&&screenStore.frame.width>0?screenStore.frame:frameRect;
    const focal=(live.height/2)/Math.tan(THREE.MathUtils.degToRad(17));
    const cx=live.x+live.width/2,cy=live.y+live.height/2;
    const fullW=2*Math.max(cx,size.width-cx),fullH=2*Math.max(cy,size.height-cy);
    const perspective=camera as THREE.PerspectiveCamera;
    const fov=THREE.MathUtils.radToDeg(2*Math.atan((fullH/2)/focal));
    if(Math.abs(perspective.fov-fov)>1e-4||!perspective.view||Math.abs(perspective.view.offsetY-(fullH/2-cy))>.5||Math.abs(perspective.view.fullWidth-fullW)>.5){
      perspective.fov=fov;perspective.aspect=fullW/fullH;
      perspective.setViewOffset(fullW,fullH,fullW/2-cx,fullH/2-cy,size.width,size.height);
    }
    // Keys leave when a world opens and return when it closes.
    const goal=props.worldMode?DEPARTURE_SECONDS:0;
    departure.current=props.reducedMotion?goal:THREE.MathUtils.clamp(departure.current+(props.worldMode?elapsed:-elapsed*1.15),0,DEPARTURE_SECONDS);
    group.current.position.y=-.25;
    // ESC waits just outside the ice's lower-left corner, a little nearer than it.
    const d=screenStore.display;
    if(d&&d.width>0){
      const depth=camera.position.length()*.8;
      const px=d.x-d.width*.1,py=d.y+d.height*1.12;
      const v=(escAnchor.current??=new THREE.Vector3()).set((px/size.width)*2-1,1-(py/size.height)*2,.5).unproject(camera);
      v.applyMatrix4(camera.matrixWorldInverse);v.multiplyScalar(depth/-v.z).applyMatrix4(camera.matrixWorld);
      group.current.updateMatrixWorld();group.current.worldToLocal(v);
    }
    if(props.worldMode&&!props.reducedMotion&&(performance.now()<screenStore.activeUntil||departure.current<goal))invalidate();
    if(!props.reducedMotion&&!qa.frozen)animationTime.current+=elapsed;
    const t=props.reducedMotion?0:animationTime.current;
    // One physical studio rig shared by every key. Slow, uneven travel and pauses
    // in the actual emitters produce the changes; materials have no time uniform.
    const sideAngle=qa.frozen?qa.light:t*.27+1.6*smoothNoise(t*.065,52)+.32*smoothNoise(t*.21,61);
    const crownAngle=qa.frozen?qa.light+.65:t*.19+1.1*smoothNoise(t*.083,83)+.28*smoothNoise(t*.17,97);
    for(let i=0;i<2;i++){
      const p=bakedLightPosition(i===0?'side':'crown',i===0?sideAngle:crownAngle,lights[i].position);
      positionOpticalLight(lights[i],p.x,p.y,p.z);
    }
    if(topLight.current){topLight.current.position.copy(lights[0].position);topLight.current.lookAt(0,0,0);}
    if(frontLight.current){frontLight.current.position.copy(lights[1].position);frontLight.current.lookAt(0,0,0);}
    scene.environmentRotation.set(0,0,0);
    advanceFloatingKeys(poses,t,delta,props.state.expanding&&!props.worldMode,props.reducedMotion||qa.frozen,mobile?.7:1);
    const stats=frameStats.current;stats.frames++;stats.total+=delta;
    if(stats.frames>=120){
      const fps=120/stats.total;
      document.documentElement.dataset.sceneFps=String(Math.round(fps));
      document.documentElement.dataset.sceneDrawCalls=String(gl.info.render.calls);
      stats.frames=0;stats.total=0;
    }
  });
  return <>
    <rectAreaLight ref={topLight} color="#fffaf5" intensity={17} width={3.3} height={18}/>
    <rectAreaLight ref={frontLight} color="#fffaf5" intensity={13} width={12} height={1.92}/>
    <Environment resolution={512} frames={1}>
      <mesh>
        <sphereGeometry args={[12,64,32]}/>
        <shaderMaterial side={THREE.BackSide} toneMapped={false}
          vertexShader={'varying vec3 studioDirection; void main(){ studioDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }'}
          fragmentShader={'varying vec3 studioDirection; void main(){float y=normalize(studioDirection).y; float radiance=.018+3.0*exp(-pow(y/.065,2.0)); gl_FragColor=vec4(vec3(.8,.85,1.0)*radiance,1.0);}'} />
      </mesh>
      <Lightformer map={softbox} intensity={7} position={[2.2,2.1,1.4]} scale={[.4,4,1]}/>
      <Lightformer map={softbox} intensity={.8} position={[-2.1,.8,-.6]} scale={[.6,3.6,1]}/>
      <Lightformer map={softbox} intensity={1.3} position={[.6,2.3,-2.3]} scale={[2.7,.13,1]}/>
      <Lightformer map={softbox} intensity={2.5} position={[2.5,-.8,.5]} scale={[.65,3,1]}/>
      <Lightformer map={softbox} intensity={1.4} position={[-1.5,-.4,2.8]} scale={[.3,2.4,1]}/>
      <Lightformer map={softbox} intensity={12} position={[4.5,-1,3.5]} scale={[.55,3,1]}/>
      <Lightformer map={softbox} intensity={10} position={[-3,-1,-4]} scale={[.5,3,1]}/>
      <Lightformer map={softbox} intensity={4} position={[2,3,-1]} scale={[2,.22,1]}/>
      <Lightformer map={softbox} intensity={12} position={[-1,-2,2]} scale={[2,.32,1]}/>
    </Environment>
    <color attach="background" args={['#030304']}/>
    <group ref={group} rotation={[0,-.07,-.055]} dispose={null}>
      <Traces keyboard={group} visible={props.hints} preview={props.preview} reducedMotion={props.reducedMotion}/>
      {rendered.map((spec,index)=><Keycap key={spec.code} spec={spec} index={layout.findIndex(k=>k.code===spec.code)} pose={poses[index]} lights={lights} mobile={mobile} study={study} tilt={qa.tilt}
        geometry={(nodes[study?'Keycap_1_right':variantFor(spec)] as THREE.Mesh).geometry}
        material={materials[study?'Keycap_1_right':variantFor(spec)]} optics={optics[study?'Keycap_1_right':variantFor(spec)]} reflectionMaterial={reflectionMaterial} legend={legend} state={props.state} dispatch={props.dispatch} preview={props.preview} reducedMotion={props.reducedMotion} departure={departure} escAnchor={escAnchor} animationTime={animationTime}/>)}
    </group>
  </>;
}

export default function KeyboardScene(props:Props) {
  const [visible,setVisible]=useState(true);
  useEffect(()=>{const change=()=>setVisible(!document.hidden);change();document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change);},[]);
  return <Canvas camera={{position:[0,14,11],fov:34,near:.1,far:100}} dpr={[1,1.6]} frameloop={props.worldMode||props.reducedMotion||!visible?'demand':'always'}
    eventSource={props.eventSource as RefObject<HTMLElement>} eventPrefix="client"
    gl={{antialias:true,alpha:true,powerPreference:'high-performance'}}
    onCreated={({gl})=>{gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.2;}}
    fallback={<span className="webgl-fallback">TYPE YOUR WORLD.</span>}>
    <ProjectionScreen reducedMotion={props.reducedMotion}/>
    <IceDisplay reducedMotion={props.reducedMotion}/>
    <Suspense fallback={null}><Keyboard {...props}/></Suspense>
  </Canvas>;
}
