import type { Metadata } from 'next'
import { NewProjectWizard } from '@/components/builder/new-project-wizard'

export const metadata: Metadata = { title: 'New project' }

export default function NewProjectPage() {
  return <NewProjectWizard />
}
