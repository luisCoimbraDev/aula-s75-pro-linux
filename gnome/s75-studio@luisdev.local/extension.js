// SPDX-License-Identifier: GPL-3.0-only
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {NativePanel} from './popover.js';
export default class S75Extension extends Extension {
    enable(){ this._panel=new NativePanel(this); }
    disable(){ this._panel?.destroy(); this._panel=null; }
}
