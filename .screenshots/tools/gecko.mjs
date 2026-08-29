import net from 'net';
import { chromium } from 'playwright-core';
import jwt from '/app/node_modules/jsonwebtoken/index.js';
const proxy = net.createServer(c => { const up = net.connect(3001,'127.0.0.1'); c.pipe(up).pipe(c); c.on('error',()=>up.destroy()); up.on('error',()=>c.destroy()); });
await new Promise(r => proxy.listen(4545,'127.0.0.1',r));
const token = jwt.sign({ userId: 'sOfOPUHwVbN05fI8uX-Q0' }, process.env.JWT_SECRET, { expiresIn: '15m' });
const browser = await chromium.launch({ executablePath:'/usr/local/bin/plum-chromium', args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:1720,height:1050} });
await ctx.addInitScript(([t])=>{ localStorage.setItem('claude-webui-auth', JSON.stringify({state:{token:t},version:0})); },[token]);
const page = await ctx.newPage();
await page.goto('http://localhost:4545/session/Y8mOj5_9IU_9qpadX34SM?gecko-glass',{waitUntil:'networkidle',timeout:45000}).catch(e=>console.log('goto:',e.message));
await page.waitForTimeout(4000);
console.log('gecko class:', await page.evaluate(()=>document.documentElement.classList.contains('plum-engine-gecko')));
console.log('DEPLOYED (old css) backdrop:', await page.evaluate(()=>getComputedStyle(document.querySelector('.chat-composer-form')).backdropFilter));

// apply the NEW rules as they now exist in source
await page.addStyleTag({ content: `
html.plum-engine-gecko body .chat-composer-form {
  -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
  backdrop-filter: blur(20px) saturate(150%) !important;
  background:
    linear-gradient(180deg, hsl(var(--card) / 0.62), hsl(var(--background) / 0.42)),
    radial-gradient(circle at 18% 0%, hsl(var(--primary) / 0.16), transparent 36%),
    radial-gradient(circle at 78% 0%, hsl(var(--accent) / 0.14), transparent 34%) !important;
}
.session-global-edge-fade-bottom {
  background: linear-gradient(to top, hsl(var(--background) / 0.72), hsl(var(--background) / 0.3) 46%, transparent) !important;
}
`});
await page.waitForTimeout(600);
console.log('PATCHED backdrop:', await page.evaluate(()=>getComputedStyle(document.querySelector('.chat-composer-form')).backdropFilter));
// stripes at transcript level
await page.evaluate(() => {
  const host = document.querySelector('.session-chat-layered > .chat-scroll-shell') || document.querySelector('.chat-scroll-shell');
  const d = document.createElement('div');
  Object.assign(d.style,{position:'absolute',left:'0',right:'0',bottom:'0',height:'300px',zIndex:'0',background:'repeating-linear-gradient(90deg,#ff0 0 7px,#101010 7px 14px)',pointerEvents:'none'});
  host.appendChild(d);
});
await page.waitForTimeout(700);
await page.screenshot({ path:'/tmp/plum-shot/gecko-proof.png', clip:{x:120,y:820,width:1480,height:230} });
await browser.close(); proxy.close();
