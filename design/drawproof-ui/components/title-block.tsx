export function TitleBlock({
  project,
  sheet,
  revision,
  date = 'Oct 25, 2026',
}: {
  project: string
  sheet: string
  revision: string
  date?: string
}) {
  const cells = [
    ['Project', project],
    ['Sheet', sheet],
    ['Rev', revision],
    ['Date', date],
  ]
  return (
    <div className="mt-16 flex justify-end">
      <dl className="grid grid-cols-[auto_1fr] border border-ink font-mono text-[12px] leading-4 text-ink">
        {cells.map(([k, v], i) => (
          <div key={k} className={`contents ${i > 0 ? '[&>*]:border-t [&>*]:border-ink' : ''}`}>
            <dt className="border-r border-ink px-2 py-1.5 text-label">{k}</dt>
            <dd className="min-w-44 px-2 py-1.5">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
