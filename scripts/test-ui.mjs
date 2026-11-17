import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve('dist');
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.S75_CHROME_PATH || '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({viewport:{width:1400,height:1100}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Serve os arquivos via interceptação: o teste não precisa de um servidor HTTP.
  await page.route('http://localhost:1420/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(root + path.sep)) return route.abort();
    const mime = file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html';
    try { await route.fulfill({body:await readFile(file),contentType:mime}); }
    catch { await route.fulfill({status:404,body:''}); }
  });
  await page.goto('http://localhost:1420/');
  await page.getByText('Prévia no navegador.',{exact:false}).waitFor();
  assert.equal(await page.locator('.keycap').count(),80);
  assert.match(await page.locator('h1').innerText(),/Visão geral/);
  const nav = name => page.getByRole('navigation').getByRole('button',{name:new RegExp(name)}).click();
  await mkdir('build/screenshots',{recursive:true});
  await page.screenshot({path:'build/screenshots/overview.png',fullPage:true});
  await nav('Teclas e camadas');
  await page.getByRole('button',{name:'Selecionar tecla A',exact:true}).click();
  await page.getByRole('combobox').first().click();
  await page.getByRole('option',{name:'Áudio · Silenciar áudio',exact:true}).click();
  await nav('Iluminação');
  await page.getByRole('button',{name:'Usar cor #80baff',exact:true}).click();
  await page.getByRole('slider').first().focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  await nav('Macros');
  await page.getByRole('button',{name:'Criar macro',exact:true}).last().click();
  await page.getByLabel('Nome da macro').fill('Atalho de teste');
  await page.getByRole('button',{name:'Gravar sequência'}).click();
  await page.keyboard.press('a');
  await page.getByRole('button',{name:'Encerrar gravação'}).click();
  assert.equal(await page.locator('tbody tr').count(),2);
  await nav('Tela LCD');
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  await page.locator('input[accept="image/png,image/jpeg,image/gif"]').setInputFiles({name:'teste.gif',mimeType:'image/gif',buffer:gif});
  await page.locator('.lcd-frame img').waitFor();
  await page.screenshot({path:'build/screenshots/lcd.png',fullPage:true});
  await nav('Perfis');
  await page.getByLabel('Nome do perfil',{exact:true}).fill('Meu perfil de teste');
  await page.getByRole('button',{name:'Salvar perfil',exact:true}).last().click();
  await page.locator('.profile-card').waitFor();
  await page.reload();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('s75-profiles-v1')||'[]').length===1);
  await nav('Perfis');
  await page.locator('.profile-card').waitFor();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('s75-profiles-v1'))[0]);
  assert.equal(stored.name,'Meu perfil de teste');
  assert.equal(stored.settings.color,'#80baff');
  assert.equal(stored.settings.brightness,1);
  assert.equal(stored.settings.mappings['base:56'],'media:mute');
  assert.equal(stored.settings.macros[0].events.length,2);
  assert.equal(stored.settings.media.frames,1);
  assert.deepEqual(errors,[]);
  console.log('Fluxos da UI verificados: 80 teclas, RGB, macro, GIF e persistência de perfil.');
} catch(error) {
  console.error(String(error).slice(0,1800)); process.exitCode=1;
} finally { await browser?.close(); }
