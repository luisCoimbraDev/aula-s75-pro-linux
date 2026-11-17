import test from 'node:test';
import assert from 'node:assert/strict';
import {anchoredRect} from '../gnome/s75-studio@luisdev.local/geometry.js';

test('ancora no monitor do ícone, mesmo que o outro monitor seja primário',()=>{
  const monitors=[{x:0,y:0,width:1920,height:1080,workArea:{x:0,y:32,width:1920,height:1048}},
    {x:-2560,y:0,width:2560,height:1440,workArea:{x:-2560,y:32,width:2560,height:1408}}];
  const rect=anchoredRect({x:-100,y:0,width:28,height:32},monitors,{width:420,height:640});
  assert.equal(rect.index,1);assert.equal(rect.x,-492);assert.equal(rect.y,40);
  assert.ok(rect.x+rect.width<=0);
});
test('limita o painel à área útil em escalas lógicas e telas menores',()=>{
  const rect=anchoredRect({x:1220,y:0,width:28,height:28},[{x:0,y:0,width:1280,height:720,workArea:{x:0,y:28,width:1280,height:692}}],{width:420,height:640});
  assert.equal(rect.x,828);assert.equal(rect.y,36);assert.equal(rect.height,640);
  const small=anchoredRect({x:1100,y:0,width:28,height:32},[{x:0,y:0,width:1280,height:600,workArea:{x:0,y:32,width:1280,height:568}}],{width:420,height:640});
  assert.equal(small.height,552);assert.ok(small.y+small.height<=592);
});
test('trata borda esquerda, monitor desconectado e ausência de monitores',()=>{
  const area={x:1920,y:0,width:1920,height:1080};
  const rect=anchoredRect({x:1921,y:0,width:20,height:32},[area],{width:420,height:640});
  assert.equal(rect.x,1928);
  assert.equal(anchoredRect({x:-3000,y:0,width:20,height:32},[area],{width:420,height:640}).index,0);
  assert.equal(anchoredRect({x:0,y:0,width:20,height:32},[],{width:420,height:640}),null);
});
