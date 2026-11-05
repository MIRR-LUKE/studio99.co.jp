import { resolveCommand } from './commands';
import { codeForCharacter } from './keyboard-layout';
export type InputState = {
  text: string; pressed: Record<string,string[]>; strokes:Record<string,number>; hintPinned: boolean;
  phase: 'typing' | 'leaving' | 'open';
  expanding: boolean; unknown: string | null; request: { id: number; path: string } | null;
};
export const initialInput: InputState = { text:'',pressed:{},strokes:{},hintPinned:false,phase:'typing',expanding:false,unknown:null,request:null };
export type InputAction =
  | {type:'down'; code:string; key:string; source:string; repeat?:boolean; shortcut?:boolean; visualOnly?:boolean}
  | {type:'up'; code:string; source:string}
  | {type:'text'; text:string}
  | {type:'native-text'; text:string; before?:string; inputType?:string}
  | {type:'submit'; text?:string}
  | {type:'arrive'} | {type:'reset'} | {type:'blur'} | {type:'hints'};
function submit(state:InputState,text=state.text):InputState {
  const word=text.trim();
  if(!word || state.phase==='leaving') return state;
  const command=resolveCommand(word);
  return {...state,text:word,hintPinned:false,expanding:false,phase:state.phase==='open'?'open':'leaving',unknown:command?null:word,
    request:command?{id:(state.request?.id??0)+1,path:command.path}:null};
}
export function inputReducer(state:InputState, action:InputAction):InputState {
  switch(action.type) {
    case 'reset': return {...initialInput};
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
      return {...state,pressed,expanding:action.code==='Space'?!!pressed.Space:state.expanding};
    }
    case 'down': {
      const sources=state.pressed[action.code]??[];
      const pressed={...state.pressed,[action.code]:sources.includes(action.source)?sources:[...sources,action.source]};
      const strokes=action.repeat||sources.includes(action.source)?state.strokes:{...state.strokes,[action.code]:(state.strokes?.[action.code]??0)+1};
      let next={...state,pressed,strokes};
      if(action.visualOnly || action.shortcut) return next;
      if(action.key==='Escape') return {...initialInput,pressed,strokes};
      if(state.phase!=='typing') return next;
      if(['Meta','Control'].includes(action.key)) return action.source.startsWith('pointer')?{...next,hintPinned:!state.hintPinned}:next;
      if(action.key==='Enter') return action.repeat?next:submit(next);
      if(action.key==='Backspace') return {...next,text:Array.from(state.text).slice(0,-1).join(''),unknown:null};
      if(action.key==='?' && !state.text) return {...next,hintPinned:!state.hintPinned};
      if(action.key===' ' && !state.text) return {...next,expanding:true};
      if(action.key.length===1 && state.text.length<64) return {...next,text:state.text+action.key,unknown:null};
      return next;
    }
  }
}
