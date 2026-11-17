// SPDX-License-Identifier: GPL-3.0-only
// All coordinates are GNOME stage coordinates; never multiply by monitor scale.
export function anchoredRect(anchor, monitors, frame, gap = 8) {
    if (!monitors.length) return null;
    const center = {x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2};
    let index = monitors.findIndex(m => center.x >= m.x && center.x < m.x + m.width && center.y >= m.y && center.y < m.y + m.height);
    if (index < 0) {
        const distances = monitors.map(m => Math.hypot(Math.max(m.x-center.x,0,center.x-m.x-m.width), Math.max(m.y-center.y,0,center.y-m.y-m.height)));
        index = distances.indexOf(Math.min(...distances));
    }
    const area = monitors[index].workArea ?? monitors[index];
    const width = Math.min(frame.width, Math.max(1,area.width - gap*2));
    const height = Math.min(frame.height, Math.max(1,area.height - gap*2));
    const clamp = (v,min,max) => Math.max(min, Math.min(Math.max(min,max),v));
    return {index,width,height,
        x:Math.round(clamp(anchor.x+anchor.width-width, area.x+gap, area.x+area.width-width-gap)),
        y:Math.round(clamp(anchor.y+anchor.height+gap, area.y+gap, area.y+area.height-height-gap))};
}
