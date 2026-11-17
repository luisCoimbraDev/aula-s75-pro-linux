// SPDX-License-Identifier: GPL-3.0-only
export function localFileUri(text) {
    const lines=text.split(/[\r\n]+/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
    const uris=lines.filter(s=>s.startsWith('file://'));
    if(uris.length!==1)throw new Error('Arraste uma imagem de cada vez.');
    const uri=uris[0];
    if(!uri.startsWith('file:///')&&!uri.startsWith('file://localhost/'))throw new Error('Escolha um arquivo local.');
    return uri;
}
export function colorValue(text) {
    const color=text.trim();
    if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Use uma cor no formato #RRGGBB.');
    return color.toLowerCase();
}
export function batteryView(report,now=Date.now()) {
    const n=report?.percent;
    const valid=Number.isInteger(n)&&n>=0&&n<=100;
    if(!valid)return {valid:false,label:report?.source==='usb'?'USB':'Bateria —',bar:'',icon:'battery-missing-symbolic',note:report?.message??'Abra o menu para consultar a bateria.',stale:false};
    const stale=!Number.isFinite(report.updatedAt)||now-report.updatedAt>=60000;
    const link=report.source==='bluetooth'?'Bluetooth':report.source==='2.4g'?'2,4 GHz':'Linux';
    const level=n>=90?'full':n>=60?'good':n>=30?'low':n>0?'caution':'empty';
    return {valid:true,label:`${stale?'~':''}${n}%`,bar:`${stale?'~':''}${n}%`,icon:report.charging===true?'battery-good-charging-symbolic':`battery-${level}-symbolic`,note:stale?`${link} · última leitura; clique na bateria para atualizar`:`${link}${report.charging===true?' · carregando':''} · clique para atualizar`,stale};
}
