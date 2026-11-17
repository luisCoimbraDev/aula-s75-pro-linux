// SPDX-License-Identifier: GPL-3.0-only
//! Bounded streaming GIF/LZW decoder, sharing the compositing rules of screen-encode.mjs.
struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.position.checked_add(n).ok_or("GIF inválido")?;
        let data = self.bytes.get(self.position..end).ok_or("GIF truncado")?;
        self.position = end;
        Ok(data)
    }
    fn byte(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<usize, String> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]) as usize)
    }
    fn blocks(&mut self) -> Result<Vec<u8>, String> {
        let mut data = Vec::new();
        loop {
            let n = self.byte()? as usize;
            if n == 0 {
                return Ok(data);
            }
            data.extend_from_slice(self.take(n)?);
        }
    }
}
fn lzw(data: &[u8], minimum: u8, expected: usize) -> Result<Vec<u8>, String> {
    if !(2..=8).contains(&minimum) {
        return Err("Dicionário GIF inválido".into());
    }
    let clear = 1usize << minimum;
    let end = clear + 1;
    let mut prefix = [0usize; 4096];
    let mut suffix = [0u8; 4096];
    let mut stack = [0u8; 4097];
    for (i, value) in suffix.iter_mut().enumerate().take(clear) {
        *value = i as u8;
    }
    let mut output = Vec::with_capacity(expected);
    let mut bit = 0;
    let mut size = minimum as usize + 1;
    let mut next = end + 1;
    let mut previous = None;
    let mut first = 0;
    while bit + size <= data.len() * 8 {
        let mut code = 0;
        for k in 0..size {
            code |= (((data[(bit + k) >> 3] >> ((bit + k) & 7)) & 1) as usize) << k;
        }
        bit += size;
        if code == clear {
            size = minimum as usize + 1;
            next = end + 1;
            previous = None;
            continue;
        }
        if code == end {
            break;
        }
        let Some(old) = previous else {
            if code >= clear || output.len() >= expected {
                return Err("Fluxo GIF inválido".into());
            }
            output.push(code as u8);
            first = code as u8;
            previous = Some(code);
            continue;
        };
        let original = code;
        let mut top = 0;
        if code == next {
            stack[top] = first;
            top += 1;
            code = old;
        } else if code > next {
            return Err("Referência GIF inválida".into());
        }
        while code >= clear {
            if code >= next || code >= 4096 || top >= 4096 {
                return Err("Dicionário GIF corrompido".into());
            }
            stack[top] = suffix[code];
            top += 1;
            code = prefix[code];
        }
        first = suffix[code];
        stack[top] = first;
        top += 1;
        while top > 0 {
            top -= 1;
            if output.len() >= expected {
                return Err("Quadro GIF excede dimensões".into());
            }
            output.push(stack[top]);
        }
        if next < 4096 {
            prefix[next] = old;
            suffix[next] = first;
            next += 1;
            if next == (1 << size) && size < 12 {
                size += 1;
            }
        }
        previous = Some(original);
    }
    if output.len() != expected {
        return Err("Quadro GIF incompleto".into());
    }
    Ok(output)
}
pub fn decode(
    bytes: &[u8],
    mut frame: impl FnMut(usize, usize, &[u8], u32) -> Result<(), String>,
) -> Result<(), String> {
    let mut r = Reader { bytes, position: 0 };
    let signature = r.take(6)?;
    if signature != b"GIF87a" && signature != b"GIF89a" {
        return Err("GIF inválido".into());
    }
    let width = r.u16()?;
    let height = r.u16()?;
    if width == 0 || height == 0 || width * height > 4_194_304 {
        return Err("Reduza o GIF para até 4 milhões de pixels".into());
    }
    let packed = r.byte()?;
    let bg = r.byte()? as usize;
    r.byte()?;
    let global = if packed & 128 != 0 {
        Some(r.take(3 * (1usize << ((packed & 7) + 1)))?)
    } else {
        None
    };
    let background = global
        .and_then(|p| p.get(bg * 3..bg * 3 + 3))
        .map(|c| [c[0], c[1], c[2], 255])
        .unwrap_or([0; 4]);
    let mut canvas = vec![0; width * height * 4];
    let mut delay = 100;
    let mut disposal = 0;
    let mut transparent = None;
    let mut count = 0;
    loop {
        match r.byte()? {
            0x3b => {
                return if count > 0 {
                    Ok(())
                } else {
                    Err("GIF sem quadros".into())
                }
            }
            0x21 => {
                if r.byte()? == 0xf9 {
                    if r.byte()? != 4 {
                        return Err("Controle GIF inválido".into());
                    }
                    let control = r.byte()?;
                    disposal = (control >> 2) & 7;
                    delay = r.u16()? as u32 * 10;
                    if delay == 0 {
                        delay = 100;
                    }
                    let index = r.byte()?;
                    transparent = if control & 1 != 0 { Some(index) } else { None };
                    if r.byte()? != 0 {
                        return Err("Controle GIF inválido".into());
                    }
                } else {
                    r.blocks()?;
                }
            }
            0x2c => {
                let left = r.u16()?;
                let top = r.u16()?;
                let w = r.u16()?;
                let h = r.u16()?;
                let flags = r.byte()?;
                if w == 0 || h == 0 || w * h > 4_194_304 {
                    return Err("Dimensões de quadro inválidas".into());
                }
                let palette = if flags & 128 != 0 {
                    r.take(3 * (1usize << ((flags & 7) + 1)))?
                } else {
                    global.ok_or("GIF sem paleta")?
                };
                let minimum = r.byte()?;
                let indexes = lzw(&r.blocks()?, minimum, w * h)?;
                let background = if transparent.is_some() {
                    [0; 4]
                } else {
                    background
                };
                if count == 0 {
                    for pixel in canvas.chunks_exact_mut(4) {
                        pixel.copy_from_slice(&background);
                    }
                }
                let previous = if disposal == 3 {
                    Some(canvas.clone())
                } else {
                    None
                };
                let rows: Vec<usize> = if flags & 64 != 0 {
                    [(0, 8), (4, 8), (2, 4), (1, 2)]
                        .into_iter()
                        .flat_map(|(start, step)| (start..h).step_by(step))
                        .collect()
                } else {
                    (0..h).collect()
                };
                for (row, y) in rows.into_iter().enumerate() {
                    for x in 0..w {
                        let index = indexes[row * w + x];
                        let yy = y + top;
                        let xx = x + left;
                        if Some(index) == transparent || yy >= height || xx >= width {
                            continue;
                        }
                        let c = palette
                            .get(index as usize * 3..index as usize * 3 + 3)
                            .ok_or("Cor fora da paleta GIF")?;
                        canvas[(yy * width + xx) * 4..(yy * width + xx) * 4 + 4]
                            .copy_from_slice(&[c[0], c[1], c[2], 255]);
                    }
                }
                count += 1;
                if count > 141 {
                    return Err("GIF excede 141 quadros".into());
                }
                frame(width, height, &canvas, delay)?;
                if disposal == 2 {
                    for y in top..(top + h).min(height) {
                        for x in left..(left + w).min(width) {
                            canvas[(y * width + x) * 4..(y * width + x) * 4 + 4]
                                .copy_from_slice(&background);
                        }
                    }
                } else if let Some(previous) = previous {
                    canvas = previous;
                }
                delay = 100;
                disposal = 0;
                transparent = None;
            }
            _ => return Err("Bloco GIF inválido".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn composition_matches_pillow_fixtures() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
        for name in ["disposal-1", "disposal-2", "disposal-3", "gradient"] {
            let bytes = std::fs::read(root.join(format!("{name}.gif"))).unwrap();
            let expected = std::fs::read(root.join(format!("{name}.rgba"))).unwrap();
            let mut offset = 0;
            decode(&bytes, |_, _, rgba, _| {
                let target = &expected[offset..offset + rgba.len()];
                for (a, b) in rgba.chunks_exact(4).zip(target.chunks_exact(4)) {
                    assert_eq!(a[3], b[3]);
                    for c in 0..3 {
                        assert_eq!(
                            a[c] as u16 * a[3] as u16,
                            b[c] as u16 * b[3] as u16,
                            "{name}"
                        );
                    }
                }
                offset += rgba.len();
                Ok(())
            })
            .unwrap();
            assert_eq!(offset, expected.len());
        }
    }
}
