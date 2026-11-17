// Logic/IPC integration checks without launching a browser or touching real USB.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as reactivity from '@vue/reactivity';
import { randomUUID } from 'node:crypto';

const sample='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const calls=[],windowListeners=new Map(),globalListeners=new Map(),mounted=[],unmounted=[];
let ui,component,storedDraft=null,dropHandler,uploadResolve,uploadReject,uploadStarted=false,heldUpload=false,colorError=false;
let finishInstall;
const prefs={color:'#ff865f',brightness:4,updatedAt:0,mediaName:null,fit:'cover'};
const stubCanvas={width:135,height:240,getContext:()=>({fillRect(){},drawImage(){},fillStyle:''}),toDataURL:()=> 'data:image/jpeg;base64,thumbnail'};
const context=vm.createContext({console,Uint8Array,ArrayBuffer,DataView,TextDecoder,atob,btoa,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,crypto:{randomUUID},
  document:{createElement:()=>stubCanvas},
  Image:class{naturalWidth=1;naturalHeight=1;set src(value){if(value)queueMicrotask(()=>this.onload?.());}},
});
const external=new Map();
function synthetic(name,object){if(!external.has(name))external.set(name,new vm.SyntheticModule(Object.keys(object),function(){for(const [key,value]of Object.entries(object))this.setExport(key,value);},{context,identifier:name}));return external.get(name);}

async function invoke(command,args){
  calls.push({command,args});
  if(command==='get_quick_context')return{settings:{...prefs},message:null};
  if(command==='get_keyboard_battery')return {percent:null,charging:null,source:'usb',message:'Nível indisponível por USB',updatedAt:null};
  if(command==='get_desktop_integration')return{gnome:true,enabled:true};
  if(command==='install_gnome_panel')return await new Promise(resolve=>{finishInstall=()=>resolve({integration:{gnome:true,enabled:true,anchored:false},requiresRelogin:true});});
  if(command==='set_quick_color'){if(colorError)throw new Error('USB recusou a cor');Object.assign(prefs,args);return{...prefs};}
  if(command==='read_dropped_media')return{name:'teste.gif',data:sample};
  if(command==='upload_screen'){
    uploadStarted=true;
    args.progress.onmessage?.({stage:'screen',completed:1,total:2,message:'Página confirmada'});
    if(heldUpload)await new Promise((resolve,reject)=>{uploadResolve=resolve;uploadReject=reject;});
    return{acknowledged:true};
  }
  if(command==='remember_quick_media'){prefs.mediaName=args.name;return;}
  if(command==='cancel_upload'){uploadReject?.(new Error('Envio cancelado'));return;}
  if(command==='close_panel')return;
  if(command==='get_diagnostics')return{devices:[],configurationWritesEnabled:true,protocolStatus:'test'};
  if(command==='load_profiles')return[];
  if(command==='load_editor_draft')return storedDraft;
  if(command==='save_editor_draft'){storedDraft=JSON.parse(JSON.stringify(args.draft));return;}
  throw new Error('IPC inesperado: '+command);
}
const modules=new Map();
async function load(url){
  if(modules.has(url))return modules.get(url);
  if(url.endsWith('.css'))return synthetic(url,{});
  if(url.endsWith('render.generated.js'))return synthetic(url,{render(){}});
  if(url.endsWith('.json'))return synthetic(url,{default:JSON.parse(await readFile(fileURLToPath(url),'utf8'))});
  let source=await readFile(fileURLToPath(url),'utf8');
  if(url.endsWith('.ts'))source=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const mod=new vm.SourceTextModule(source,{context,identifier:url});modules.set(url,mod);
  await mod.link(async(specifier,parent)=>{
    if(specifier==='@vue/reactivity')return synthetic(specifier,reactivity);
    if(specifier==='@tauri-apps/api/core')return synthetic(specifier,{invoke,isTauri:()=>true,Channel:class{}});
    if(specifier==='@tauri-apps/api/window')return synthetic(specifier,{getCurrentWindow:()=>({listen:async(event,fn)=>{windowListeners.set(event,fn);return()=>windowListeners.delete(event);},onDragDropEvent:async fn=>{dropHandler=fn;return()=>{dropHandler=null;};}})});
    if(specifier==='@tauri-apps/api/event')return synthetic(specifier,{listen:async(event,fn)=>{globalListeners.set(event,fn);return()=>globalListeners.delete(event);}});
    let dependency=new URL(specifier,parent.identifier);if(!/\.[a-z]+$/.test(dependency.pathname))dependency=new URL(dependency+'.ts');
    return load(dependency.href);
  });return mod;
}
async function until(condition){for(let i=0;i<200;i++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,2));}throw new Error('O fluxo não terminou');}
const mod=await load(new URL('../src/quick-controller.ts',import.meta.url).href);await mod.evaluate();
let controller=mod.namespace.createQuickController();ui=controller.state;await controller.mount();
assert.equal(ui.color,'#ff865f');
const installing=ui.installPanel();await until(()=>finishInstall);
assert.equal(ui.installingPanel,true);await ui.close();assert.equal(calls.some(call=>call.command==='close_panel'),false);
finishInstall();await installing;assert.equal(ui.installingPanel,false);assert.match(ui.message,/Saia e entre/);
await ui.applyColor('#80baff');assert.equal(ui.color,'#80baff');assert.equal(ui.outcome,'success');
colorError=true;await ui.applyColor('#ed99bb');assert.equal(ui.color,'#80baff');assert.match(ui.message,/USB recusou/);colorError=false;

heldUpload=true;dropHandler({payload:{type:'drop',paths:['/sample/teste.gif']}});
await until(()=>uploadStarted);assert.equal(ui.busy,true);assert.notEqual(ui.outcome,'success');
assert.equal(calls.at(-1).command,'upload_screen');
const request=calls.at(-1).args.request;
assert.equal(Buffer.from(request.rgb565Base64,'base64').length,135*240*2);
await ui.close();assert.equal(calls.some(call=>call.command==='close_panel'),false);
uploadResolve();await until(()=>!ui.busy);assert.equal(ui.outcome,'success');
assert.equal(ui.lastMedia,'teste.gif');assert.ok(ui.preview.length<100);
assert.equal(calls.at(-1).command,'remember_quick_media');

uploadStarted=false;dropHandler({payload:{type:'drop',paths:['/sample/teste.gif']}});await until(()=>uploadStarted);
await ui.cancel();await until(()=>!ui.busy);assert.equal(ui.outcome,'error');assert.match(ui.message,/cancelado/);
const count=calls.filter(call=>call.command==='upload_screen').length;
dropHandler({payload:{type:'drop',paths:['a.gif','b.gif']}});await new Promise(resolve=>setTimeout(resolve,5));
assert.equal(calls.filter(call=>call.command==='upload_screen').length,count);
await ui.close();assert.equal(calls.at(-1).command,'close_panel');
controller.dispose();assert.equal(windowListeners.size,0);assert.equal(globalListeners.size,0);assert.equal(dropHandler,null);
mounted.splice(0);unmounted.splice(0);
const main=await load(new URL('../src/main-controller.ts',import.meta.url).href);await main.evaluate();controller=main.namespace.createStudioController();ui=controller.state;await controller.mount();
ui.settings.color='#112233';ui.individualLighting=true;ui.customColor='#aabbcc';
const selected=ui.selected;
assert.equal(ui.keyStyle(selected)['--key-color'],'#aabbcc');
ui.individualLighting=false;
assert.equal(ui.settings.effect,'static');assert.equal(ui.keyStyle(selected)['--key-color'],'#112233');
assert.equal(ui.settings.keyColors[selected.id],'#aabbcc');
ui.profileName='';ui.page='lighting';await ui.recollect();
assert.deepEqual(calls.slice(-2).map(call=>call.command),['save_editor_draft','close_panel']);
assert.equal(storedDraft.dirty,true);assert.equal(storedDraft.name,'');assert.equal(storedDraft.page,'lighting');
controller.dispose();mounted.splice(0);unmounted.splice(0);
controller=main.namespace.createStudioController();ui=controller.state;await controller.mount();
assert.equal(ui.settings.color,'#112233');assert.equal(ui.settings.keyColors[selected.id],'#aabbcc');
assert.equal(ui.profileName,'');assert.equal(ui.dirty,true);assert.equal(ui.page,'lighting');
controller.dispose();
console.log('Passaram: instalação GNOME via IPC com proteção ao fechar, ACK de cor, falha USB, drop→envio automático, RGB565, cancelamento, toggle global/individual, rascunho após reabrir e liberação de listeners.');
