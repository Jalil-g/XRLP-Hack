'use client'

import Link from 'next/link'
import { StatusTag } from '@/components/status-tag'
import { buttonVariants } from '@/components/ui/button'
import { getProject } from '@/lib/api'
import { useInspector } from '@/lib/inspector-store'
import { emptyLines, type QueueItem } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function dueCount(items: QueueItem[], filedKeys: string[]) {
  return items.filter((q) => !filedKeys.includes(q.key)).length
}

export function QueueTable({ items, empty = emptyLines.queue, action = 'Start audit' }: { items: QueueItem[]; empty?: string; action?: string }) {
  const filed = useInspector((s) => s.filed)
  const filedKeys = filed.map((f) => f.key)

  if (items.length === 0) return <p className="py-10 text-center t-label">{empty}</p>

  return (
    <table className="tnum w-full text-left text-[15px]">
      <thead>
        <tr className="border-b-2 border-ink">
          <th className="py-2 pr-4 font-semibold">Project</th>
          <th className="py-2 pr-4 font-semibold">Milestone</th>
          <th className="py-2 pr-4 font-semibold">Site</th>
          <th className="py-2 pr-4 font-semibold">Evidence</th>
          <th className="py-2 pr-4 font-semibold">Due</th>
          <th className="py-2 pr-4 font-semibold">Status</th>
          <th className="py-2 text-right font-semibold">
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {items.map((q) => {
          const isFiled = filedKeys.includes(q.key)
          const project = getProject(q.projectSlug)
          return (
            <tr key={q.key} className="h-14">
              <td className="py-2 pr-4">{project?.name ?? q.projectSlug}</td>
              <td className="py-2 pr-4">{q.subject}</td>
              <td className="py-2 pr-4 text-label">{q.site}</td>
              <td className="py-2 pr-4">{q.evidence}</td>
              <td className="py-2 pr-4">{q.due}</td>
              <td className="py-2 pr-4">
                <StatusTag status={isFiled ? 'Audit filed' : q.status} />
              </td>
              <td className="py-2 text-right">
                {q.href && !isFiled ? (
                  <Link href={q.href} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}>
                    {action}
                  </Link>
                ) : (
                  <span className="text-[14px] text-label">{isFiled ? 'Filed' : 'Not ready'}</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function DueNumber({ items }: { items: QueueItem[] }) {
  const filed = useInspector((s) => s.filed)
  const n = dueCount(items, filed.map((f) => f.key))
  return (
    <p className="tnum text-[40px] leading-12">
      {n} <span className="text-[20px] text-label">due</span>
    </p>
  )
}
