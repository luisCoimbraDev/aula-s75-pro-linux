// SPDX-License-Identifier: GPL-3.0-only
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {localFileUri,colorValue,batteryView} from './panel-utils.js';

const vertical = style_class => new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,style_class});
const label = (text,style_class='') => new St.Label({text,style_class,y_align:Clutter.ActorAlign.CENTER});
const button = (text,style_class,action) => {const widget=new St.Button({label:text,style_class,can_focus:true});widget.connect('clicked',action);return widget;};
const COLORS=['#ff865f','#e6c778','#92d4ba','#80baff','#b6a1e9','#ed99bb','#eeeeef'];

export class NativePanel {
    constructor(extension) {
        this.extension=extension;this.cancel=new Gio.Cancellable();this.timers=new Map();this.fallbacks=new Map();this.busy=false;this.color='#ff865f';this.brightness=4;this.fit='cover';this.active='gif';
        this.indicator=new PanelMenu.Button(0.5,'S75 Studio');
        const bar=new St.BoxLayout({style_class:'s75-bar'});bar.add_child(new St.Icon({icon_name:'input-keyboard-symbolic',style_class:'system-status-icon'}));this.barBattery=label('','s75-bar-battery');this.barBattery.visible=false;bar.add_child(this.barBattery);this.indicator.add_child(bar);
        this.indicator.menu.actor.add_style_class_name('s75-native-popover');
        const item=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});
        this.body=vertical('s75-content');item.add_child(this.body);this.indicator.menu.addMenuItem(item);
        const heading=new St.BoxLayout({style_class:'s75-heading'});
        heading.add_child(label('S75','s75-wordmark'));heading.add_child(label('AULA S75 Pro','s75-device'));
        const batteryBox=new St.BoxLayout({style_class:'s75-battery-box'});this.batteryIcon=new St.Icon({icon_name:'battery-missing-symbolic',icon_size:13});this.batteryText=label('Bateria —','s75-battery-text');batteryBox.add_child(this.batteryIcon);batteryBox.add_child(this.batteryText);this.batteryButton=new St.Button({child:batteryBox,style_class:'s75-battery',can_focus:true});this.batteryButton.connect('clicked',()=>this.refreshBattery());heading.add_child(this.batteryButton);
        const close=button('×','s75-close',()=>this.indicator.menu.close());close.x_expand=true;close.x_align=Clutter.ActorAlign.END;heading.add_child(close);this.body.add_child(heading);
        const tabs=new St.BoxLayout({style_class:'s75-tabs'});this.tabs={};
        for(const [id,name] of [['gif','GIF'],['color','Cor']]){const tab=button(name,'s75-tab',()=>this.tab(id));tab.x_expand=true;tabs.add_child(tab);this.tabs[id]=tab;}
        this.body.add_child(tabs);
        this.batteryNote=label('','s75-battery-note');this.batteryNote.visible=false;this.batteryNote.clutter_text.line_wrap=true;this.body.add_child(this.batteryNote);
        this.gif=vertical('s75-section');this.colorSection=vertical('s75-section');this.body.add_child(this.gif);this.body.add_child(this.colorSection);
        this._buildGif();this._buildColor();
        this.status=label('Pronto para personalizar','s75-status');this.status.clutter_text.line_wrap=true;this.body.add_child(this.status);
        this.progress=new St.Widget({style_class:'s75-progress',height:3,visible:false});this.body.add_child(this.progress);
        this.cancelButton=button('Cancelar envio','s75-link',()=>this.request({op:'cancel'}).catch(e=>this.error(e)));this.cancelButton.visible=false;this.body.add_child(this.cancelButton);
        const footer=new St.BoxLayout({style_class:'s75-footer'});
        footer.add_child(button('Abrir Studio ↗','s75-link',()=>{this.indicator.menu.close();this.request({op:'open'}).catch(e=>this.error(e));}));
        const quit=button('Sair','s75-link s75-muted',()=>{this.indicator.menu.close();this.request({op:'quit'}).catch(e=>this.error(e));});quit.x_expand=true;quit.x_align=Clutter.ActorAlign.END;footer.add_child(quit);this.body.add_child(footer);
        Main.panel.addToStatusArea('s75-studio-native',this.indicator,0,'right');this.tab('gif');
        this.dbus=Gio.DBusExportedObject.wrapJSObject('<node><interface name="dev.aula.S75Studio.Panel"><method name="Show"/><method name="Toggle"/></interface></node>',{Show:()=>this.indicator.menu.open(),Toggle:()=>this.indicator.menu.toggle()});
        this.dbus.export(Gio.DBus.session,'/dev/aula/S75Studio/Panel');
        this.indicator.menu.connect('open-state-changed',(_menu,open)=>{if(open){this._hideFallback();this.request({op:'context'}).catch(e=>this.error(e));}});
        this.boxSignals=[Main.panel._leftBox,Main.panel._rightBox].filter(Boolean).map(box=>[box,box.connect('child-added',()=>this._queueFallback())]);
        this.dragMonitor={dragMotion:event=>this._dragMotion(event)};DND.addDragMonitor(this.dragMonitor);
        this.dragBegin=Main.xdndHandler.connect('drag-begin',()=>{this.drag={hover:false,uri:null,reading:null,dropped:false};});
        this.dragEnd=Main.xdndHandler.connect('drag-end',()=>this._dropEnd());
        this._hideFallback();
    }

    _buildGif(){
        const row=new St.BoxLayout({style_class:'s75-gif-row'});
        this.preview=new St.Icon({icon_name:'image-x-generic-symbolic',icon_size:70,style_class:'s75-lcd'});row.add_child(this.preview);
        this.drop=vertical('s75-drop');this.drop.reactive=true;this.drop.add_child(label('Arraste seu GIF','s75-drop-title'));this.drop.add_child(label('Soltou, enviou ao teclado.','s75-caption'));
        this.drop.add_child(button('Escolher arquivo ↗','s75-file-button',()=>{if(this.busy)return;this.indicator.menu.close();this.transfer({op:'pick',fit:this.fit});}));
        this.drop.add_child(label('GIF · PNG · JPG  /  até 4 MiB','s75-tiny'));row.add_child(this.drop);this.gif.add_child(row);
        this.filename=label('Tela LCD','s75-filename');this.filename.clutter_text.ellipsize=Pango.EllipsizeMode.END;this.gif.add_child(this.filename);
        const fitRow=new St.BoxLayout({style_class:'s75-fit'});this.fitButtons={};
        for(const [value,text]of [['cover','Preencher'],['contain','Imagem inteira']]){const option=button(text,'s75-fit-button',()=>{this.fit=value;this._fitState();});fitRow.add_child(option);this.fitButtons[value]=option;}
        this.gif.add_child(fitRow);this._fitState();
    }
    _buildColor(){
        const row=new St.BoxLayout({style_class:'s75-palette'});this.swatches=[];
        for(const color of COLORS){const swatch=new St.Button({style_class:'s75-swatch',style:`background-color:${color};`,can_focus:true,accessible_name:`Aplicar cor ${color}`});swatch.connect('clicked',()=>this.applyColor(color));row.add_child(swatch);this.swatches.push([color,swatch]);}this.colorSection.add_child(row);
        const custom=new St.BoxLayout({style_class:'s75-custom'});this.hex=new St.Entry({text:this.color,hint_text:'#RRGGBB',can_focus:true,style_class:'s75-hex'});custom.add_child(this.hex);custom.add_child(button('Aplicar','s75-file-button',()=>{try{this.applyColor(colorValue(this.hex.text));}catch(e){this.error(e);}}));this.colorSection.add_child(custom);
        const title=new St.BoxLayout({style_class:'s75-brightness-title'});title.add_child(label('Brilho','s75-caption'));this.brightnessText=label('4 / 5','s75-caption');this.brightnessText.x_expand=true;this.brightnessText.x_align=Clutter.ActorAlign.END;title.add_child(this.brightnessText);this.colorSection.add_child(title);
        this.slider=new Slider.Slider(0.8);this.slider.accessible_name='Brilho do teclado';this.slider.connect('drag-begin',()=>{this.sliding=true;this._removeTimer('brightness');});this.slider.connect('drag-end',()=>{this.sliding=false;this.applyColor(this.color);});this.slider.connect('notify::value',()=>{this.brightness=Math.round(this.slider.value*5);this.brightnessText.text=`${this.brightness} / 5`;if(!this.setting&&!this.sliding){this._removeTimer('brightness');this._timer('brightness',250,()=>this.applyColor(this.color));}});this.colorSection.add_child(this.slider);
        this.colorSection.add_child(label('Cor aplicada no teclado inteiro.','s75-tiny'));
    }
    tab(id){this.active=id;this.gif.visible=id==='gif';this.colorSection.visible=id==='color';for(const [key,tab]of Object.entries(this.tabs))key===id?tab.add_style_pseudo_class('checked'):tab.remove_style_pseudo_class('checked');}
    _fitState(){for(const [value,widget]of Object.entries(this.fitButtons))value===this.fit?widget.add_style_pseudo_class('checked'):widget.remove_style_pseudo_class('checked');}
    _busy(value){this.busy=value;this.cancelButton.visible=value&&Boolean(this.transferring);for(const [,button]of this.swatches){button.reactive=!value;button.can_focus=!value;}this.slider.reactive=!value;if(!value)this.transferring=false;}
    error(error){if(this.destroyed)return;this._busy(false);this.progress.visible=false;this.status.text=String(error.message??error);this.status.add_style_class_name('s75-error');}
    update(reply){
        if(this.destroyed)return;
        if(reply.battery)this._battery(reply.battery);
        if(reply.kind==='battery')return;
        if(reply.kind==='error'){this.error(reply.message);return;}
        this.status.remove_style_class_name('s75-error');
        if(reply.kind==='progress'){this.transferring=true;this._busy(true);this.progress.visible=true;const percent=Math.floor(reply.completed/Math.max(1,reply.total)*100);this.status.text=`${reply.message} · ${percent}%`;return;}
        if(reply.kind==='context'){
            const s=reply.settings;this.color=s.color;this.brightness=s.brightness;this.fit=s.fit;this.hex.text=s.color.toUpperCase();this.setting=true;this.slider.value=s.brightness/5;this.setting=false;this.brightnessText.text=`${s.brightness} / 5`;this.filename.text=s.mediaName??'Tela LCD';this._fitState();
            for(const [color,widget]of this.swatches)color===s.color?widget.add_style_pseudo_class('checked'):widget.remove_style_pseudo_class('checked');
            if(reply.thumbnail)this.preview.gicon=Gio.FileIcon.new(Gio.File.new_for_path(reply.thumbnail));
            this.status.text=reply.status.message;this._busy(reply.status.busy);this.progress.visible=reply.status.busy;
        }
    }
    _battery(report){
        this.batteryReport=report;const view=batteryView(report);this.batteryText.text=view.label;this.batteryIcon.icon_name=view.icon;this.barBattery.text=view.bar;this.barBattery.visible=view.valid;this.batteryNote.text=view.note;this.batteryNote.visible=true;this.batteryButton.accessible_name=`Bateria do S75 Pro: ${view.label}. ${view.note}`;
        this._removeTimer('battery-age');
        if(view.valid&&!view.stale)this._timer('battery-age',Math.max(1,60000-(Date.now()-report.updatedAt)),()=>this._battery(report));
        if(report.source==='bluetooth'&&report.deviceId)this._watchBluez(report.deviceId);
    }
    async refreshBattery(){if(this.batteryLoading||this.busy)return;this.batteryLoading=true;this.batteryText.text='…';try{await this.request({op:'battery'});}catch(error){this._battery({percent:null,source:'unavailable',message:String(error.message??error)});}finally{this.batteryLoading=false;}}
    _watchBluez(path){
        this.bluetoothPath=path;if(this.bluezPending||this.bluezConnection)return;this.bluezPending=true;
        Gio.bus_get(Gio.BusType.SYSTEM,this.cancel,(_object,result)=>{
            try{const bus=Gio.bus_get_finish(result);if(this.destroyed)return;this.bluezConnection=bus;this.bluezSignal=bus.signal_subscribe('org.bluez','org.freedesktop.DBus.Properties','PropertiesChanged',null,null,Gio.DBusSignalFlags.NONE,(_connection,_sender,object,_interface,_signal,parameters)=>{if(object!==this.bluetoothPath)return;const [iface]=parameters.deep_unpack();if(iface==='org.bluez.Battery1'||iface==='org.bluez.Device1')this.refreshBattery();});}
            catch{}finally{this.bluezPending=false;}
        });
    }
    async applyColor(color){if(this.busy)return;this._busy(true);this.status.text='Aplicando cor…';try{await this.request({op:'color',color,brightness:this.brightness});}catch(e){this.error(e);}}
    async transfer(message){if(this.busy)return;this.transferring=true;this._busy(true);this.status.text='Preparando imagem…';try{await this.request(message);}catch(e){this.error(e);}}

    _config(){const [ok,data]=this.extension.dir.get_child('config.json').load_contents(null);if(!ok)throw new Error('Reinstale a integração pelo Studio.');return JSON.parse(new TextDecoder().decode(data));}
    _start(){const {executable}=this._config();if(!GLib.path_is_absolute(executable)||!GLib.file_test(executable,GLib.FileTest.IS_EXECUTABLE))throw new Error('Reinstale a integração pelo Studio.');const child=Gio.Subprocess.new([executable,'--tray'],Gio.SubprocessFlags.STDOUT_SILENCE|Gio.SubprocessFlags.STDERR_SILENCE);child.wait_async(this.cancel,(p,r)=>{try{p.wait_finish(r);}catch{}});}
    _connect(){return new Promise((resolve,reject)=>{const uid=Gio.Credentials.new().get_unix_user();const path=GLib.build_filenamev([GLib.get_user_runtime_dir(),`s75-studio-${uid}`,'control.sock']);const client=new Gio.SocketClient({timeout:2});client.connect_async(Gio.UnixSocketAddress.new(path),this.cancel,(object,result)=>{try{const connection=object.connect_finish(result);connection.socket.set_timeout(0);resolve(connection);}catch(e){reject(e);}});});}
    async request(message,attempt=0){
        if(this.destroyed)return;
        let connection;try{connection=await this._connect();}catch{this._start();for(let n=0;n<15&&!connection&&!this.destroyed;n++){await this._pause(150);try{connection=await this._connect();}catch{}}}
        if(!connection)throw new Error('O componente USB não respondeu. Reabra o Studio atualizado.');
        return new Promise((resolve,reject)=>{
            let last=null,error=null;const output=connection.get_output_stream();
            const finish=()=>{connection.close_async(GLib.PRIORITY_DEFAULT,null,(c,r)=>{try{c.close_finish(r);}catch{}});if(error){const failure=new Error(error);failure.retry=Boolean(last?.retry);reject(failure);}else if(last)resolve(last);else reject(new Error('Atualize e reinicie o S75 Studio.'));};
            output.write_all_async(new TextEncoder().encode(JSON.stringify(message)+'\n'),GLib.PRIORITY_DEFAULT,this.cancel,(stream,result)=>{
                try{stream.write_all_finish(result);}catch(e){error=e.message;finish();return;}
                const input=new Gio.DataInputStream({base_stream:connection.get_input_stream()});
                const read=()=>input.read_line_async(GLib.PRIORITY_DEFAULT,this.cancel,(source,res)=>{try{const [line]=source.read_line_finish_utf8(res);if(line===null){finish();return;}last=JSON.parse(line);if(last.kind==='error')error=last.message;if(!last.retry)this.update(last);read();}catch(e){error=e.message;finish();}});read();
            });
        }).catch(async error=>{if(error.retry&&attempt<2){await this._pause(200);return this.request(message,attempt+1);}throw error;});
    }
    _timer(key,ms,callback){this._removeTimer(key);const id=GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{this.timers.delete(key);callback();return GLib.SOURCE_REMOVE;});this.timers.set(key,{id,resolve:callback});}
    _removeTimer(key){const timer=this.timers.get(key);if(timer){GLib.source_remove(timer.id);this.timers.delete(key);}}
    _pause(ms){return new Promise(resolve=>this._timer(Symbol(),ms,resolve));}
    _queueFallback(){this._timer('fallback',30,()=>this._hideFallback());}
    _hideFallback(){for(const actor of Object.values(Main.panel.statusArea)){
        if(!String(actor?._indicator?.id??'').toLowerCase().replace(/[^a-z0-9]/g,'').endsWith('s75tray'))continue;
        if(!this.fallbacks.has(actor)){const visible=actor.visible;const id=actor.connect('notify::visible',()=>{if(actor.visible)actor.hide();});const destroyed=actor.connect('destroy',()=>this.fallbacks.delete(actor));this.fallbacks.set(actor,{visible,id,destroyed});}actor.hide();
    }}

    _inside(x,y){const [px,py]=this.drop.get_transformed_position(),[w,h]=this.drop.get_transformed_size();return this.indicator.menu.isOpen&&this.active==='gif'&&x>=px&&x<px+w&&y>=py&&y<py+h;}
    _dragMotion(event){
        if(!this.indicator.menu.isOpen){const [x,y]=this.indicator.get_transformed_position(),[w,h]=this.indicator.get_transformed_size();if(event.x>=x&&event.x<x+w&&event.y>=y&&event.y<y+h){this.tab('gif');this.indicator.menu.open();}}
        if(!this.drag)this.drag={hover:false,uri:null,reading:null,dropped:false};
        this.drag.hover=this._inside(event.x,event.y);this.drag.hover?this.drop.add_style_pseudo_class('hover'):this.drop.remove_style_pseudo_class('hover');
        if(this.drag.hover&&!this.drag.reading){this.drag.reading=this._readDrag(this.drag);}
        return DND.DragMotionResult.CONTINUE;
    }
    async _readDrag(drag){
        try{
            const selection=global.display.get_selection(),type=Meta.SelectionType.SELECTION_DND,mimes=selection.get_mimetypes(type);
            const mime=mimes.includes('text/uri-list')?'text/uri-list':mimes.includes('x-special/gnome-icon-list')?'x-special/gnome-icon-list':null;
            if(!mime)throw new Error('Use Escolher arquivo para este tipo de arraste.');
            const output=Gio.MemoryOutputStream.new_resizable();
            await new Promise((resolve,reject)=>selection.transfer_async(type,mime,65536,output,this.cancel,(object,result)=>{try{object.transfer_finish(result);resolve();}catch(e){reject(e);}}));
            output.close(null);const text=new TextDecoder().decode(output.steal_as_bytes().get_data());drag.uri=localFileUri(text);
            if(drag.dropped)this._uploadDrop(drag);
        }catch(e){drag.error=e;if(drag.dropped)this.error(e);}
    }
    _dropEnd(){const drag=this.drag;if(!drag)return;const [x,y,modifiers]=global.get_pointer();this.drop.remove_style_pseudo_class('hover');if(this._inside(x,y)&&!(modifiers&Clutter.ModifierType.BUTTON1_MASK)){drag.dropped=true;if(drag.uri)this._uploadDrop(drag);else if(drag.error)this.error(drag.error);}this.drag=null;}
    _uploadDrop(drag){if(drag.sent)return;drag.sent=true;const path=Gio.File.new_for_uri(drag.uri).get_path();if(!path){this.error('Escolha um arquivo local.');return;}this.transfer({op:'upload',path,fit:this.fit});}
    destroy(){this.destroyed=true;this.cancel.cancel();if(this.bluezConnection&&this.bluezSignal)this.bluezConnection.signal_unsubscribe(this.bluezSignal);this.dbus.unexport();DND.removeDragMonitor(this.dragMonitor);Main.xdndHandler.disconnect(this.dragBegin);Main.xdndHandler.disconnect(this.dragEnd);for(const [box,id]of this.boxSignals)box.disconnect(id);for(const timer of this.timers.values()){GLib.source_remove(timer.id);}this.timers.clear();for(const [actor,state]of this.fallbacks){actor.disconnect(state.id);actor.disconnect(state.destroyed);if(state.visible)actor.show();}this.fallbacks.clear();this.indicator.destroy();}
}
