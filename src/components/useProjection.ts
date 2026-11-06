'use client';

import {useEffect,useRef,type RefObject} from 'react';
import {screenStore,touchScreen,wake} from '@/lib/screen-store';
import {paintDom,prepareCanvas} from '@/lib/screen-paint';

type Refs={
  experience:RefObject<HTMLDivElement|null>;
  twin:RefObject<HTMLDivElement|null>;
  fixedLayer:RefObject<HTMLDivElement|null>;
  pageLayer:RefObject<HTMLDivElement|null>;
  frame:RefObject<HTMLDivElement|null>;
  display:RefObject<HTMLDivElement|null>;
};

// Keeps the curved screen's light in step with the invisible DOM twin: layout
// changes, typing, focus, scroll and resizes all repaint (batched per frame).
export function useProjection(refs:Refs,enabled:boolean,inWorld:boolean){
  const schedule=useRef<(overlay?:boolean,page?:boolean)=>void>(()=>{});
  const world=useRef(inWorld);world.current=inWorld;

  useEffect(()=>{
    if(!enabled)return;
    const overlayCanvas=document.createElement('canvas'),pageCanvas=document.createElement('canvas');
    let raf=0,alive=true,dirtyOverlay=true,dirtyPage=true;

    const measureFrame=()=>{
      const e=refs.experience.current,f=refs.frame.current,d=refs.display.current;
      if(!e)return;
      const er=e.getBoundingClientRect();
      if(f){const fr=f.getBoundingClientRect();screenStore.frame={x:fr.left-er.left,y:fr.top-er.top,width:fr.width,height:fr.height};}
      if(d){const dr=d.getBoundingClientRect();screenStore.display={x:dr.left-er.left,y:dr.top-er.top,width:dr.width,height:dr.height};}
    };
    const paint=()=>{
      raf=0;
      const e=refs.experience.current,t=refs.twin.current,fixed=refs.fixedLayer.current,page=refs.pageLayer.current;
      if(!alive||!e||!t||!fixed||!page)return;
      const er=e.getBoundingClientRect();
      const W=er.width,H=er.height,m=screenStore.margin;
      screenStore.viewport={width:W,height:H};
      measureFrame();
      const scale=Math.min(window.devicePixelRatio||1,1.5);
      if(dirtyOverlay){
        const ctx=prepareCanvas(overlayCanvas,W*(1+2*m),H*(1+2*m),scale);
        document.documentElement.dataset.projectedOverlay=String(paintDom(fixed,ctx,{originX:er.left-m*W,originY:er.top-m*H,offsetY:0,scale}));
        Object.assign(screenStore.overlay,{canvas:overlayCanvas,version:screenStore.overlay.version+1,originX:-m*W,originY:-m*H,scale});
        const caret=fixed.querySelector<HTMLElement>('.caret');
        const rect=caret?.getBoundingClientRect();
        screenStore.caret=rect&&rect.height>0
          ?{x:rect.left-er.left,y:rect.top-er.top,width:Math.max(2,rect.width),height:rect.height,visible:true}
          :{...screenStore.caret,visible:false};
      }
      if(dirtyPage&&world.current){
        // Inside a world the twin is the display's frame: paint its whole
        // scrolling content at the frame's own size, for the ice to carry.
        const tr=t.getBoundingClientRect();
        const contentHeight=Math.max(t.scrollHeight,t.clientHeight);
        const pageScale=Math.min(scale*1.25,8192/contentHeight,4096/Math.max(1,t.clientWidth));
        const ctx=prepareCanvas(pageCanvas,t.clientWidth,contentHeight,pageScale);
        document.documentElement.dataset.projectedPage=String(paintDom(page,ctx,{originX:tr.left,originY:0,offsetY:t.scrollTop-tr.top,scale:pageScale}));
        Object.assign(screenStore.page,{canvas:pageCanvas,version:screenStore.page.version+1,originX:0,originY:0,scale:pageScale,scroll:t.scrollTop,cssWidth:t.clientWidth,cssHeight:t.clientHeight});
      }
      dirtyOverlay=false;dirtyPage=false;
      touchScreen();
    };
    const request=(overlay=true,page=true)=>{
      dirtyOverlay||=overlay;dirtyPage||=page;
      if(!raf)raf=requestAnimationFrame(paint);
    };
    schedule.current=request;

    const overlayObserver=new MutationObserver(()=>request(true,false));
    const pageObserver=new MutationObserver(()=>request(false,true));
    const observe=()=>{
      if(refs.fixedLayer.current)overlayObserver.observe(refs.fixedLayer.current,{subtree:true,childList:true,characterData:true,attributes:true});
      if(refs.pageLayer.current)pageObserver.observe(refs.pageLayer.current,{subtree:true,childList:true,characterData:true,attributes:true});
    };
    observe();
    const resize=new ResizeObserver(()=>request());
    if(refs.experience.current)resize.observe(refs.experience.current);
    if(refs.frame.current)resize.observe(refs.frame.current);
    if(refs.display.current)resize.observe(refs.display.current);
    if(refs.twin.current)resize.observe(refs.twin.current);
    const twin=refs.twin.current;
    const scroll=()=>{
      if(!twin)return;
      screenStore.page.scroll=twin.scrollTop;
      wake();touchScreen();
    };
    const edit=(event:Event)=>{
      const target=event.target as HTMLElement;
      request(!!refs.fixedLayer.current?.contains(target),!!refs.pageLayer.current?.contains(target));
    };
    const focus=()=>request();
    const selection=()=>{const active=document.activeElement;if(active?.matches('input,textarea'))edit({target:active} as unknown as Event);};
    const viewportResize=()=>request();
    twin?.addEventListener('scroll',scroll,{passive:true});
    document.addEventListener('input',edit,true);
    document.addEventListener('focusin',focus);document.addEventListener('focusout',focus);
    document.addEventListener('selectionchange',selection);
    window.visualViewport?.addEventListener('resize',viewportResize);
    document.fonts?.ready.then(()=>{if(alive)request();});
    request();
    return()=>{
      alive=false;cancelAnimationFrame(raf);
      overlayObserver.disconnect();pageObserver.disconnect();resize.disconnect();
      twin?.removeEventListener('scroll',scroll);document.removeEventListener('input',edit,true);
      document.removeEventListener('focusin',focus);document.removeEventListener('focusout',focus);
      document.removeEventListener('selectionchange',selection);
      window.visualViewport?.removeEventListener('resize',viewportResize);
      schedule.current=()=>{};
      screenStore.overlay.canvas=null;screenStore.page.canvas=null;touchScreen();
    };
  // Refs are stable for the life of the experience.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[enabled]);

  useEffect(()=>{schedule.current(false,true);},[inWorld]);
  return schedule;
}
