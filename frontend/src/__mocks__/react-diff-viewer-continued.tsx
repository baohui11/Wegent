// Mock for react-diff-viewer-continued to avoid ESM issues in Jest
interface ReactDiffViewerProps {
  oldValue?: string
  newValue?: string
  splitView?: boolean
  showDiffOnly?: boolean
  hideLineNumbers?: boolean
  compareMethod?: string
  styles?: Record<string, unknown>
}

// Named export mirrored from the real module (consumers use DiffMethod.CHARS).
export const DiffMethod = {
  CHARS: 'diffChars',
  WORDS: 'diffWords',
  LINES: 'diffLines',
} as const

export default function ReactDiffViewer({ oldValue = '', newValue = '' }: ReactDiffViewerProps) {
  return (
    <div data-testid="react-diff-viewer-mock">
      <div data-testid="old-value">{oldValue}</div>
      <div data-testid="new-value">{newValue}</div>
    </div>
  )
}
