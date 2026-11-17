import type { Profile, Settings } from './types';
import keyboard from './keyboard.json' with {type:'json'};
const keyIds = new Set(keyboard.map(k=>k.id));
const effects = new Set(['static','wave','breathing','off','custom',...Array.from({length:19},(_,i)=>'mode:'+(i+1))]);
export const defaults = (): Settings => ({ effect: 'static', color: '#ff865f', brightness: 4, speed: 3, colorful: false, direction: 0, barMode: 32, deviceSettings: {winLock:0,altF4:0,altTab:0,fnSwitch:0,sleep:0,response:1}, mappings: {}, keyColors: {}, macros: [], media: null });
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function validateProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object') throw new Error('Perfil inválido.');
  const p = clone(value) as Profile;
  if (!p || p.schemaVersion !== 1 || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60) throw new Error('Perfil inválido ou de outra versão.');
  if (p.settings && typeof p.settings === 'object') p.settings = {...defaults(),...p.settings,deviceSettings:{...defaults().deviceSettings,...p.settings.deviceSettings}};
  const s = p.settings;
  if (!s || !effects.has(s.effect) || !/^#[0-9a-f]{6}$/i.test(s.color) || !Number.isInteger(s.brightness) || s.brightness < 0 || s.brightness > 5 || !Number.isInteger(s.speed) || s.speed < 0 || s.speed > 5) throw new Error('Configuração de iluminação inválida.');
  if (!s.mappings || Array.isArray(s.mappings) || typeof s.mappings !== 'object' || Object.keys(s.mappings).length > 160) throw new Error('Mapeamento inválido.');
  for (const [key, action] of Object.entries(s.mappings)) {
    if (!/^(base|fn):\d{1,3}$/.test(key) || typeof action !== 'string' || action.length > 80 || !action || !keyIds.has(Number(key.split(':')[1]))) throw new Error('Mapeamento inválido.');
  }
  if (!s.keyColors || Array.isArray(s.keyColors) || typeof s.keyColors !== 'object' || Object.keys(s.keyColors).length > 80 || Object.entries(s.keyColors).some(([k, v]) => !keyIds.has(Number(k)) || !/^#[0-9a-f]{6}$/i.test(v))) throw new Error('Cores por tecla inválidas.');
  if (typeof s.colorful !== 'boolean' || !Number.isInteger(s.direction) || s.direction < 0 || s.direction > 3 || !Number.isInteger(s.barMode) || s.barMode < 32 || s.barMode > 36) throw new Error('Opções RGB inválidas.');
  for (const [key,max] of Object.entries({winLock:1,altF4:1,altTab:1,fnSwitch:1,sleep:3,response:5})) { const v=s.deviceSettings[key as keyof typeof s.deviceSettings]; if (!Number.isInteger(v)||v<0||v>max||(key==='response'&&v<1)) throw new Error('Opção do teclado inválida.'); }
  if (!Array.isArray(s.macros) || s.macros.length > 100) throw new Error('Lista de macros inválida.');
  for (const macro of s.macros) {
    macro.playMode ??= 0; macro.loops ??= 1;
    if (typeof macro.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(macro.id) || typeof macro.name !== 'string' || macro.name.length > 60 || !Array.isArray(macro.events) || macro.events.length > 500) throw new Error('Macro inválida.');
    if ((macro.playMode!==undefined && (!Number.isInteger(macro.playMode)||macro.playMode<0||macro.playMode>4)) || (macro.loops!==undefined&&(!Number.isInteger(macro.loops)||macro.loops<1||macro.loops>255))) throw new Error('Repetição de macro inválida.');
    if (macro.events.some(e => !['down', 'up'].includes(e.kind) || typeof e.key !== 'string' || !e.key || e.key.length > 40 || !Number.isInteger(e.delay) || e.delay < 0 || e.delay > 60000)) throw new Error('Evento de macro inválido.');
  }
  if (s.media && (typeof s.media.data !== 'string' || !/^data:image\/(png|jpeg|gif);base64,/.test(s.media.data) || !Number.isInteger(s.media.frames) || s.media.frames < 1 || s.media.frames > 141 || typeof s.media.name !== 'string' || !['contain', 'cover'].includes(s.media.fit))) throw new Error('Mídia inválida.');
  if (JSON.stringify(p).length > 8 * 1024 * 1024) throw new Error('Perfil acima de 8 MiB.');
  return clone(p);
}
