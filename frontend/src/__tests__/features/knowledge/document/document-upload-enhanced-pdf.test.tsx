// SPDX-FileCopyrightText: 2026 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DocumentUpload } from '@/features/knowledge/document/components/DocumentUpload'

const mockUseBatchAttachment = jest.fn()

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'document.upload.confirmUpload') {
        return `Confirm upload (${options?.count ?? 0})`
      }

      const translations: Record<string, string> = {
        'document.document.upload': 'Upload documents',
        'document.document.dropzone': 'Drop files here',
        'document.upload.uploadFile': 'Upload file',
        'document.upload.pasteText': 'Paste text',
        'document.upload.dropzoneHint': 'Drop files',
        'document.document.supportedTypes': 'Supported types',
        'document.upload.fileList': `Files (${options?.count ?? 0})`,
        'document.upload.clearAll': 'Clear all',
        'document.upload.enhancedPdfParsing.title': 'Enhanced PDF parsing',
        'document.upload.enhancedPdfParsing.description': 'OCR for scanned PDFs',
        'document.upload.summary': 'Upload summary',
        'document.upload.confirming': 'Confirming',
        'common:actions.cancel': 'Cancel',
      }

      return translations[key] ?? key
    },
  }),
}))

jest.mock('@/hooks/useBatchAttachment', () => ({
  MAX_BATCH_FILES: 20,
  useBatchAttachment: () => mockUseBatchAttachment(),
}))

jest.mock('@/features/knowledge/document/components/SplitterSettingsSection', () => ({
  SplitterSettingsSection: () => null,
}))

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@/components/ui/accordion', () => ({
  Accordion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AccordionTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  AccordionContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DocumentUpload enhanced PDF parsing toggle', () => {
  beforeEach(() => {
    mockUseBatchAttachment.mockReset()
  })

  it('shows toggle for PDF uploads and passes enhancedPdfParsing when enabled', async () => {
    const file = new File(['pdf'], 'scan.pdf', { type: 'application/pdf' })
    const onUploadComplete = jest.fn().mockResolvedValue(undefined)

    mockUseBatchAttachment.mockReturnValue({
      state: {
        files: [
          {
            id: 'file-1',
            file,
            status: 'success',
            progress: 100,
            error: null,
            attachment: {
              id: 201,
              filename: 'scan.pdf',
              file_size: 4,
              mime_type: 'application/pdf',
              status: 'success',
              text_length: 0,
              error_message: null,
              error_code: null,
              subtask_id: null,
              file_extension: '.pdf',
              created_at: '2026-04-10T00:00:00Z',
            },
          },
        ],
        isUploading: false,
        summary: null,
      },
      addFiles: jest.fn(),
      removeFile: jest.fn(),
      clearFiles: jest.fn(),
      startUpload: jest.fn(),
      retryFile: jest.fn(),
      renameFile: jest.fn(),
      reset: jest.fn(),
    })

    render(
      <DocumentUpload open={true} onOpenChange={jest.fn()} onUploadComplete={onUploadComplete} />
    )

    expect(screen.getByTestId('enhanced-pdf-parsing-switch')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('enhanced-pdf-parsing-switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm upload (1)' }))

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1))

    expect(onUploadComplete).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          attachment: expect.objectContaining({ filename: 'scan.pdf' }),
        }),
      ],
      expect.objectContaining({
        enhancedPdfParsing: true,
      })
    )
  })
})
