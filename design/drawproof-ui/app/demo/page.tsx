import type { Metadata } from 'next'
import { DemoConsole } from '@/components/demo/demo-console'
import { getCheckRun, getProject } from '@/lib/api'

export const metadata: Metadata = { title: 'Demo' }

export default function DemoPage() {
  const project = getProject('maple-st-duplex')!
  return (
    <DemoConsole
      project={project}
      runs={{
        honest: getCheckRun(project.slug, 'framing', 'honest')!,
        reused: getCheckRun(project.slug, 'framing', 'reused')!,
      }}
    />
  )
}
