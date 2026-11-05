import {test,expect} from '@playwright/test';
import {inputReducer,initialInput,InputState} from '../src/lib/input-machine';
import {predictCommands,resolveCommand} from '../src/lib/commands';
const down=(state:InputState,code:string,key:string,source='physical')=>inputReducer(state,{type:'down',code,key,source});
test('short taps survive release for animation and key repeat does not add impacts',()=>{
  let s=down(initialInput,'KeyA','a');
  s=inputReducer(s,{type:'up',code:'KeyA',source:'physical'});
  expect(s.pressed.KeyA).toBeUndefined();expect(s.strokes.KeyA).toBe(1);
  s=down(s,'KeyA','a');
  s=inputReducer(s,{type:'down',code:'KeyA',key:'a',source:'physical',repeat:true});
  expect(s.strokes.KeyA).toBe(2);
  s=down(s,'KeyB','b','pointer:1');expect(s.strokes.KeyB).toBe(1);expect(s.strokes.KeyA).toBe(2);
});
test('physical and pointer presses share state without releasing each other',()=>{
  let s=down(initialInput,'KeyA','a');s=down(s,'KeyA','a','pointer:1');
  s=inputReducer(s,{type:'up',code:'KeyA',source:'pointer:1'});
  expect(s.pressed.KeyA).toEqual(['physical']);
  s=inputReducer(s,{type:'blur'});expect(s.pressed).toEqual({});
});
test('physical position and produced character are independent; deletion respects Unicode',()=>{
  let s=down(initialInput,'KeyQ','a');expect(s.text).toBe('a');expect(s.pressed.KeyQ).toBeTruthy();
  s=inputReducer(s,{type:'text',text:'世界🌙'});s=down(s,'Backspace','Backspace');expect(s.text).toBe('世界');
});
test('shortcuts do not enter commands; empty Space expands and text Space types',()=>{
  const shortcut=inputReducer(initialInput,{type:'down',code:'KeyA',key:'a',source:'physical',shortcut:true});expect(shortcut.text).toBe('');
  let s=down(initialInput,'Space',' ');expect(s.expanding).toBe(true);expect(s.text).toBe('');
  s=inputReducer(s,{type:'up',code:'Space',source:'physical'});expect(s.expanding).toBe(false);
  s=down(s,'KeyA','a');s=down(s,'Space',' ');expect(s.text).toBe('a ');expect(s.expanding).toBe(false);
});
test('commands resolve case insensitively and unknown worlds require confirmation',()=>{
  expect(resolveCommand(' about ')?.path).toBe('/about');expect(predictCommands('ABO')[0].word).toBe('ABOUT');
  expect(resolveCommand('bi')?.path).toBe('/works/bi');expect(resolveCommand('ON')?.path).toBe('/works/on');
  let s=inputReducer(initialInput,{type:'text',text:'moon'});expect(s.unknown).toBeNull();
  s=inputReducer(s,{type:'submit'});expect(s.unknown).toBe('moon');
  s=inputReducer(s,{type:'reset'});expect(s).toEqual(initialInput);
});
test('departure locks the chosen word, completes once and can be cancelled',()=>{
  let s=inputReducer(initialInput,{type:'submit',text:'about'});
  expect(s.phase).toBe('leaving');expect(s.request?.path).toBe('/about');
  s=down(s,'KeyX','x');s=inputReducer(s,{type:'submit',text:'works'});
  expect(s.text).toBe('about');expect(s.request?.path).toBe('/about');
  s=inputReducer(s,{type:'arrive'});expect(s.phase).toBe('open');
  expect(inputReducer(s,{type:'arrive'})).toBe(s);
  s=down(s,'Escape','Escape');expect(s.phase).toBe('typing');expect(s.request).toBeNull();
  expect(inputReducer(s,{type:'arrive'}).phase).toBe('typing');
});
