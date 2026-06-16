import type { ReactNode } from 'react'

interface SectionProps {
  children: ReactNode
  title: string
}

export function Section({ children, title }: SectionProps) {
  return (
    <section className="trigger-editor-section">
      <h2 className="trigger-editor-section-title">{title}</h2>
      {children}
    </section>
  )
}

interface FormGridRowProps {
  children: ReactNode
  label: string
}

export function FormGridRow({ children, label }: FormGridRowProps) {
  return (
    <div className="trigger-editor-form-row">
      <div className="trigger-editor-form-label">{label}</div>
      <div className="trigger-editor-form-control">{children}</div>
    </div>
  )
}
