import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validateProfile } from '../src/profiles.ts';
import { inspectGif } from '../src/media.mjs';

const profile = () => ({schemaVersion:1,id:'profile-1',name:'Trabalho',updatedAt:new Date().toISOString(),settings:defaults()});

test('importação preserva perfis válidos e não compartilha o objeto original', () => {
  const original = profile(); original.settings.mappings['fn:56'] = 'media:mute';
  const imported = validateProfile(original);
  imported.settings.color = '#112233';
  assert.notEqual(imported.settings.color, original.settings.color);
  assert.equal(imported.settings.mappings['fn:56'], 'media:mute');
});

test('rejeita perfil incompatível, cores inválidas, macro enorme e imagem remota', () => {
  const version = profile(); version.schemaVersion = 99; assert.throws(() => validateProfile(version));
  const color = profile(); color.settings.keyColors['56'] = 'red'; assert.throws(() => validateProfile(color));
  const macro = profile(); macro.settings.macros.push({id:'m-1',name:'Teste',events:[{key:'KeyA',kind:'down',delay:60001}]}); assert.throws(() => validateProfile(macro));
  const media = profile(); media.settings.media = {data:'https://example.com/image.png',name:'external',fit:'cover',frames:1}; assert.throws(() => validateProfile(media));
});

test('conta quadros pela estrutura GIF e rejeita arquivo truncado', () => {
  const gif = new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  assert.deepEqual(inspectGif(gif), {width:1,height:1,frames:1});
  assert.throws(() => inspectGif(gif.slice(0,-1)));
  // Duas imagens, mesmo que seus dados contenham bytes iguais ao separador.
  const imageStart = gif.indexOf(0x2c);
  const animated = new Uint8Array([...gif.slice(0,-1), ...gif.slice(imageStart,-1),0x3b]);
  assert.equal(inspectGif(animated).frames,2);
});
