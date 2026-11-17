export interface Key { id: number; usage: number; label: string; x: number; y: number; width: number; height: number; led: number }
export interface MacroEvent { key: string; kind: 'down' | 'up'; delay: number }
export interface Macro { id: string; name: string; events: MacroEvent[]; playMode?: number; loops?: number }
export interface Settings {
  effect: string; color: string; brightness: number; speed: number;
  colorful: boolean; direction: number; barMode: number;
  deviceSettings: {winLock: number; altF4: number; altTab: number; fnSwitch: number; sleep: number; response: number};
  mappings: Record<string, string>; keyColors: Record<string, string>; macros: Macro[];
  media: { data: string; name: string; frames: number; fit: 'cover' | 'contain' } | null;
}
export interface Profile { schemaVersion: number; id: string; name: string; updatedAt: string; settings: Settings }
export interface HidInterface { node: string; driver: string; physicalPath: string; nodeVisible: boolean; descriptorBytes: number }
export interface Device { name: string; vendorId: string; productId: string; connection: string; confirmedModel: boolean; interfaces: HidInterface[] }
export interface Diagnostics { platform: string; devices: Device[]; configurationWritesEnabled: boolean; protocolStatus: string }

export interface TransferProgress { stage: string; completed: number; total: number; message: string }

export interface KeyboardBattery { percent:number|null; charging:boolean|null; source:string; message:string; updatedAt:number|null; deviceId:string|null }
