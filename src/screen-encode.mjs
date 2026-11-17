// SPDX-License-Identifier: GPL-3.0-only
// GIF parsing/LZW/compositing and bounded conversion; no external decoder or service.
const MAX_SOURCE_PIXELS = 4_194_304;
const WIDTH = 135, HEIGHT = 240, FRAME_SIZE = WIDTH * HEIGHT * 2;

function lzw(data, minimum, expected) {
  if (minimum < 2 || minimum > 8) throw new Error('Dicionário GIF inválido.');
  const clear = 1 << minimum, end = clear + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  const out = new Uint8Array(expected);
  let bit = 0, size = minimum + 1, next = end + 1, previous = -1, first = 0, pos = 0;
  while (bit + size <= data.length * 8) {
    let code = 0;
    for (let k = 0; k < size; k++) code |= ((data[(bit + k) >> 3] >> ((bit + k) & 7)) & 1) << k;
    bit += size;
    if (code === clear) { size = minimum + 1; next = end + 1; previous = -1; continue; }
    if (code === end) break;
    if (previous < 0) {
      if (code >= clear || pos >= expected) throw new Error('Fluxo GIF inválido.');
      out[pos++] = code; first = code; previous = code; continue;
    }
    const original = code; let top = 0;
    if (code === next) { stack[top++] = first; code = previous; }
    else if (code > next) throw new Error('Referência GIF inválida.');
    while (code >= clear) {
      if (code >= next || top >= 4096) throw new Error('Dicionário GIF corrompido.');
      stack[top++] = suffix[code]; code = prefix[code];
    }
    first = suffix[code]; stack[top++] = first;
    while (top) { if (pos >= expected) throw new Error('Quadro GIF excede suas dimensões.'); out[pos++] = stack[--top]; }
    if (next < 4096) { prefix[next] = previous; suffix[next] = first; next++; if (next === (1 << size) && size < 12) size++; }
    previous = original;
  }
  if (pos !== expected) throw new Error('Quadro GIF incompleto.');
  return out;
}

export function* decodeGifFrames(bytes) {
  if (bytes.length < 13 || !['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) throw new Error('Arquivo GIF inválido.');
  const u16 = p => bytes[p] | (bytes[p + 1] << 8);
  const width = u16(6), height = u16(8);
  if (!width || !height || width * height > MAX_SOURCE_PIXELS) throw new Error('Reduza o GIF para até 4 milhões de pixels por quadro.');
  let p = 13, globalPalette = null;
  if (bytes[10] & 128) { const n = 3 * (1 << ((bytes[10] & 7) + 1)); globalPalette = bytes.slice(p, p + n); p += n; }
  const canvas = new Uint8ClampedArray(width * height * 4);
  const bgIndex = bytes[11];
  const background = globalPalette && bgIndex * 3 + 2 < globalPalette.length ? [...globalPalette.slice(bgIndex * 3, bgIndex * 3 + 3), 255] : [0, 0, 0, 0];
  let delay = 100, disposal = 0, transparent = -1, count = 0;
  const need = n => { if (p + n > bytes.length) throw new Error('GIF incompleto.'); };
  const blocks = () => {
    const parts = []; let length = 0;
    while (true) { need(1); const n = bytes[p++]; if (!n) break; need(n); parts.push(bytes.subarray(p, p + n)); p += n; length += n; }
    const data = new Uint8Array(length); let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.length; }
    return data;
  };
  while (p < bytes.length) {
    const marker = bytes[p++];
    if (marker === 0x3b) { if (!count) throw new Error('GIF sem quadros.'); return; }
    if (marker === 0x21) {
      need(1); const kind = bytes[p++];
      if (kind === 0xf9) {
        need(6); if (bytes[p++] !== 4) throw new Error('Controle GIF inválido.');
        const packed = bytes[p++]; disposal = (packed >> 2) & 7; delay = u16(p) * 10 || 100; p += 2;
        transparent = (packed & 1) ? bytes[p] : -1; p++;
        if (bytes[p++] !== 0) throw new Error('Controle GIF incompleto.');
      } else blocks();
      continue;
    }
    if (marker !== 0x2c) throw new Error('Bloco GIF não reconhecido.');
    need(9); const left = u16(p), top = u16(p + 2), w = u16(p + 4), h = u16(p + 6), packed = bytes[p + 8]; p += 9;
    if (!w || !h || w * h > MAX_SOURCE_PIXELS) throw new Error('Dimensões de quadro GIF inválidas.');
    let palette = globalPalette;
    if (packed & 128) { const n = 3 * (1 << ((packed & 7) + 1)); need(n); palette = bytes.slice(p, p + n); p += n; }
    if (!palette) throw new Error('GIF sem paleta.');
    need(1); const minimum = bytes[p++]; const indexes = lzw(blocks(), minimum, w * h);
    if (!count) { const bg = transparent >= 0 ? [0, 0, 0, 0] : background; for (let i = 0; i < canvas.length; i += 4) canvas.set(bg, i); }
    const previous = disposal === 3 ? canvas.slice() : null;
    const rows = [];
    if (packed & 64) { for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) rows.push(y); }
    else for (let y = 0; y < h; y++) rows.push(y);
    for (let row = 0; row < h; row++) for (let x = 0; x < w; x++) {
      const index = indexes[row * w + x], y = rows[row] + top, targetX = x + left;
      if (index === transparent || y >= height || targetX >= width) continue;
      if (index * 3 + 2 >= palette.length) throw new Error('Cor fora da paleta GIF.');
      const offset = (y * width + targetX) * 4;
      canvas[offset] = palette[index * 3]; canvas[offset + 1] = palette[index * 3 + 1]; canvas[offset + 2] = palette[index * 3 + 2]; canvas[offset + 3] = 255;
    }
    count++; if (count > 141) throw new Error('O GIF excede o limite de 141 quadros do S75 Pro.');
    yield { width, height, rgba: canvas, delayMs: delay };
    if (disposal === 2) {
      const bg = transparent >= 0 ? [0, 0, 0, 0] : background;
      for (let y = top; y < Math.min(top + h, height); y++) for (let x = left; x < Math.min(left + w, width); x++) canvas.set(bg, (y * width + x) * 4);
    } else if (previous) canvas.set(previous);
    delay = 100; disposal = 0; transparent = -1;
  }
  throw new Error('GIF sem marcador de término.');
}

export function rgbaTo565(rgba, width, height, fit = 'cover') {
  if (!width || !height || rgba.length !== width * height * 4) throw new Error('Quadro RGBA inválido.');
  const scale = fit === 'contain' ? Math.min(WIDTH / width, HEIGHT / height) : Math.max(WIDTH / width, HEIGHT / height);
  const dx = (WIDTH - width * scale) / 2, dy = (HEIGHT - height * scale) / 2;
  const out = new Uint8Array(FRAME_SIZE);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const px = (x + .5 - dx) / scale - .5, py = (y + .5 - dy) / scale - .5;
    if (px < -.5 || py < -.5 || px >= width - .5 || py >= height - .5) continue;
    const sx = Math.max(0, Math.min(width - 1, px)), sy = Math.max(0, Math.min(height - 1, py));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), ax = sx - x0, ay = sy - y0;
    const rgb = [0, 0, 0];
    for (const [xx, yy, weight] of [[x0,y0,(1-ax)*(1-ay)],[x1,y0,ax*(1-ay)],[x0,y1,(1-ax)*ay],[x1,y1,ax*ay]]) {
      const i = (yy * width + xx) * 4, alpha = rgba[i + 3] / 255;
      for (let c = 0; c < 3; c++) rgb[c] += rgba[i + c] * alpha * weight;
    }
    const r = Math.round(rgb[0]), g = Math.round(rgb[1]), b = Math.round(rgb[2]);
    const value = ((r & 248) << 8) | ((g & 252) << 3) | (b >> 3), offset = (y * WIDTH + x) * 2;
    out[offset] = value & 255; out[offset + 1] = value >> 8;
  }
  return out;
}

export function bytesToBase64(bytes) { const parts = []; for (let i=0;i<bytes.length;i+=32768) parts.push(String.fromCharCode(...bytes.subarray(i,i+32768))); return btoa(parts.join('')); }
function dataBytes(url) { const base64 = url.split(',')[1]; if (!base64) throw new Error('Imagem não encontrada.'); const s=atob(base64); return Uint8Array.from(s,c=>c.charCodeAt(0)); }

export async function prepareMedia(media, progress = (_n, _total) => {}, cancelled = () => false) {
  const frames = [], delays = [];
  const append = (pixels, delay) => {
    let remaining = delay;
    while (remaining > 0) { if (frames.length >= 141) throw new Error('O tempo da animação exige mais de 141 quadros. Reduza quadros ou duração dos intervalos do GIF.'); const d=Math.min(510,remaining); frames.push(pixels); delays.push(d); remaining-=d; }
  };
  if (media.data.startsWith('data:image/gif;')) {
    let n=0;
    for (const frame of decodeGifFrames(dataBytes(media.data))) {
      if (cancelled()) throw new Error('Conversão cancelada.');
      append(rgbaTo565(frame.rgba,frame.width,frame.height,media.fit),frame.delayMs);
      progress(++n,media.frames); await new Promise(resolve=>setTimeout(resolve,0));
    }
  } else {
    const image = await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Imagem inválida.'));img.src=media.data;});
    if (image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) throw new Error('Reduza a imagem para até 4 milhões de pixels.');
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');if(!context)throw new Error('Não foi possível converter a imagem.');
    context.drawImage(image,0,0);append(rgbaTo565(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,media.fit),100);progress(1,1);
  }
  if (cancelled()) throw new Error('Conversão cancelada.');
  const bytes=new Uint8Array(frames.length*FRAME_SIZE);frames.forEach((frame,i)=>bytes.set(frame,i*FRAME_SIZE));
  return {rgb565Base64:bytesToBase64(bytes),delaysMs:delays};
}

/** Projects image pixels into physical key positions; native code adds the fixed LED indices. */
export async function prepareLiveMedia(media, keys, progress = (_n, _total) => {}, cancelled = () => false) {
  const frames=[],delays=[];
  const append=frame=>{
    if(cancelled())throw new Error('Conversão cancelada.');
    const scale=media.fit==='contain'?Math.min(640/frame.width,264/frame.height):Math.max(640/frame.width,264/frame.height);
    const dx=(640-frame.width*scale)/2,dy=(264-frame.height*scale)/2;
    const out=new Uint8Array(80*3);
    keys.forEach((key,i)=>{const x=Math.floor((key.x+key.width/2-dx)/scale),y=Math.floor((key.y+key.height/2-dy)/scale);if(x<0||y<0||x>=frame.width||y>=frame.height)return;const p=(y*frame.width+x)*4;for(let c=0;c<3;c++)out[i*3+c]=Math.round(frame.rgba[p+c]*frame.rgba[p+3]/255);});
    let delay=frame.delayMs;while(delay>0){if(frames.length>=141)throw new Error('A animação dos LEDs excede 141 quadros.');frames.push(out);const d=Math.min(65535,delay);delays.push(d);delay-=d;}
  };
  if(media.data.startsWith('data:image/gif;')){
    let count=0;for(const frame of decodeGifFrames(dataBytes(media.data))){append(frame);progress(++count,media.frames);await new Promise(resolve=>setTimeout(resolve,0));}
  }else{
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Imagem inválida.'));img.src=media.data;});
    if(image.naturalWidth*image.naturalHeight>MAX_SOURCE_PIXELS)throw new Error('Imagem grande demais.');
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas indisponível.');context.drawImage(image,0,0);
    append({width:canvas.width,height:canvas.height,rgba:context.getImageData(0,0,canvas.width,canvas.height).data,delayMs:100});progress(1,1);
  }
  const bytes=new Uint8Array(frames.length*240);frames.forEach((frame,i)=>bytes.set(frame,i*240));return {framesRgbBase64:bytesToBase64(bytes),delaysMs:delays};
}
