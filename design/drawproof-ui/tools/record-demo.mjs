// Records the Drawproof demo walkthrough from the real running app (mock data) into an MP4.
//   node tools/record-demo.mjs http://localhost:3101 out/drawproof-demo
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { launch, recorder, concatList, sleep } from './cdp.mjs'

const BASE = process.argv[2] ?? 'http://localhost:3101'
const OUT = process.argv[3] ?? 'out/drawproof-demo'
mkdirSync(OUT, { recursive: true })
const page = await launch({ port: 9340 })
const rec = recorder(page, `${OUT}/frames`)

const card = async (title, sub, ms) => {
  await page.evaluate(`(() => { document.getElementById('__card')?.remove(); const d=document.createElement('div'); d.id='__card';
    d.style.cssText='position:fixed;inset:0;z-index:100000;background:#2F4241;color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;text-align:center;padding:0 120px;font-family:-apple-system,Helvetica,Arial;opacity:0;transition:opacity .4s';
    d.innerHTML='<div style="font-size:60px;line-height:68px;font-weight:500;letter-spacing:-0.02em">'+${JSON.stringify(title)}+'</div><div style="font-size:26px;line-height:36px;opacity:.82;max-width:900px">'+${JSON.stringify(sub)}+'</div>';
    document.body.appendChild(d); requestAnimationFrame(()=>d.style.opacity=1) })()`)
  await sleep(ms)
  await page.evaluate(`(() => { const d=document.getElementById('__card'); if(d){d.style.opacity=0; setTimeout(()=>d.remove(),400)} })()`)
  await sleep(450)
}
const cap = async (t, ms) => { await page.caption(t); await sleep(ms) }
const go = async (path) => { await page.goto(BASE + path, 1500) }

try {
  await go('/projects/maple-st-duplex')
  rec.start()
  await card('Drawproof', 'Construction money that moves only when the building does.', 3600)

  // 1. Where the money is
  await cap('Investors fund a vault. Each stage of the build gets its own locked escrow.', 4200)
  await page.evaluate(`window.scrollTo({top: 380, behavior: 'smooth'})`); await sleep(1800)
  await cap('36,000 RLUSD is released for the foundation. 84,000 RLUSD stays locked until its stage is proven.', 4600)
  await cap('', 200)

  // 2. Honest builder
  await go('/demo')
  await cap('Every stage is a test suite: the inspector’s signed audit plus automated and AI checks.', 3200)
  await page.clickText('Honest builder'); await sleep(500)
  await page.clickText('Run checks'); await sleep(900)
  await cap('Honest builder: the audit is signed, every check passes, the escrow opens.', 5200)
  await page.evaluate(`window.scrollTo({top: 420, behavior: 'smooth'})`); await sleep(2200)

  // 3. Reused photo
  await page.evaluate(`window.scrollTo({top: 0, behavior: 'smooth'})`); await sleep(1000)
  await page.clickText('Reused photo'); await sleep(500)
  await page.clickText('Run checks'); await sleep(900)
  await cap('Now the builder reuses a photo from another project.', 3800)
  await cap('One check fails. The 48,000 RLUSD stays in escrow, and the failing check is public.', 4600)
  await page.clickText('Compare photos'); await sleep(1400)
  await cap('The same photo, from two different projects.', 4200)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(600)
  await cap('', 200)

  // 4. Inspector files a signed audit
  await go('/inspector')
  await cap('A licensed inspector, assigned by the platform, visits the site.', 3000)
  await page.clickText('Start audit'); await sleep(1300)
  await cap('They check the builder’s evidence...', 2400)
  await page.clickText('Continue'); await sleep(700)
  await cap('...record each line of the Schedule of Values...', 2000)
  await page.clickText('Mark all done'); await sleep(800)
  await page.clickText('Continue'); await sleep(600)
  await page.clickText('Add photo'); await sleep(700); await page.clickText('Add photo'); await sleep(900)
  await cap('...add their own geotagged photos...', 2200)
  await page.clickText('Continue'); await sleep(700)
  await cap('...and sign. Filing an audit never releases money; the checks decide.', 3400)
  await page.clickText('Load key to sign'); await sleep(700)
  await page.clickText('Use demo inspector key'); await sleep(1600)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(700)
  await page.clickText('Sign and file audit'); await sleep(1400)
  await page.clickText('Sign and file audit', '[role=dialog] button'); await sleep(3200)
  await cap('Audit filed on the ledger, with a transaction anyone can check.', 3600)
  await cap('', 200)

  await card('Investors fund verified builders.', 'The money moves only when each stage is proven. Devnet prototype. Not an offer to invest.', 4800)
} catch (e) {
  console.error('FAILED:', e.message)
  await page.screenshot(`${OUT}/fail.png`).catch(() => {})
}
const frames = await rec.stop()
page.close()
console.log('frames', frames.length, 'duration s', ((frames.at(-1)?.t ?? 0) / 1000).toFixed(1))
concatList(frames, `${OUT}/frames.txt`)
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${OUT}/frames.txt`, '-vf', 'fps=30,scale=1280:720,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', `${OUT}/drawproof-demo.mp4`])
console.log('wrote', `${OUT}/drawproof-demo.mp4`)
