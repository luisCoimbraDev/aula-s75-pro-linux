import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectQuickMedia} from '../src/quick-media.ts';

const gif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
test('drop aceita GIF local e rejeita URL remota e GIF truncado antes de enviar',()=>{
  assert.equal(inspectQuickMedia('teste.gif',gif,'cover').frames,1);
  assert.throws(()=>inspectQuickMedia('remoto.gif','https://example.com/a.gif','cover'));
  assert.throws(()=>inspectQuickMedia('cortado.gif',gif.slice(0,-8),'cover'));
});
test('limita dimensões de PNG/JPEG antes de iniciar o decoder da WebView',()=>{
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(100000,16);png.writeUInt32BE(100000,20);
  assert.throws(()=>inspectQuickMedia('enorme.png','data:image/png;base64,'+png.toString('base64'),'contain'),/milhões/);
  const jpeg=Buffer.from([255,216,255,192,0,11,8,255,255,255,255,1,1,17,0,255,217]);
  assert.throws(()=>inspectQuickMedia('enorme.jpg','data:image/jpeg;base64,'+jpeg.toString('base64'),'cover'),/milhões/);
  assert.throws(()=>inspectQuickMedia('inválido.jpg','data:image/jpeg;base64,AAAA','cover'),/JPEG/);
});
