// Tiny Chrome DevTools driver (no dependencies): launch headless Chrome, click by text, screenshot, record frames.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ port = 9333, width = 1280, height = 720 } = {}) {
  const profile = join(tmpdir(), `dp-chrome-${port}`)
  rmSync(profile, { recursive: true, force: true })
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${width},${height}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = list.find((t) => t.type === 'page')
    } catch {}
  }
  if (!target) throw new Error('Chrome did not start')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })) })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result.value
  }
  const api = {
    send, evaluate, errors,
    async goto(url, settle = 1200) { await send('Page.navigate', { url }); await sleep(settle) },
    // click the first visible element whose text matches (exact, then contains)
    async clickText(text, sel = 'button,a,[role=radio],[role=button],label') {
      const ok = await evaluate(`(() => {
        const t = ${JSON.stringify(text)}.toLowerCase();
        const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.offsetParent !== null && !e.disabled);
        const txt = e => (e.innerText || e.textContent || '').trim().toLowerCase();
        const el = els.find(e => txt(e) === t) || els.find(e => txt(e).includes(t));
        if (!el) return false; el.scrollIntoView({block:'center'}); el.click(); return true })()`)
      if (!ok) throw new Error(`clickText: no "${text}"`)
    },
    async has(text) { return evaluate(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`) },
    async screenshot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')) },
    async caption(text) {
      await evaluate(`(() => { let d = document.getElementById('__cap'); if (!d) { d = document.createElement('div'); d.id='__cap';
        d.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;max-width:980px;padding:14px 24px;background:#1b2a29;color:#fff;font:500 22px/30px -apple-system,Helvetica,Arial;border-radius:10px;text-align:center;transition:opacity .25s';
        document.body.appendChild(d) } d.textContent=${JSON.stringify(text)}; d.style.opacity = ${JSON.stringify(text)} ? 1 : 0 })()`)
    },
    close() { try { ws.close() } catch {} ; proc.kill() },
  }
  return api
}

// Frame recorder: screenshots in a loop with timestamps; build an MP4 with ffmpeg afterwards.
export function recorder(page, dir) {
  mkdirSync(dir, { recursive: true })
  const frames = []
  let running = false, loop
  return {
    start() {
      running = true
      const t0 = Date.now()
      loop = (async () => {
        let n = 0
        while (running) {
          const t = Date.now() - t0
          try {
            // a screenshot can never resolve while the page is navigating: give up on it after 2.5 s and move on
            const r = await Promise.race([
              page.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('capture timeout')), 2500)),
            ])
            const f = join(dir, `f${String(n++).padStart(5, '0')}.jpg`)
            writeFileSync(f, Buffer.from(r.data, 'base64'))
            frames.push({ f, t })
          } catch {}
        }
      })()
    },
    async stop() { running = false; await Promise.race([loop, sleep(6000)]); return frames },
  }
}

export function concatList(frames, listFile, endPadMs = 1500) {
  const lines = []
  frames.forEach((fr, i) => {
    const next = frames[i + 1]
    const d = next ? (next.t - fr.t) / 1000 : endPadMs / 1000
    lines.push(`file '${resolve(fr.f)}'`, `duration ${Math.max(d, 0.04).toFixed(3)}`)
  })
  lines.push(`file '${resolve(frames.at(-1).f)}'`)
  writeFileSync(listFile, lines.join('\n'))
}
