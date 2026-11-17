// Exercise the real GNOME controller with toolkit/IPC doubles, without touching user settings or USB.
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const timers=new Map();let bluezCallback,unsubscribed=false;
let nextSignal=0;const monitors=new Set(),calls=[];let pointer=[10,10,0];let dbus;
class Actor{
  constructor(props={}){Object.assign(this,{visible:true,reactive:true,mapped:true,children:[],signals:new Map(),pseudo:new Set(),clutter_text:{}},props);}
  connect(event,fn){const id=++nextSignal;this.signals.set(id,{event,fn});return id;}
  disconnect(id){this.signals.delete(id);}
  emit(event,...args){for(const value of [...this.signals.values()])if(value.event===event)value.fn(this,...args);}
  add_child(child){this.children.push(child);}
  add_style_class_name(){} remove_style_class_name(){}
  add_style_pseudo_class(value){this.pseudo.add(value);}remove_style_pseudo_class(value){this.pseudo.delete(value);}
  hide(){this.visible=false;}show(){this.visible=true;}destroy(){this.emit('destroy');this.destroyed=true;this.signals.clear();}
  get_transformed_position(){return [0,0];}get_transformed_size(){return [200,140];}
}
class Menu extends Actor{constructor(){super();this.actor=new Actor();this.items=[];this.isOpen=false;}addMenuItem(item){this.items.push(item);}open(){this.isOpen=true;this.emit('open-state-changed',true);}close(){this.isOpen=false;this.emit('open-state-changed',false);}toggle(){this.isOpen?this.close():this.open();}}
class Indicator extends Actor{constructor(){super();this.menu=new Menu();}}
class Slider extends Actor{constructor(value){super();this.value=value;}}
const fallback=new Actor({_indicator:{id:'tray-icon tray app s75-tray'}});
const left=new Actor(),right=new Actor(),xdnd=new Actor();
const Main={panel:{statusArea:{fallback},_leftBox:left,_rightBox:right,addToStatusArea(id,actor){this.statusArea[id]=actor;}},xdndHandler:xdnd};
const fakeBus={signal_subscribe(...args){bluezCallback=args.at(-1);return 1;},signal_unsubscribe(){unsubscribed=true;}};
const Gio={BusType:{SYSTEM:1},DBusSignalFlags:{NONE:0},bus_get(_type,_cancel,callback){queueMicrotask(()=>callback(null,{}));},bus_get_finish(){return fakeBus;},Cancellable:class{cancel(){this.cancelled=true;}},DBus:{session:{}},DBusExportedObject:{wrapJSObject(_xml,object){dbus=object;return{export(){},unexport(){dbus=null;}};}},FileIcon:{new:file=>({file})},File:{new_for_uri:uri=>({get_path:()=>fileURLToPath(uri)}),new_for_path:path=>({path})},MemoryOutputStream:{new_resizable:()=>({close(){},steal_as_bytes:()=>({get_data:()=>new TextEncoder().encode('file:///tmp/native.gif\r\n')})})}};
const Meta={SelectionType:{SELECTION_DND:2}};
const Clutter={Orientation:{VERTICAL:1},ActorAlign:{CENTER:1,END:2},ModifierType:{BUTTON1_MASK:256}};
const selection={get_mimetypes:()=>['text/uri-list'],transfer_async(_type,_mime,_size,_out,_cancel,callback){queueMicrotask(()=>callback(this,{}));},transfer_finish(){}};
const context=vm.createContext({console,TextEncoder,TextDecoder,queueMicrotask,global:{display:{get_selection:()=>selection},get_pointer:()=>pointer}});
function synthetic(name,obj){return new vm.SyntheticModule(Object.keys(obj),function(){for(const [key,value]of Object.entries(obj))this.setExport(key,value);},{context,identifier:name});}
const imports={
 'gi://Clutter':{default:Clutter},'gi://Gio':{default:Gio},'gi://GLib':{default:{PRIORITY_DEFAULT:0,SOURCE_REMOVE:false,timeout_add(_priority,_ms,fn){const id=++nextSignal;timers.set(id,fn);return id;},source_remove(id){timers.delete(id);}}},'gi://Meta':{default:Meta},'gi://Pango':{default:{EllipsizeMode:{END:1}}},'gi://St':{default:{BoxLayout:Actor,Label:Actor,Button:Actor,Icon:Actor,Entry:Actor,Widget:Actor}},
 'resource:///org/gnome/shell/ui/main.js':Main,'resource:///org/gnome/shell/ui/panelMenu.js':{Button:Indicator},'resource:///org/gnome/shell/ui/popupMenu.js':{PopupBaseMenuItem:Actor},'resource:///org/gnome/shell/ui/slider.js':{Slider},'resource:///org/gnome/shell/ui/dnd.js':{addDragMonitor:m=>monitors.add(m),removeDragMonitor:m=>monitors.delete(m),DragMotionResult:{CONTINUE:0}},
};
const helper=new vm.SourceTextModule(await readFile('gnome/s75-studio@luisdev.local/panel-utils.js','utf8'),{context});await helper.link(()=>{});await helper.evaluate();
const module=new vm.SourceTextModule(await readFile('gnome/s75-studio@luisdev.local/popover.js','utf8'),{context});
await module.link(specifier=>specifier==='./panel-utils.js'?helper:synthetic(specifier,imports[specifier]));await module.evaluate();
const panel=new module.namespace.NativePanel({});
const settings={color:'#ff865f',brightness:4,fit:'cover',mediaName:null};
panel.request=async request=>{calls.push(request);if(request.op==='color')Object.assign(settings,request);panel.update({kind:'context',settings,status:{busy:false,message:'Confirmado'},thumbnail:null});};
assert.equal(fallback.visible,false);assert.equal(panel.active,'gif');assert.equal(panel.colorSection.visible,false);
panel.tab('color');assert.equal(panel.gif.visible,false);assert.equal(panel.colorSection.visible,true);
await panel.applyColor('#80baff');assert.equal(calls.at(-1).op,'color');assert.equal(panel.color,'#80baff');assert.equal(panel.busy,false);
dbus.Show();assert.equal(panel.indicator.menu.isOpen,true);panel.tab('gif');
panel._dragMotion({x:10,y:10});await panel.drag.reading;panel._dropEnd();await new Promise(resolve=>setTimeout(resolve,1));
assert.equal(calls.at(-1).op,'upload');assert.equal(calls.at(-1).path,'/tmp/native.gif');
const uploads=calls.filter(c=>c.op==='upload').length;
panel._dragMotion({x:10,y:10});await panel.drag.reading;pointer=[10,10,256];panel._dropEnd();
assert.equal(calls.filter(c=>c.op==='upload').length,uploads,'drag leaving with button still pressed must not upload');
panel.update({kind:'battery',battery:{percent:73,source:'2.4g',updatedAt:Date.now()-120000,message:'ok'}});
assert.equal(panel.barBattery.text,'~73%');assert.equal(panel.batteryText.text,'~73%');
panel.update({kind:'battery',battery:{percent:null,source:'usb',message:'Nível indisponível por USB'}});
assert.equal(panel.barBattery.visible,false);assert.equal(panel.batteryText.text,'USB');
panel.update({kind:'battery',battery:{percent:64,source:'bluetooth',updatedAt:Date.now(),deviceId:'/org/bluez/keyboard'}});
await new Promise(resolve=>setTimeout(resolve,1));assert.equal(panel.batteryText.text,'64%');
const reads=calls.filter(c=>c.op==='battery').length;
bluezCallback(null,null,'/org/bluez/headphones',null,null,{deep_unpack:()=>['org.bluez.Battery1']});
assert.equal(calls.filter(c=>c.op==='battery').length,reads);
bluezCallback(null,null,'/org/bluez/keyboard',null,null,{deep_unpack:()=>['org.bluez.Battery1']});
await new Promise(resolve=>setTimeout(resolve,1));assert.equal(calls.filter(c=>c.op==='battery').length,reads+1);
panel.destroy();assert.equal(fallback.visible,true);assert.equal(monitors.size,0);assert.equal(xdnd.signals.size,0);assert.equal(left.signals.size,0);assert.equal(dbus,null);assert.equal(timers.size,0);assert.equal(unsubscribed,true);
console.log('Menu nativo: abas exclusivas, cor via IPC, menu do GNOME, drop→upload, cancelamento do arraste e limpeza de sinais passaram.');
