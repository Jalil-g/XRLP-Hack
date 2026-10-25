import { launch, sleep } from './cdp.mjs'
const page = await launch({ port: 9335 })
await page.goto('http://localhost:3100/projects/maple-st-duplex', 2000)
console.log('BUTTONS', JSON.stringify(await page.evaluate(`[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).map(e=>e.innerText.trim()).filter(Boolean).slice(0,70)`)))
console.log('H2', JSON.stringify(await page.evaluate(`[...document.querySelectorAll('h2,h3')].map(e=>e.innerText.trim()).slice(0,20)`)))
await page.clickText('Milestones', 'a'); await sleep(800)
console.log('after Milestones; has Run checks:', await page.has('Run checks'), ' compare:', await page.has('Compare'), ' No reused:', await page.has('No reused photos'))
page.close()
