'use client';

// The keyboard world (hero keyboard, typing, ice display). Paused on 2026-11-06
// in favour of the single floating world key; kept intact to return to.
import './keyboard-experience.css';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Component, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { COMMANDS, normalize, predictCommands } from '@/lib/commands';
import { consumesKey, initialInput, inputReducer, type InputAction } from '@/lib/input-machine';
import { DEPARTURE_SECONDS } from '@/lib/motion';
import { KEY_BY_CODE } from '@/lib/keyboard-layout';
import { worldFromPath } from '@/lib/world';
import { screenStore, touchScreen, wake } from '@/lib/screen-store';
import { useProjection } from './useProjection';
import { CarryContext } from './WorldCarry';

const KeyboardScene=dynamic(()=>import('./KeyboardScene'),{ssr:false});
class SceneBoundary extends Component<{children:ReactNode; onFailure:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onFailure();}
  render(){return this.state.failed?null:this.props.children;}
}

const DEMO_KEY='studio99-demo-seen';

export default function Experience({children}:{children:ReactNode}) {
  const [state,dispatch]=useReducer(inputReducer,initialInput);
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[preview,setPreview]=useState('');
  const [reducedMotion,setReducedMotion]=useState(false);
  const [mobile,setMobile]=useState(false),[nativeInput,setNativeInput]=useState(false);
  const [carry,setCarry]=useState('');
  const experience=useRef<HTMLDivElement>(null),twin=useRef<HTMLDivElement>(null);
  const fixedLayer=useRef<HTMLDivElement>(null),pageLayer=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null),display=useRef<HTMLDivElement>(null);
  const compositionBefore=useRef('');
  const pathname=usePathname();const router=useRouter();const current=useRef(state);current.current=state;
  const mobileInput=useRef<HTMLInputElement>(null);
  const composing=useRef(false);
  const demo=useRef<{timers:number[];active:boolean}>({timers:[],active:false});
  const autoTyping=useRef<number[]>([]);
  const stopAutoTyping=useCallback(()=>{autoTyping.current.forEach(clearTimeout);autoTyping.current=[];},[]);
  useEffect(()=>stopAutoTyping,[stopAutoTyping]);
  const world=useMemo(()=>worldFromPath(pathname),[pathname]);
  const inWorld=world.kind!=='hero';
  const departing=state.phase==='leaving';
  const heading=!!state.request&&state.request.path!=='/';
  const worldMode=(inWorld&&!(state.phase==='open'&&state.request?.path==='/'))||(departing&&heading);
  const hints=!departing&&(state.hintPinned||Object.entries(state.pressed).some(([code,sources])=>/^(Meta|Control)/.test(code)&&sources.includes('physical')));
  const predictions=predictCommands(state.text);const candidate=predictions[0];
  const markReady=useCallback(()=>setReady(true),[]);const markFailed=useCallback(()=>{setFailed(true);setReady(true);},[]);
  useProjection({experience,twin,fixedLayer,pageLayer,frame,display},!failed,inWorld);

  useEffect(()=>{
    const query=window.matchMedia('(max-width: 700px)');
    const change=()=>{setMobile(query.matches);};change();
    query.addEventListener('change',change);return()=>query.removeEventListener('change',change);
  },[]);
  useEffect(()=>{
    if(!mobile)return;
    const viewport=window.visualViewport;
    const resize=()=>{
      experience.current?.style.setProperty('--visible-height',`${viewport?.height??window.innerHeight}px`);
      experience.current?.style.setProperty('--visible-top',`${viewport?.offsetTop??0}px`);
    };
    resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
    window.addEventListener('resize',resize);
    return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);window.removeEventListener('resize',resize);};
  },[mobile]);
  useEffect(()=>{
    if(departing){mobileInput.current?.blur();setNativeInput(false);}
  },[departing]);

  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>setReducedMotion(media.matches);change();media.addEventListener('change',change);
    // Avoid booting a renderer at all when WebGL is unavailable.
    const test=document.createElement('canvas');
    if(!test.getContext('webgl2')) markFailed();
    return ()=>media.removeEventListener('change',change);
  },[markFailed]);

  // The URL decides the world; the reducer only learns about it.
  useEffect(()=>{
    dispatch({type:'world',world});setPreview('');setNativeInput(false);
    if(world.path==='/contact'){
      try{setCarry(new URLSearchParams(window.location.search).get('world')?.slice(0,64)??'');}catch{setCarry('');}
    }
    const t=twin.current;
    if(t){t.scrollTop=0;screenStore.page.scroll=0;}
    if(world.kind==='hero')return;
    const timer=window.setTimeout(()=>{
      // Only take focus if nothing else has it, so a field the visitor just chose keeps it.
      const active=document.activeElement;
      if(!active||active===document.body||!twin.current?.contains(active))twin.current?.focus({preventScroll:true});
    },60);
    return()=>clearTimeout(timer);
  },[world]);
  useEffect(()=>{
    if(state.request) router.prefetch(state.request.path);
  },[state.request,router]);
  useEffect(()=>{
    if(!departing)return;
    if(reducedMotion||failed){dispatch({type:'arrive'});return;}
    const timer=window.setTimeout(()=>dispatch({type:'arrive'}),DEPARTURE_SECONDS*1000);
    return()=>clearTimeout(timer);
  },[departing,reducedMotion,failed]);
  useEffect(()=>{
    if(state.phase==='open'&&state.request)router.push(state.request.path);
  },[state.phase,state.request,router]);
  useEffect(()=>{
    if(state.formSubmit)pageLayer.current?.querySelector<HTMLFormElement>('form[data-world-form]')?.requestSubmit();
  },[state.formSubmit]);

  // A world clears the keys away and freezes the ice display into being;
  // between worlds it frosts over, then clears on the next page.
  useEffect(()=>{
    screenStore.power=worldMode?1:0;
    screenStore.showPage=!departing&&inWorld;
    touchScreen();
  },[worldMode,departing,inWorld]);

  // The keyboard introduces itself once: it types a world, takes it back,
  // then shows the map. Any real input stops it immediately.
  const stopDemo=useCallback(()=>{
    const d=demo.current;
    if(!d.active)return;
    d.timers.forEach(clearTimeout);d.timers=[];d.active=false;
    dispatch({type:'text',text:''});
    if(current.current.hintPinned)dispatch({type:'hints'});
  },[]);
  const runDemo=useCallback(()=>{
    if(reducedMotion||demo.current.active||current.current.world.kind!=='hero'||current.current.text)return;
    const d=demo.current;d.active=true;
    let at=350;
    const later=(ms:number,action:()=>void)=>{d.timers.push(window.setTimeout(action,ms));};
    const press=(code:string,key:string)=>{
      later(at,()=>{dispatch({type:'down',code,key,source:'auto'});wake();});
      later(at+95,()=>dispatch({type:'up',code,source:'auto'}));
    };
    for(const letter of 'ABOUT'){press(`Key${letter}`,letter.toLowerCase());at+=170;}
    at+=1100;
    for(let i=0;i<5;i++){press('Backspace','Backspace');at+=85;}
    at+=380;
    later(at,()=>{if(!current.current.hintPinned)dispatch({type:'hints'});});
    at+=2100;
    later(at,()=>{if(current.current.hintPinned)dispatch({type:'hints'});d.active=false;d.timers=[];});
  },[reducedMotion]);
  useEffect(()=>{if(state.demo)runDemo();},[state.demo,runDemo]);
  useEffect(()=>{
    if(!ready||failed||reducedMotion||inWorld)return;
    let seen=false;
    try{seen=sessionStorage.getItem(DEMO_KEY)==='1';}catch{}
    if(seen)return;
    const timer=window.setTimeout(()=>{try{sessionStorage.setItem(DEMO_KEY,'1');}catch{}runDemo();},4000);
    const cancel=()=>clearTimeout(timer);
    window.addEventListener('keydown',cancel,{once:true});window.addEventListener('pointerdown',cancel,{once:true});
    return()=>{cancel();window.removeEventListener('keydown',cancel);window.removeEventListener('pointerdown',cancel);};
  },[ready,failed,reducedMotion,inWorld,runDemo]);

  useEffect(()=>{
    const keydown=(e:KeyboardEvent)=>{
      wake();stopDemo();stopAutoTyping();
      if(e.isComposing||composing.current||e.keyCode===229)return;
      const target=e.target as HTMLElement;
      const editable=target?.matches('input,textarea,select,[contenteditable="true"]');
      if(e.key==='Escape'){
        if(editable){
          // Leave the field without leaving the world. The command field also
          // lets go of its unfinished word; form fields keep their draft.
          dispatch({type:'down',code:e.code,key:e.key,source:'physical',visualOnly:true});
          if(target===mobileInput.current)dispatch({type:'text',text:''});
          target.blur();setNativeInput(false);return;
        }
        dispatch({type:'down',code:e.code,key:e.key,source:'physical'});setPreview('');setNativeInput(false);return;
      }
      if(editable){
        if(KEY_BY_CODE[e.code]&&!e.metaKey&&!e.ctrlKey&&!e.altKey)
          dispatch({type:'down',code:e.code,key:e.key,source:'physical-input',repeat:e.repeat,visualOnly:true});
        return;
      }
      const nativeControl=target?.closest('button,a,[role="button"]');
      const shortcut=e.metaKey||e.ctrlKey||e.altKey;
      const visualOnly=!!nativeControl&&['Enter',' '].includes(e.key);
      const consumed=!shortcut&&!visualOnly&&consumesKey(current.current,e.key);
      dispatch({type:'down',code:e.code,key:e.key,source:'physical',repeat:e.repeat,shortcut:shortcut&&!['Meta','Control'].includes(e.key),visualOnly});
      if(consumed)e.preventDefault();
    };
    const keyup=(e:KeyboardEvent)=>{dispatch({type:'up',code:e.code,source:'physical'});dispatch({type:'up',code:e.code,source:'physical-input'});};
    const blur=()=>{composing.current=false;dispatch({type:'blur'});};
    const visibility=()=>{if(document.hidden)blur();};
    const compositionStart=()=>{composing.current=true;};
    const compositionEnd=()=>{composing.current=false;};
    const pointerup=(e:PointerEvent)=>{
      Object.keys(current.current.pressed).forEach(code=>dispatch({type:'up',code,source:`pointer:${e.pointerId}`}));
    };
    const activity=()=>wake();
    const pointerdown=()=>{wake();stopDemo();stopAutoTyping();};
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
    window.addEventListener('pointerup',pointerup);window.addEventListener('pointercancel',pointerup);
    window.addEventListener('pointermove',activity,{passive:true});window.addEventListener('wheel',activity,{passive:true});
    window.addEventListener('pointerdown',pointerdown,{passive:true});
    document.addEventListener('visibilitychange',visibility);
    document.addEventListener('compositionstart',compositionStart);document.addEventListener('compositionend',compositionEnd);
    return()=>{
      window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);
      window.removeEventListener('pointerup',pointerup);window.removeEventListener('pointercancel',pointerup);
      window.removeEventListener('pointermove',activity);window.removeEventListener('wheel',activity);
      window.removeEventListener('pointerdown',pointerdown);
      document.removeEventListener('visibilitychange',visibility);
      document.removeEventListener('compositionstart',compositionStart);document.removeEventListener('compositionend',compositionEnd);
    };
  },[stopDemo,stopAutoTyping]);
  // Links inside a projected page travel through the same arrival as typing.
  useEffect(()=>{
    const page=pageLayer.current;
    if(!page)return;
    const click=(e:MouseEvent)=>{
      if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
      const link=(e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if(!link||link.target||link.origin!==window.location.origin||link.hasAttribute('download'))return;
      if(!link.pathname||link.protocol.startsWith('mailto'))return;
      e.preventDefault();
      dispatch({type:'navigate',path:link.pathname+link.search});
    };
    page.addEventListener('click',click);
    return()=>page.removeEventListener('click',click);
  },[]);
  // The number you press lights its row; the others step back.
  useEffect(()=>{
    const list=pageLayer.current?.querySelector<HTMLElement>('.project-list');
    if(!list)return;
    list.querySelectorAll<HTMLElement>('a').forEach((row,i)=>{if(state.selection===i)row.dataset.selected='';else delete row.dataset.selected;});
    list.toggleAttribute('data-has-selection',state.selection!==null);
  },[state.selection,world]);
  // Whatever takes focus in a page is brought up into the reading band above the keys.
  useEffect(()=>{
    const page=pageLayer.current,t=twin.current;
    if(!page||!t)return;
    const focus=(e:FocusEvent)=>{
      const target=e.target as HTMLElement;
      if(!target.matches?.('a,button,input,textarea,select'))return;
      const rect=target.getBoundingClientRect(),height=t.clientHeight;
      if(rect.top>height*.08&&rect.bottom<height*.4)return;
      t.scrollTo({top:Math.max(0,t.scrollTop+rect.top-height*.2),behavior:reducedMotion?'auto':'smooth'});
    };
    page.addEventListener('focusin',focus);
    return()=>page.removeEventListener('focusin',focus);
  },[reducedMotion]);
  const send=useCallback((action:InputAction)=>{wake();dispatch(action);},[]);
  // Choosing a word from the light types it on the glass, then presses Enter.
  const choose=(word:string)=>{
    stopDemo();stopAutoTyping();setPreview('');
    if(reducedMotion){dispatch({type:'submit',text:word});return;}
    dispatch({type:'text',text:''});
    const later=(ms:number,action:()=>void)=>{autoTyping.current.push(window.setTimeout(action,ms));};
    Array.from(word).forEach((letter,i)=>{
      const code=`Key${letter.toUpperCase()}`;
      later(i*95,()=>{dispatch({type:'down',code,key:letter.toLowerCase(),source:'auto'});wake();});
      later(i*95+70,()=>dispatch({type:'up',code,source:'auto'}));
    });
    later(word.length*95+60,()=>dispatch({type:'down',code:'Enter',key:'Enter',source:'auto'}));
    later(word.length*95+150,()=>{dispatch({type:'up',code:'Enter',source:'auto'});autoTyping.current=[];});
  };
  const close=()=>{dispatch({type:'down',code:'Escape',key:'Escape',source:'auto'});dispatch({type:'up',code:'Escape',source:'auto'});setPreview('');setNativeInput(false);};
  const focusInput=()=>{
    setNativeInput(true);
    // Keep focus inside the original tap event: iOS won't open its keyboard
    // when focus is deferred to a React effect or animation callback.
    mobileInput.current?.focus({preventScroll:true});
  };
  const submitInput=()=>{
    if(composing.current)return;
    dispatch({type:'down',code:'Enter',key:'Enter',source:'native',visualOnly:true});
    dispatch({type:'up',code:'Enter',source:'native'});
    dispatch({type:'submit',text:mobileInput.current?.value});
    mobileInput.current?.blur();setNativeInput(false);
  };
  // Pages need no keyboard: typing exists only in the hero.
  const showCommand=!hints&&!inWorld&&!(departing&&heading);

  return <div ref={experience} className={`experience ${mobile?'is-mobile':''} ${nativeInput?'has-native-input':''} ${inWorld?'is-world':''} ${worldMode?'is-away':''} ${departing?'is-departing':''} ${ready?'is-ready':''} ${failed?'is-fallback':'is-projected'}`}
    data-world={world.path} data-world-kind={world.kind} data-power={worldMode?'on':'off'}>
    <div className="scene-canvas" aria-hidden="true">
      {!failed&&<SceneBoundary onFailure={markFailed}><KeyboardScene state={state} dispatch={send} world={world} worldMode={worldMode} hints={hints} preview={preview} reducedMotion={reducedMotion} mobile={mobile} editing={nativeInput||departing} eventSource={experience} onReady={markReady} onFailure={markFailed}/></SceneBoundary>}
    </div>
    <div ref={frame} className="scene-wrap" aria-hidden="true" data-testid="keyboard-scene" data-layout="us-qwerty" data-view={mobile?departing?'mobile-departure':nativeInput?'mobile-input':'mobile-close':'desktop'} data-key-count={77} data-strokes={JSON.stringify(state.strokes)} data-ready={ready} data-motion={departing?'leaving':worldMode?'open':'floating'} data-pressed={Object.keys(state.pressed).join(',')} data-expanding={state.expanding} data-erased={state.erased} data-selection={state.selection??''}/>

    <div ref={display} className="display-frame" aria-hidden="true"/>
    <div ref={twin} id="world-twin" className="world-twin" tabIndex={-1}>
      <div ref={fixedLayer} className="screen-fixed">
        <a className="skip-link" href="#world-twin">Skip to content</a>
        <nav id="site-navigation" className="twin-nav" aria-label="Main navigation">
          <Link href="/" aria-label="Studio99 home" onClick={e=>{if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||e.button!==0)return;if(inWorld){e.preventDefault();close();}}}>Studio99®</Link>
          {COMMANDS.filter(c=>c.featured).map(c=><Link href={c.path} key={c.word} onClick={e=>{
            if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||e.button!==0)return;
            e.preventDefault();choose(c.word);
          }}>{c.word}</Link>)}
          {inWorld&&<button onClick={close} aria-label="Close world">ESC</button>}
        </nav>
        {showCommand&&<section className="command-air" aria-label="Type to explore">
          <button className={`command-line ${state.text?'has-input':''}`} onClick={focusInput} aria-label="Focus command input">
            <span data-testid="typed-command">{state.text?normalize(state.text):mobile?'TYPE TO EXPLORE':''}</span>
            {candidate&&<span className="ghost-text">{candidate.word.slice(normalize(state.text).length)}</span>}<i className="caret" data-unprojected=""/>
          </button>
          {candidate&&<button className="prediction" data-testid="prediction" disabled={departing} onClick={()=>choose(candidate.word)} onMouseEnter={()=>setPreview(candidate.word)} onMouseLeave={()=>setPreview('')}
            style={{opacity:Math.min(1,.38+state.text.length*.13)}}>{candidate.word} <span>—</span> {candidate.description}<span className="enter-mark">↵</span></button>}
          <form className="mobile-entry" onSubmit={e=>{e.preventDefault();submitInput();}}>
            <label className="sr-only" htmlFor="command-input">Your world</label>
            <input ref={mobileInput} id="command-input" disabled={departing} autoComplete="off" autoCapitalize="characters" inputMode="text" enterKeyHint="go" spellCheck={false} placeholder="TYPE TO EXPLORE" maxLength={64} value={state.text}
              onFocus={()=>setNativeInput(true)} onBlur={()=>setNativeInput(false)}
              onKeyDown={e=>{if(e.key==='Enter'&&(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)){e.preventDefault();e.stopPropagation();}}}
              onChange={e=>dispatch(composing.current?{type:'text',text:e.target.value}:{type:'native-text',text:e.target.value,inputType:(e.nativeEvent as InputEvent).inputType})}
              onCompositionStart={()=>{composing.current=true;compositionBefore.current=current.current.text;}}
              onCompositionEnd={e=>{composing.current=false;dispatch({type:'native-text',text:e.currentTarget.value,before:compositionBefore.current});}}/>
            <button type="submit" aria-label="Open this world" onPointerDown={e=>e.preventDefault()}>↵</button>
          </form>
          {mobile&&<button className="mobile-input-toggle" onPointerDown={e=>e.preventDefault()} onClick={()=>{if(nativeInput){mobileInput.current?.blur();setNativeInput(false);}else focusInput();}} aria-expanded={nativeInput}>
            {nativeInput?'CLOSE KEYBOARD':'TAP TO TYPE'} <span>{nativeInput?'×':'↗'}</span>
          </button>}
        </section>}

        {hints&&<section className="known-worlds" aria-label="Known worlds">
          <p className="eyebrow">KNOWN WORLDS <span>⌘</span></p>
          {COMMANDS.filter(c=>c.featured).map(c=><button key={c.word} onClick={()=>choose(c.word)} onMouseEnter={()=>setPreview(c.word)} onMouseLeave={()=>setPreview('')}><strong>{c.word}</strong><span>{c.description}</span><i>↗</i></button>)}
          <p className="worlds-note">OR TYPE SOMETHING THAT DOESN’T EXIST.</p>
        </section>}

        <p className="signature signature-company" aria-hidden="true">CREATIVE CAPITAL COMPANY</p>
        <p className="signature signature-places" aria-hidden="true">TOKYO / NAGANO</p>
        {failed&&<div className="fallback-note"><p>Your next world starts with a word.</p><span>3D is unavailable. Explore with the input or links below.</span></div>}
      </div>
      <div ref={pageLayer} className="screen-page">
        <CarryContext.Provider value={carry}>{children}</CarryContext.Provider>
      </div>
    </div>

    <div className="sr-only" role="status" aria-live="polite">{candidate?`Suggestion: ${candidate.word}. ${candidate.description}. Press Enter to confirm.`:''}</div>
    <noscript><div className="no-script">Studio99 — TYPE YOUR WORLD. <a href="/about">About</a> · <a href="/works">Works</a> · <a href="/contact">Contact</a></div></noscript>
  </div>;
}
