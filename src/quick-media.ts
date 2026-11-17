import { inspectGif } from './media.mjs';
import type { Settings } from './types';

export type Media = NonNullable<Settings['media']>;
export function inspectQuickMedia(name: string, data: string, fit: 'cover' | 'contain'): Media {
  if (!/^data:image\/(gif|png|jpeg);base64,/.test(data)) throw new Error('Escolha um GIF, PNG ou JPEG.');
  const encoded = data.slice(data.indexOf(',') + 1);
  if (encoded.length > Math.ceil(4 * 1024 * 1024 / 3) * 4) throw new Error('A imagem excede 4 MiB.');
  const raw = atob(encoded);
  if (raw.length > 4 * 1024 * 1024) throw new Error('A imagem excede 4 MiB.');
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  let frames = 1, width = 0, height = 0;
  if (data.startsWith('data:image/gif;')) {
    const info = inspectGif(bytes); frames = info.frames; width=info.width; height=info.height;
    if (frames > 141) throw new Error('O GIF excede 141 quadros.');
  } else if (data.startsWith('data:image/png;')) {
    if(bytes.length<24 || ![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw new Error('PNG inválido.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);width=view.getUint32(16);height=view.getUint32(20);
  } else {
    if(bytes[0]!==255 || bytes[1]!==216)throw new Error('JPEG inválido.');
    let i=2;
    while(i+3<bytes.length){
      if(bytes[i++]!==255)break;
      while(bytes[i]===255)i++;
      const marker=bytes[i++];if(marker===0xda || marker===0xd9)break;
      const length=(bytes[i]<<8)|bytes[i+1];if(length<2 || i+length>bytes.length)break;
      if(marker>=0xc0 && marker<=0xcf && ![0xc4,0xc8,0xcc].includes(marker) && length>=7){height=(bytes[i+3]<<8)|bytes[i+4];width=(bytes[i+5]<<8)|bytes[i+6];break;}
      i+=length;
    }
  }
  if(!width || !height)throw new Error('Não foi possível ler as dimensões da imagem.');
  if(width*height>4_194_304)throw new Error('Reduza a imagem para até 4 milhões de pixels.');
  return {name, data, frames, fit};
}

export async function fileMedia(file: File, fit: 'cover' | 'contain'): Promise<Media> {
  if (file.size > 4 * 1024 * 1024) throw new Error('A imagem excede 4 MiB.');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
  return inspectQuickMedia(file.name, data, fit);
}

// Keep only a tiny still thumbnail after transfer, never an animating GIF at idle.
export async function thumbnail(media: Media): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Imagem inválida.')); img.src = media.data;
  });
  try {
    if (image.naturalWidth * image.naturalHeight > 4_194_304) throw new Error('Reduza a imagem para até 4 milhões de pixels.');
    const canvas = document.createElement('canvas'); canvas.width = 135; canvas.height = 240;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Prévia indisponível.');
    ctx.fillStyle='#10151b'; ctx.fillRect(0,0,135,240);
    const scale = media.fit === 'cover' ? Math.max(135/image.naturalWidth,240/image.naturalHeight) : Math.min(135/image.naturalWidth,240/image.naturalHeight);
    const w=image.naturalWidth*scale,h=image.naturalHeight*scale; ctx.drawImage(image,(135-w)/2,(240-h)/2,w,h);
    return canvas.toDataURL('image/jpeg',.75);
  } finally { image.src=''; }
}
