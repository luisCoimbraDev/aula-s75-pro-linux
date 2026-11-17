import test from 'node:test';
import assert from 'node:assert/strict';
import {localFileUri,colorValue,batteryView} from '../gnome/s75-studio@luisdev.local/panel-utils.js';
test('seleção de arraste aceita um arquivo local e rejeita outros destinos',()=>{
  assert.equal(localFileUri('# comentario\nfile:///tmp/meu%20gif.gif\r\n'),'file:///tmp/meu%20gif.gif');
  assert.throws(()=>localFileUri('https://example.com/a.gif'));
  assert.throws(()=>localFileUri('file://remote/a.gif'));
  assert.throws(()=>localFileUri('file:///a.gif\nfile:///b.gif'));
  assert.equal(colorValue(' #AAbbCC '),'#aabbcc');assert.throws(()=>colorValue('red'));
});
test('bateria não transforma ausência em 0% e identifica leitura antiga',()=>{
  assert.equal(batteryView({percent:null,source:'usb'}).label,'USB');
  assert.equal(batteryView({percent:null}).valid,false);
  assert.equal(batteryView({percent:255}).valid,false);
  const current={percent:73,source:'bluetooth',updatedAt:1000};
  assert.equal(batteryView(current,2000).bar,'73%');
  assert.match(batteryView(current,62000).bar,/^~73%$/);
  assert.match(batteryView(current,62000).note,/última leitura/);
  assert.equal(batteryView({...current,percent:0},2000).label,'0%');
});
