import { launch, sleep } from './cdp.mjs'
const page = await launch({ port: 9336 })
await page.goto('http://localhost:3100/demo', 2000)
console.log('DEMO', JSON.stringify(await page.evaluate(`[...document.querySelectorAll('button,a,[role=radio],label')].filter(e=>e.offsetParent).map(e=>e.innerText.trim().replace(/\\n/g,' | ')).filter(Boolean).slice(0,40)`)))
await page.screenshot(process.argv[2] + '/demo0.png')
await page.clickText('Run checks'); await sleep(2500)
await page.screenshot(process.argv[2] + '/demo1.png')
console.log('after run: LOCKED?', await page.has('Failed'), '| text sample:', (await page.evaluate('document.body.innerText')).slice(0, 700).replace(/\n+/g,' / '))
page.close()
