import net from 'net';
import { chromium } from 'playwright-core';
import jwt from '/app/node_modules/jsonwebtoken/index.js';

const OUT = process.argv[2] || '/tmp/plum-shot';
const proxy = net.createServer(c => { const up = net.connect(3001,'127.0.0.1'); c.pipe(up).pipe(c); c.on('error',()=>up.destroy()); up.on('error',()=>c.destroy()); });
await new Promise(r => proxy.listen(4545,'127.0.0.1',r));
const token = jwt.sign({ userId: 'sOfOPUHwVbN05fI8uX-Q0' }, process.env.JWT_SECRET, { expiresIn: '15m' });
const browser = await chromium.launch({ executablePath:'/usr/local/bin/plum-chromium', args:['--no-sandbox'] });

async function shot(label, query, file) {
  const ctx = await browser.newContext({ viewport:{width:1720,height:1050} });
  await ctx.addInitScript(([t])=>{ localStorage.setItem('claude-webui-auth', JSON.stringify({state:{token:t},version:0})); },[token]);
  const page = await ctx.newPage();
  await page.goto(`http://localhost:4545/session/Y8mOj5_9IU_9qpadX34SM${query}`,{waitUntil:'networkidle',timeout:45000}).catch(e=>console.log('goto:',e.message));
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const f = document.querySelector('.chat-composer-form');
    const fade = document.querySelector('.session-global-edge-fade-bottom');
    const cs = getComputedStyle(f);
    return {
      gecko: document.documentElement.classList.contains('plum-engine-gecko'),
      formBackdrop: cs.backdropFilter,
      formBg: cs.backgroundColor,
      formBgImage: cs.backgroundImage.slice(0, 60),
      fadeBackdrop: fade ? getComputedStyle(fade).backdropFilter : 'no-fade',
      wrapBeforeBackdrop: (() => {
        const w = document.querySelector('.composer-wrap');
        return w ? getComputedStyle(w, '::before').backdropFilter : 'no-wrap';
      })(),
    };
  });
  console.log(label, JSON.stringify(info, null, 2));
  await page.evaluate(() => {
    const host = document.querySelector('.session-chat-layered > .chat-scroll-shell') || document.querySelector('.chat-scroll-shell');
    const d = document.createElement('div');
    Object.assign(d.style,{position:'absolute',left:'0',right:'0',bottom:'0',height:'300px',zIndex:'0',background:'repeating-linear-gradient(90deg,#ff0 0 7px,#101010 7px 14px)',pointerEvents:'none'});
    host.appendChild(d);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path:`${OUT}/${file}`, clip:{x:120,y:820,width:1480,height:230} });
  await ctx.close();
}

await shot('=== BLINK (normal) ===', '', 'deployed-blink.png');
await shot('=== GECKO (?gecko-glass) ===', '?gecko-glass', 'deployed-gecko.png');
await browser.close(); proxy.close();
