'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Component, useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { COMMANDS, normalize, predictCommands } from '@/lib/commands';
import { initialInput, inputReducer } from '@/lib/input-machine';
import { DEPARTURE_SECONDS } from '@/lib/motion';
import { KEY_BY_CODE } from '@/lib/keyboard-layout';

const KeyboardScene=dynamic(()=>import('./KeyboardScene'),{ssr:false});
class SceneBoundary extends Component<{children:ReactNode; onFailure:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onFailure();}
  render(){return this.state.failed?null:this.props.children;}
}

export default function Experience({children}:{children:ReactNode}) {
  const [state,dispatch]=useReducer(inputReducer,initialInput);
  const [ready,setReady]=useState(false),[failed,setFailed]=useState(false),[preview,setPreview]=useState('');
  const [reducedMotion,setReducedMotion]=useState(false);
  const [mobile,setMobile]=useState(false),[nativeInput,setNativeInput]=useState(false);
  const experience=useRef<HTMLDivElement>(null);
  const compositionBefore=useRef('');
  const pathname=usePathname();const router=useRouter();const current=useRef(state);current.current=state;
  const mobileInput=useRef<HTMLInputElement>(null);const overlay=useRef<HTMLDivElement>(null);
  const composing=useRef(false);const navigation=useRef(pathname);
  const contentOpen=pathname!=='/';const away=contentOpen||state.phase==='open';
  const departing=state.phase==='leaving';
  const hints=!departing&&(state.hintPinned||Object.entries(state.pressed).some(([code,sources])=>/^(Meta|Control)/.test(code)&&sources.includes('physical')));
  const predictions=predictCommands(state.text);const candidate=predictions[0];
  const markReady=useCallback(()=>setReady(true),[]);const markFailed=useCallback(()=>{setFailed(true);setReady(true);},[]);

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
    if(departing||away){mobileInput.current?.blur();setNativeInput(false);}
  },[departing,away]);

  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const change=()=>setReducedMotion(media.matches);change();media.addEventListener('change',change);
    // Avoid booting a renderer at all when WebGL is unavailable.
    const test=document.createElement('canvas');
    if(!test.getContext('webgl2')) markFailed();
    return ()=>media.removeEventListener('change',change);
  },[markFailed]);
  useEffect(()=>{
    if(navigation.current!==pathname){dispatch({type:'reset'});setPreview('');setNativeInput(false);navigation.current=pathname;}
    if(pathname!=='/') window.setTimeout(()=>overlay.current?.focus(),60);
  },[pathname]);
  useEffect(()=>{
    if(state.request) router.prefetch(state.request.path);
  },[state.request,router]);
  useEffect(()=>{
    if(!departing)return;
    if(reducedMotion||failed||contentOpen){dispatch({type:'arrive'});return;}
    const timer=window.setTimeout(()=>dispatch({type:'arrive'}),DEPARTURE_SECONDS*1000);
    return()=>clearTimeout(timer);
  },[departing,reducedMotion,failed,contentOpen]);
  useEffect(()=>{
    if(state.phase==='open'&&state.request)router.push(state.request.path);
  },[state.phase,state.request,router]);
  useEffect(()=>{
    const keydown=(e:KeyboardEvent)=>{
      if(e.isComposing||composing.current||e.keyCode===229)return;
      const target=e.target as HTMLElement;
      const editable=target?.matches('input,textarea,select,[contenteditable="true"]');
      if(e.key==='Escape'){
        dispatch({type:'down',code:e.code,key:e.key,source:'physical'});setPreview('');if(pathname!=='/')router.push('/');
        if(editable)target.blur();setNativeInput(false);return;
      }
      if(editable){
        if(target===mobileInput.current&&KEY_BY_CODE[e.code]&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
          dispatch({type:'down',code:e.code,key:e.key,source:'physical-input',repeat:e.repeat,visualOnly:true});
        }
        return;
      }
      const nativeControl=target?.closest('button,a,[role="button"]');
      const shortcut=e.metaKey||e.ctrlKey||e.altKey;
      const visualOnly=pathname!=='/' || !!current.current.unknown || (!!nativeControl&&['Enter',' '].includes(e.key));
      dispatch({type:'down',code:e.code,key:e.key,source:'physical',repeat:e.repeat,shortcut:shortcut&&!['Meta','Control'].includes(e.key),visualOnly});
      if(!shortcut&&!visualOnly&&(e.key.length===1||['Backspace','Enter'].includes(e.key)))e.preventDefault();
    };
    const keyup=(e:KeyboardEvent)=>{dispatch({type:'up',code:e.code,source:'physical'});dispatch({type:'up',code:e.code,source:'physical-input'});};
    const blur=()=>{composing.current=false;dispatch({type:'blur'});};
    const visibility=()=>{if(document.hidden)blur();};
    const compositionStart=()=>{composing.current=true;};
    const compositionEnd=()=>{composing.current=false;};
    const pointerup=(e:PointerEvent)=>{
      Object.keys(current.current.pressed).forEach(code=>dispatch({type:'up',code,source:`pointer:${e.pointerId}`}));
    };
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur);
    window.addEventListener('pointerup',pointerup);window.addEventListener('pointercancel',pointerup);
    document.addEventListener('visibilitychange',visibility);
    document.addEventListener('compositionstart',compositionStart);document.addEventListener('compositionend',compositionEnd);
    return()=>{
      window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);
      window.removeEventListener('pointerup',pointerup);window.removeEventListener('pointercancel',pointerup);
      document.removeEventListener('visibilitychange',visibility);
      document.removeEventListener('compositionstart',compositionStart);document.removeEventListener('compositionend',compositionEnd);
    };
  },[pathname,router]);
  const choose=(word:string)=>{setPreview('');dispatch({type:'submit',text:word});};
  const close=()=>{dispatch({type:'reset'});setPreview('');setNativeInput(false);router.push('/');};
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

  return <div ref={experience} className={`experience ${mobile?'is-mobile':''} ${nativeInput?'has-native-input':''} ${away?'is-away':''} ${departing?'is-departing':''} ${ready?'is-ready':''} ${failed?'is-fallback':''}`}>
    <a className="skip-link" href="#site-navigation">Skip to navigation</a>
    <header className="masthead">
      <Link className="wordmark" href="/" onClick={()=>dispatch({type:'reset'})} aria-label="Studio99 home">Studio99<span>®</span></Link>
      <div className="masthead-right"><span className="locations">TOKYO <span>/</span> NAGANO</span>
        <button className={`menu-toggle ${hints?'active':''}`} aria-label={hints?'Close known worlds':'Open known worlds'} aria-expanded={hints} onClick={()=>{mobileInput.current?.blur();setNativeInput(false);dispatch({type:'hints'});}}><span/><span/></button>
      </div>
    </header>

    <div className="scene-wrap" aria-hidden="true" data-testid="keyboard-scene" data-layout="us-qwerty" data-view={mobile?departing?'mobile-departure':nativeInput?'mobile-input':'mobile-close':'desktop'} data-key-count={76} data-strokes={JSON.stringify(state.strokes)} data-ready={ready} data-motion={departing?'leaving':away?'open':'floating'} data-pressed={Object.keys(state.pressed).join(',')} data-expanding={state.expanding}>
      {!failed&&<SceneBoundary onFailure={markFailed}><KeyboardScene state={state} dispatch={dispatch} away={away||departing} sleeping={away} preview={preview} reducedMotion={reducedMotion} mobile={mobile} editing={nativeInput||departing} onReady={markReady} onFailure={markFailed}/></SceneBoundary>}
    </div>

    {!away&&!hints&&<section className="command-air" aria-label="Type to explore">
      <p className="eyebrow intro-label">A WORLD BEGINS WITH A WORD.</p>
      <button className={`command-line ${state.text?'has-input':''}`} onClick={focusInput} aria-label="Focus command input">
        <span data-testid="typed-command">{state.text?normalize(state.text):'TYPE TO EXPLORE'}</span>
        {candidate&&<span className="ghost-text">{candidate.word.slice(normalize(state.text).length)}</span>}<i className="caret"/>
      </button>
      {candidate?<button className="prediction" data-testid="prediction" disabled={departing} onClick={()=>choose(candidate.word)} onMouseEnter={()=>setPreview(candidate.word)} onMouseLeave={()=>setPreview('')}
        style={{opacity:Math.min(1,.38+state.text.length*.13)}}>{candidate.word} <span>—</span> {candidate.description}<span className="enter-mark">↵</span></button>
        :<p className="input-instruction">{state.text?'PRESS ENTER TO OPEN YOUR WORLD':mobile?'TOUCH THE GLASS. TYPE YOUR WORLD.':'TYPE A WORD. SEE WHERE IT TAKES YOU.'}</p>}
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

    {state.unknown&&state.phase==='open'&&<main className="unknown-world" aria-live="polite">
      <p className="eyebrow">UNKNOWN WORLD <span className="tiny-cross">+</span></p>
      <h1>{state.unknown.toUpperCase()}<span>_</span></h1>
      <p>THIS WORLD DOESN’T EXIST. YET.</p>
      <button className="text-link" onClick={()=>choose('CONTACT')}>MAKE IT WITH US. <span>↗</span></button>
      <button className="return-link" onClick={close}><kbd>ESC</kbd> BACK TO YOUR WORLD</button>
    </main>}

    {contentOpen?<div className="content-overlay" ref={overlay} tabIndex={-1}>
      <button className="close-world" onClick={close} aria-label="Close world"><kbd>ESC</kbd><span>×</span></button>
      {children}
    </div>:!state.unknown?children:null}

    {failed&&!away&&<div className="fallback-note"><p>Your next world starts with a word.</p><span>3D is unavailable. Explore with the input or links below.</span></div>}
    {!ready&&<p className="loading-label" role="status">BRINGING YOUR WORLD INTO FOCUS<span>...</span></p>}

    <footer className="site-footer">
      <div className="company-signature">CREATIVE<br/>CAPITAL<br/>COMPANY<span className="signature-line"/></div>
      <button className="space-tip" onClick={()=>away||departing?close():dispatch({type:'hints'})}>{away||departing?<><span>←</span> {mobile?'BACK TO YOUR WORLD':'ESC TO RETURN'}</>:mobile?<>＋ KNOWN WORLDS</>:<><kbd>⌘</kbd> KNOWN WORLDS <span className="tip-divider">/</span> HOLD SPACE TO MAKE ROOM</>}</button>
      <nav id="site-navigation" aria-label="Main navigation">{COMMANDS.filter(c=>c.featured).map((c,i)=><Link href={c.path} key={c.word} onClick={e=>{
        if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||e.button!==0)return;
        if(!contentOpen){e.preventDefault();choose(c.word);}else dispatch({type:'reset'});
      }}><small>0{i+1}</small>{c.word}<span>↗</span></Link>)}</nav>
    </footer>
    <div className="sr-only" role="status" aria-live="polite">{candidate?`Suggestion: ${candidate.word}. ${candidate.description}. Press Enter to confirm.`:''}</div>
    <noscript><div className="no-script">Studio99 — TYPE YOUR WORLD. <a href="/about">About</a> · <a href="/works">Works</a> · <a href="/contact">Contact</a></div></noscript>
  </div>;
}
