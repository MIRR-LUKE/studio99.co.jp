import { resolveCommand } from './commands';
import { LOGO_CODE, codeForCharacter } from './keyboard-layout';
import { HERO, unknownPath, type World } from './world';

export type InputState = {
  text: string; pressed: Record<string,string[]>; strokes:Record<string,number>; hintPinned: boolean;
  phase: 'typing' | 'leaving' | 'open';
  expanding: boolean; unknown: string | null; request: { id: number; path: string } | null;
  // Where the visitor is. Derived from the URL and handed to the reducer, so
  // physical keys, glass keys and automated typing share one grammar.
  world: World;
  erased: number;
  selection: number | null;
  formSubmit: number;
  demo: number;
};
export const initialInput: InputState = { text:'',pressed:{},strokes:{},hintPinned:false,phase:'typing',expanding:false,unknown:null,request:null,world:HERO,erased:0,selection:null,formSubmit:0,demo:0 };
export type InputAction =
  | {type:'down'; code:string; key:string; source:string; repeat?:boolean; shortcut?:boolean; visualOnly?:boolean}
  | {type:'up'; code:string; source:string}
  | {type:'text'; text:string}
  | {type:'native-text'; text:string; before?:string; inputType?:string}
  | {type:'submit'; text?:string}
  | {type:'world'; world:World}
  | {type:'navigate'; path:string}
  | {type:'arrive'} | {type:'reset'} | {type:'blur'} | {type:'hints'};

const nextId=(state:InputState)=>(state.request?.id??0)+1;
// Leaving plays the arrival of the next world; open navigates immediately.
const go=(state:InputState,path:string,phase:'leaving'|'open'):InputState=>
  ({...state,hintPinned:false,expanding:false,selection:null,phase,request:{id:nextId(state),path}});

function submit(state:InputState,text=state.text):InputState {
  const word=text.trim();
  if(!word || state.phase==='leaving') return state;
  const command=resolveCommand(word);
  const path=command?command.path:unknownPath(word);
  if(path===state.world.path) return {...state,text:''};
  return {...go({...state,text:word},path,state.phase==='open'?'open':'leaving'),unknown:command?null:word};
}

// Keys that only mean something when nothing has been typed in a world.
function worldKey(state:InputState,next:InputState,key:string):InputState|null {
  const {world}=state;
  if(world.kind==='hero'||state.text) return null;
  if(key==='Backspace'){
    const length=Array.from(world.word).length;
    const erased=state.erased+1;
    return erased>=length?go({...next,erased:length},world.parent??'/','open'):{...next,erased,selection:null};
  }
  if(/^[1-9]$/.test(key)&&world.items.length){
    const index=Number(key)-1;
    return index<world.items.length?{...next,selection:index}:next;
  }
  if(key==='Enter'){
    if(state.selection!==null&&world.items[state.selection]) return go(next,world.items[state.selection],'leaving');
    if(world.kind==='unknown') return go(next,`/contact?world=${encodeURIComponent(world.word)}`,'leaving');
    if(world.path==='/contact') return {...next,formSubmit:state.formSubmit+1};
    return next;
  }
  if(world.siblings&&(key==='ArrowLeft'||key==='ArrowRight')) return go(next,key==='ArrowLeft'?world.siblings.prev:world.siblings.next,'leaving');
  if(key===' ') return next; // Space scrolls the page in a world.
  // A page has no keyboard: other characters are not typed (and go nowhere).
  if(key.length===1) return next;
  return null;
}

export function inputReducer(state:InputState, action:InputAction):InputState {
  switch(action.type) {
    case 'reset': return {...initialInput,world:state.world};
    case 'world': return {...initialInput,pressed:state.pressed,strokes:state.strokes,world:action.world,formSubmit:state.formSubmit,demo:state.demo};
    case 'navigate': return state.phase==='leaving'||action.path===state.world.path?state:go({...state,text:''},action.path,action.path==='/'?'open':'leaving');
    case 'arrive': return state.phase==='leaving'?{...state,phase:'open'}:state;
    case 'blur': return {...state,pressed:{},expanding:false};
    case 'hints': return state.phase==='leaving'?state:{...state,hintPinned:!state.hintPinned};
    case 'text': return state.phase!=='typing'?state:{...state,text:action.text.slice(0,64),unknown:null};
    case 'native-text': {
      if(state.phase!=='typing')return state;
      const text=action.text.slice(0,64),before=action.before??state.text;
      const strokes={...state.strokes};
      // Hardware keydown already animates its physical code. Virtual keyboards
      // need a character-based echo because they often send no usable key code.
      if(!Object.values(state.pressed).some(s=>s.includes('physical-input'))&&text!==before){
        let start=0,end=0;
        while(start<before.length&&start<text.length&&before[start]===text[start])start++;
        while(end<before.length-start&&end<text.length-start&&before[before.length-1-end]===text[text.length-1-end])end++;
        const inserted=text.slice(start,text.length-end);
        const codes=Array.from(inserted).map(codeForCharacter).filter((code):code is string=>!!code);
        if(action.inputType?.startsWith('delete')||(!inserted&&before.length>text.length))codes.push('Backspace');
        for(const code of codes)strokes[code]=(strokes[code]??0)+1;
      }
      return {...state,text,strokes,unknown:null};
    }
    case 'submit': return submit(state,action.text);
    case 'up': {
      const pressed={...state.pressed};
      pressed[action.code]=(pressed[action.code]??[]).filter(s=>s!==action.source);
      if(!pressed[action.code].length) delete pressed[action.code];
      return {...state,pressed,expanding:action.code==='Space'?!!pressed.Space:action.source==='physical:Space'?false:state.expanding};
    }
    case 'down': {
      const sources=state.pressed[action.code]??[];
      const pressed={...state.pressed,[action.code]:sources.includes(action.source)?sources:[...sources,action.source]};
      const strokes=action.repeat||sources.includes(action.source)?state.strokes:{...state.strokes,[action.code]:(state.strokes?.[action.code]??0)+1};
      let next={...state,pressed,strokes};
      if(action.visualOnly || action.shortcut) return next;
      if(action.key==='Escape'){
        // Escape first cancels an arrival in progress; otherwise it leaves the world.
        if(state.phase==='leaving'||state.world.kind==='hero') return {...initialInput,world:state.world,pressed,strokes,formSubmit:state.formSubmit,demo:state.demo};
        return go({...next,text:'',erased:0},'/','open');
      }
      if(state.phase!=='typing') return next;
      if(action.code===LOGO_CODE||action.key===LOGO_CODE)
        return state.world.kind==='hero'?{...next,demo:state.demo+1}:go({...next,text:''},'/','open');
      if(['Meta','Control'].includes(action.key)) return action.source.startsWith('pointer')?{...next,hintPinned:!state.hintPinned}:next;
      if(action.repeat&&action.key!=='Backspace'&&action.key.length!==1) return next;
      const inWorld=worldKey(state,next,action.key);
      if(inWorld) return inWorld;
      if(action.key==='Enter') return action.repeat?next:submit(next);
      if(action.key==='Backspace') return {...next,text:Array.from(state.text).slice(0,-1).join(''),unknown:null};
      if(action.key==='?' && !state.text) return {...next,hintPinned:!state.hintPinned};
      if(action.key===' ' && !state.text) return {...next,expanding:true};
      if(action.key.length===1 && state.text.length<64) return {...next,text:state.text+action.key,unknown:null,selection:null};
      return next;
    }
  }
}

// Which keydown events the world consumes (and therefore should not reach the
// browser's default action, e.g. scrolling with Space or arrows).
export function consumesKey(state:InputState,key:string) {
  if(key==='Backspace'||key==='Enter') return true;
  if(state.world.kind!=='hero') return (/^[1-9]$/.test(key)&&state.world.items.length>0)||((key==='ArrowLeft'||key==='ArrowRight')&&!!state.world.siblings);
  if(key.length===1) return !(key===' '&&!state.text&&state.world.kind!=='hero');
  if((key==='ArrowLeft'||key==='ArrowRight')&&state.world.siblings&&!state.text) return true;
  return false;
}
