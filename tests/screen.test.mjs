import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeGifFrames,rgbaTo565,prepareMedia} from '../src/screen-encode.mjs';

for(const name of ['disposal-1','disposal-2','disposal-3','gradient'])test('GIF '+name+' corresponde à composição Pillow',()=>{
  const expected=readFileSync(new URL(`./fixtures/${name}.rgba`,import.meta.url));let offset=0,count=0;
  for(const frame of decodeGifFrames(readFileSync(new URL(`./fixtures/${name}.gif`,import.meta.url)))){
    for(let i=0;i<frame.rgba.length;i+=4)for(let c=0;c<3;c++)assert.equal(frame.rgba[i+c]*frame.rgba[i+3],expected[offset+i+c]*expected[offset+i+3]);
    offset+=frame.rgba.length;count++;
  }assert.equal(offset,expected.length);assert.ok(count>=3);
});
test('RGB565 respeita ordem little endian, enquadramento e transparência',()=>{
  const red=rgbaTo565(new Uint8Array([255,0,0,255]),1,1,'cover');assert.equal(red.length,64800);assert.deepEqual([...red.slice(0,2)],[0,248]);
  const transparent=rgbaTo565(new Uint8Array([255,255,255,0]),1,1);assert.ok(transparent.every(b=>b===0));
  const contain=rgbaTo565(new Uint8Array([255,0,0,255]),1,1,'contain');assert.equal(contain[0],0);assert.equal(contain[1],0);assert.equal(contain[(120*135+67)*2+1],248);
});
test('conversão real do GIF gera buffers completos e pode ser cancelada',async()=>{
  const data='data:image/gif;base64,'+readFileSync(new URL('./fixtures/disposal-2.gif',import.meta.url)).toString('base64');
  const request=await prepareMedia({data,fit:'cover',frames:4});assert.equal(request.delaysMs.length,4);assert.equal(Buffer.from(request.rgb565Base64,'base64').length,64800*4);assert.deepEqual(request.delaysMs,[80,120,60,200]);
  await assert.rejects(prepareMedia({data,fit:'cover',frames:4},()=>{},()=>true),/cancelada/);
});
