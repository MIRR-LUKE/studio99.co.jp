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
  s=inputReducer(s,{type:'submit'});expect(s.unknown).toBe('moon');expect(s.request?.path).toBe('/moon');
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

import {worldFromPath,unknownPath,heldCodes,raisedCodes} from '../src/lib/world';
const inWorld=(path:string)=>inputReducer(initialInput,{type:'world',world:worldFromPath(path)});
test('the URL decides the world, and unknown words get safe addresses',()=>{
  expect(worldFromPath('/works/bi')).toMatchObject({kind:'page',word:'BI',parent:'/works',siblings:{prev:'/works/rubicon',next:'/works/on'}});
  expect(worldFromPath('/works').items).toEqual(['/works/rubicon','/works/bi','/works/on']);
  expect(worldFromPath('/a-world%20of')).toMatchObject({kind:'unknown',word:'A WORLD OF'});
  expect(unknownPath('Moon')).toBe('/moon');expect(unknownPath('../icon.svg')).toBe('/icon-svg-');expect(unknownPath('/_next')).toBe('/next-');expect(unknownPath('api')).toBe('/api-');
  expect(worldFromPath(unknownPath('api')).word).toBe('API');expect(worldFromPath(unknownPath('月の裏')).word).toBe('月の裏');
  expect([...heldCodes('CONTACT')]).toEqual(['KeyC','KeyO','KeyN','KeyT','KeyA']);
  expect([...heldCodes('ABOUT',2)]).toEqual(['KeyA','KeyB','KeyO']);
  expect([...raisedCodes(worldFromPath('/works'),false)]).toEqual(['Escape','Digit1','Digit2','Digit3']);
  expect(raisedCodes(worldFromPath('/'),false).size).toBe(0);
});
test('inside a world: letters do nothing, numbers choose, arrows move, Backspace climbs',()=>{
  let s=down(inWorld('/about'),'KeyW','w');s=down(s,'KeyO','o');expect(s.text).toBe('');expect(s.request).toBeNull();
  s=down(inWorld('/works'),'Digit2','2');expect(s.selection).toBe(1);expect(s.text).toBe('');
  s=down(s,'Enter','Enter');expect(s.request?.path).toBe('/works/bi');
  s=down(inWorld('/works/on'),'ArrowRight','ArrowRight');expect(s.request?.path).toBe('/works/rubicon');
  s=down(inWorld('/works/on'),'Backspace','Backspace');expect(s.erased).toBe(1);expect(s.request).toBeNull();
  s=down(s,'Backspace','Backspace');expect(s.phase).toBe('open');expect(s.request?.path).toBe('/works');
  s=down(inWorld('/about'),'Space',' ');expect(s.expanding).toBe(false);expect(s.text).toBe('');
  s=down(inWorld('/moon'),'Enter','Enter');expect(s.request?.path).toBe('/contact?world=MOON');
  s=down(inWorld('/contact'),'Enter','Enter');expect(s.formSubmit).toBe(1);expect(s.request).toBeNull();
});
test('Escape leaves a world at once, but first cancels an arrival; the logo key goes home',()=>{
  let s=down(inWorld('/about'),'Escape','Escape');expect(s.phase).toBe('open');expect(s.request?.path).toBe('/');
  s=inputReducer(inWorld('/about'),{type:'submit',text:'works'});s=down(s,'Escape','Escape');
  expect(s.phase).toBe('typing');expect(s.request).toBeNull();expect(s.world.path).toBe('/about');
  s=inputReducer(inWorld('/works'),{type:'down',code:'Studio99',key:'Studio99',source:'pointer:1'});expect(s.request?.path).toBe('/');
  s=inputReducer(initialInput,{type:'down',code:'Studio99',key:'Studio99',source:'pointer:1'});expect(s.demo).toBe(1);expect(s.request).toBeNull();
});
