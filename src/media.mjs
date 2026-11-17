/** Lê estrutura e quantidade de quadros GIF; não presume o formato da tela do teclado. */
export function inspectGif(bytes) {
  if (bytes.length < 13 || !['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)))) throw new Error('Arquivo GIF inválido.');
  const width = bytes[6] | (bytes[7] << 8), height = bytes[8] | (bytes[9] << 8);
  let p = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0), frames = 0;
  const skipBlocks = () => {
    while (true) {
      if (p >= bytes.length) throw new Error('GIF incompleto.');
      const size = bytes[p++];
      if (!size) return;
      p += size;
      if (p > bytes.length) throw new Error('GIF incompleto.');
    }
  };
  while (p < bytes.length) {
    const marker = bytes[p++];
    if (marker === 0x3b) {
      if (!frames || !width || !height) throw new Error('GIF sem quadros válidos.');
      return { width, height, frames };
    }
    if (marker === 0x21) { p++; skipBlocks(); }
    else if (marker === 0x2c) {
      if (p + 9 > bytes.length) throw new Error('GIF incompleto.');
      const packed = bytes[p + 8]; p += 9;
      if (packed & 128) p += 3 * (1 << ((packed & 7) + 1));
      if (p >= bytes.length) throw new Error('GIF incompleto.');
      p++; skipBlocks(); frames++;
    } else throw new Error('Bloco GIF inválido.');
  }
  throw new Error('GIF sem marcador de término.');
}
