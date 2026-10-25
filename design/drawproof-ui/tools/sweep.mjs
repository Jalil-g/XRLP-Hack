import { launch, sleep } from './cdp.mjs'
const BASE = process.argv[2] ?? 'http://localhost:3100'
const routes = ['/', '/invest', '/portfolio', '/transactions', '/projects', '/projects/maple-st-duplex', '/projects/willow-rd-adu', '/builder', '/builder/new', '/builder/payouts', '/builder/projects', '/builder/projects/maple-st-duplex', '/demo', '/inspector', '/inspector/site-visits', '/inspector/history', '/inspector/audit/maple-st-duplex/framing', '/inspector/audit/willow-rd-adu/pre-construction']
const page = await launch({ port: 9334 })
let bad = 0
for (const r of routes) {
  page.errors.length = 0
  await page.goto(BASE + r, 1800)
  const title = await page.evaluate('document.title'); const h1 = await page.evaluate("(document.querySelector('h1')||{}).innerText||''")
  const e = page.errors.filter((x) => !/favicon|Download the React DevTools/i.test(x))
  if (e.length) bad++
  console.log(e.length ? 'ERR ' : 'ok  ', r.padEnd(46), JSON.stringify(h1.slice(0, 40)), e.length ? e.slice(0, 2) : '')
}
page.close(); process.exit(bad ? 1 : 0)
