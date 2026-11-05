import {test,expect} from '@playwright/test';
import {inputReducer,initialInput} from '../src/lib/input-machine';
import {codeForCharacter} from '../src/lib/keyboard-layout';

test('native letters, US symbols, spaces and deletion echo on the matching glass',()=>{
  let s=inputReducer(initialInput,{type:'native-text',text:'Ab @!'});
  expect(s.text).toBe('Ab @!');
  expect(s.strokes).toEqual({KeyA:1,KeyB:1,Space:1,Digit2:1,Digit1:1});
  expect(s.expanding).toBe(false);expect(s.pressed).toEqual({});
  s=inputReducer(s,{type:'native-text',text:'Ab @',inputType:'deleteContentBackward'});
  expect(s.strokes.Backspace).toBe(1);
  expect(codeForCharacter('あ')).toBeUndefined();
});

test('editing the middle of text echoes only the replacement; repeated events do not echo twice',()=>{
  let s=inputReducer(initialInput,{type:'text',text:'aboot'});
  s=inputReducer(s,{type:'native-text',text:'about'});
  expect(s.strokes).toEqual({KeyU:1});
  s=inputReducer(s,{type:'native-text',text:'about'});expect(s.strokes).toEqual({KeyU:1});
});

test('IME composition stays text-only until commit and never submits a world',()=>{
  let s=inputReducer(initialInput,{type:'text',text:'あ'});
  expect(s.strokes).toEqual({});
  s=inputReducer(s,{type:'native-text',text:'ABOUT',before:''});
  expect(Object.keys(s.strokes)).toEqual(['KeyA','KeyB','KeyO','KeyU','KeyT']);
  expect(s.phase).toBe('typing');
  s=inputReducer(s,{type:'native-text',text:'ABOUT'});expect(s.strokes.KeyA).toBe(1);
  s=inputReducer(s,{type:'native-text',text:'世界🌙'});expect(s.text).toBe('世界🌙');
  expect(s.phase).toBe('typing');expect(s.unknown).toBeNull();
});

test('hardware positions take precedence over native character echoes in the input',()=>{
  let s=inputReducer(initialInput,{type:'down',code:'KeyQ',key:'a',source:'physical-input',visualOnly:true});
  s=inputReducer(s,{type:'native-text',text:'a'});
  expect(s.strokes).toEqual({KeyQ:1});expect(s.text).toBe('a');
  s=inputReducer(s,{type:'up',code:'KeyQ',source:'physical-input'});expect(s.pressed).toEqual({});
});

test('touching the mobile hero is tactile and never executes its cropped keys',()=>{
  for(const [code,key] of [['KeyA','a'],['Enter','Enter'],['Escape','Escape'],['Space',' '],['MetaLeft','Meta']]){
    const s=inputReducer(initialInput,{type:'down',code,key,source:'pointer:1',visualOnly:true});
    expect(s.text).toBe('');expect(s.phase).toBe('typing');expect(s.hintPinned).toBe(false);expect(s.expanding).toBe(false);expect(s.strokes[code]).toBe(1);
  }
});
