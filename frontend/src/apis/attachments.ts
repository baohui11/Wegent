// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Attachment API client for file upload and management.
 */

import { getToken } from './user'
import type { TruncationInfo } from '@/types/api'

// API base URL - use relative path for browser compatibility
const API_BASE_URL = ''

/**
 * Attachment status enum
 */
export type AttachmentStatus = 'uploading' | 'parsing' | 'ready' | 'failed'

/**
 * Attachment response from API
 */
export interface AttachmentResponse {
  id: number
  filename: string
  file_size: number
  mime_type: string
  status: AttachmentStatus
  text_length?: number | null
  error_message?: string | null
  error_code?: string | null
  truncation_info?: TruncationInfo | null
}

/**
 * Detailed attachment response
 */
export interface AttachmentDetailResponse extends AttachmentResponse {
  subtask_id?: number | null
  file_extension: string
  created_at: string
}

/**
 * Attachment preview response with extracted text snippet
 */
export interface AttachmentPreviewResponse extends AttachmentDetailResponse {
  preview_type: 'text' | 'image' | 'html' | 'none'
  preview_text?: string | null
  download_url: string
}

/**
 * Public share link response
 */
export interface PublicShareLinkResponse {
  share_url: string
  expires_at: string
}

/**
 * Error code to i18n key mapping
 */
const ERROR_CODE_MAPPING: Record<
  string,
  { titleKey: string; hintKey: string; hintParams?: Record<string, string | number> }
> = {
  unsupported_type: {
    titleKey: 'attachment.errors.unsupported_type',
    hintKey: 'attachment.errors.unsupported_type_hint',
  },
  unrecognized_type: {
    titleKey: 'attachment.errors.unrecognized_type',
    hintKey: 'attachment.errors.unrecognized_type_hint',
  },
  file_too_large: {
    titleKey: 'attachment.errors.file_too_large',
    hintKey: 'attachment.errors.file_too_large_hint',
    hintParams: { size: 100 },
  },
  parse_failed: {
    titleKey: 'attachment.errors.parse_failed',
    hintKey: 'attachment.errors.parse_failed_hint',
  },
  encrypted_pdf: {
    titleKey: 'attachment.errors.encrypted_pdf',
    hintKey: 'attachment.errors.encrypted_pdf_hint',
  },
  legacy_doc: {
    titleKey: 'attachment.errors.legacy_doc',
    hintKey: 'attachment.errors.legacy_doc_hint',
  },
  legacy_ppt: {
    titleKey: 'attachment.errors.legacy_ppt',
    hintKey: 'attachment.errors.legacy_ppt_hint',
  },
  legacy_xls: {
    titleKey: 'attachment.errors.legacy_xls',
    hintKey: 'attachment.errors.legacy_xls_hint',
  },
}

/**
 * Get localized error message from error code
 * @param errorCode - Backend error code
 * @param t - i18n translation function
 * @returns Localized error message or undefined
 */
export function getErrorMessageFromCode(
  errorCode: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string, params?: Record<string, any>) => string
): string | undefined {
  if (!errorCode) return undefined

  const mapping = ERROR_CODE_MAPPING[errorCode]
  if (!mapping) return undefined

  const title = t(mapping.titleKey)
  const hint = t(mapping.hintKey, mapping.hintParams || { types: t('attachment.supported_types') })
  return `${title}: ${hint}`
}

/**
 * Known supported file extensions (for display purposes)
 * Note: The backend also supports any text-based files via MIME detection
 */
export const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.csv',
  '.xmind',
  '.txt',
  '.md',
  '.html',
  '.htm',
  '.html5',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
]

/**
 * Common code file extensions (for icon display)
 */
export const CODE_FILE_EXTENSIONS = [
  '.py',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.lua',
  '.r',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.vue',
  '.svelte',
]

/**
 * Common config file extensions (for icon display)
 */
export const CONFIG_FILE_EXTENSIONS = [
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.env',
  '.properties',
  '.dockerfile',
  '.gitignore',
  '.editorconfig',
  '.eslintrc',
  '.prettierrc',
]

/**
 * Supported MIME types
 */
export const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/vnd.xmind.workbook',
  'text/plain',
  'text/markdown',
  'text/html',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/webp',
]

/**
 * Maximum file size (100 MB)
 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024

/**
 * Check if a file extension is supported
 * Note: Returns true for all extensions - backend will use MIME detection for unknown types
 */
export function isSupportedExtension(_filename: string): boolean {
  // Allow all file types - the backend will validate using MIME detection
  // for unknown extensions and return appropriate error messages
  return true
}

/**
 * Check if file size is within limits
 */
export function isValidFileSize(size: number): boolean {
  return size <= MAX_FILE_SIZE
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.toLowerCase().substring(filename.lastIndexOf('.'))
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
}

/**
 * Get file icon based on extension
 */
export function getFileIcon(extension: string): string {
  const ext = extension.toLowerCase()
  switch (ext) {
    case '.pdf':
      return '📄'
    case '.doc':
    case '.docx':
      return '📝'
    case '.ppt':
    case '.pptx':
      return '📊'
    case '.xls':
    case '.xlsx':
    case '.csv':
    case '.xmind':
      return '📈'
    case '.txt':
    case '.md':
      return '📃'
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
    case '.bmp':
    case '.webp':
      return '🖼️'
    case '.html':
    case '.htm':
    case '.html5':
      return '🌐'
    default:
      // Check for code files
      if (CODE_FILE_EXTENSIONS.includes(ext)) {
        return '💻'
      }
      // Check for config files
      if (CONFIG_FILE_EXTENSIONS.includes(ext)) {
        return '⚙️'
      }
      // Default icon for other text files
      return '📄'
  }
}

/**
 * Image file extensions
 */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']

/**
 * HTML file extensions
 */
export const HTML_EXTENSIONS = ['.html', '.htm', '.html5']

/**
 * Check if a file extension is an image type
 */
export function isImageExtension(extension: string): boolean {
  const ext = extension.toLowerCase()
  return IMAGE_EXTENSIONS.includes(ext)
}

/**
 * Check if a file extension is an HTML type
 */
export function isHtmlExtension(extension: string): boolean {
  const ext = extension.toLowerCase()
  return HTML_EXTENSIONS.includes(ext)
}

/**
 * Get image preview URL for an attachment
 *
 * @param attachmentId - Attachment ID
 * @param shareToken - Optional share token for public access
 * @returns Preview URL
 */
export function getAttachmentPreviewUrl(attachmentId: number, shareToken?: string): string {
  const baseUrl = `${API_BASE_URL}/api/attachments/${attachmentId}/download`
  if (shareToken) {
    return `${baseUrl}?share_token=${encodeURIComponent(shareToken)}`
  }
  return baseUrl
}

/**
 * Server-advertised upload capabilities.
 */
export interface UploadCapabilities {
  direct_upload: boolean
  max_file_size_mb: number
  storage_backend: string
}

/**
 * Response from POST /api/attachments/presign-upload.
 */
export interface PresignUploadResponse {
  attachment_id: number
  upload_url: string
  storage_key: string
  method: string
  expires_at: string
}

/**
 * In-process cache for the capabilities endpoint. Cleared on token change.
 * The capabilities are not expected to flip during a session, and the
 * direct-upload path falls back to multipart on any error, so a short
 * cache is safe.
 */
let _capabilitiesCache: { token: string | null; value: UploadCapabilities } | null = null

/**
 * Fetch the server's upload capabilities. Cached per-token for the
 * lifetime of the page.
 */
export async function getUploadCapabilities(): Promise<UploadCapabilities> {
  const token = getToken()

  if (_capabilitiesCache && _capabilitiesCache.token === token) {
    return _capabilitiesCache.value
  }

  const response = await fetch(`${API_BASE_URL}/api/attachments/upload-capabilities`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (!response.ok) {
    // Treat any failure as "direct upload unsupported" so callers fall back
    // to the multipart path silently.
    const fallback: UploadCapabilities = {
      direct_upload: false,
      max_file_size_mb: MAX_FILE_SIZE / (1024 * 1024),
      storage_backend: 'mysql',
    }
    _capabilitiesCache = { token, value: fallback }
    return fallback
  }

  const value: UploadCapabilities = await response.json()
  _capabilitiesCache = { token, value }
  return value
}

/**
 * Allocate a SubtaskContext row and obtain a presigned PUT URL.
 */
export async function presignAttachmentUpload(args: {
  filename: string
  fileSize: number
  mimeType?: string
  subtaskId?: number
  overwriteAttachmentId?: number
}): Promise<PresignUploadResponse> {
  const token = getToken()

  const response = await fetch(`${API_BASE_URL}/api/attachments/presign-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      filename: args.filename,
      file_size: args.fileSize,
      mime_type: args.mimeType ?? null,
      subtask_id: args.subtaskId ?? 0,
      overwrite_attachment_id: args.overwriteAttachmentId ?? null,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    let message = 'Failed to allocate upload slot'
    if (error.detail) {
      message = typeof error.detail === 'string' ? error.detail : error.detail.message || message
    }
    throw new Error(message)
  }

  return response.json()
}

/**
 * Confirm a direct upload, triggering server-side parsing.
 */
export async function confirmAttachmentUpload(
  attachmentId: number
): Promise<AttachmentResponse> {
  const token = getToken()

  const response = await fetch(
    `${API_BASE_URL}/api/attachments/${attachmentId}/confirm-upload`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    let message = 'Failed to confirm upload'
    if (error.detail) {
      message = typeof error.detail === 'string' ? error.detail : error.detail.message || message
    }
    throw new Error(message)
  }

  return response.json()
}

/**
 * PUT a file body to a presigned URL with XHR-based progress tracking.
 *
 * Internal helper for the direct-upload flow. Returns the resulting
 * status code so the caller can decide whether to confirm the upload.
 */
function putFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  onProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable && onProgress) {
        // Reserve a small slice (0-95) for the upload itself, leaving
        // 95-100 for the confirm round trip below.
        onProgress(Math.round((event.loaded / event.total) * 95))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Direct upload failed: HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error during direct upload')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    xhr.open('PUT', uploadUrl)
    // Browsers infer Content-Type from File when set explicitly. MinIO
    // accepts any content-type for presigned PUTs.
    if (file.type) {
      xhr.setRequestHeader('Content-Type', file.type)
    }
    xhr.send(file)
  })
}

/**
 * Upload a file via the direct-to-S3 flow.
 *
 * 1. Ask the backend for a presigned URL
 * 2. PUT the body straight to MinIO/S3 (skips the backend process)
 * 3. POST /confirm-upload so the backend can parse the file
 */
async function uploadAttachmentDirect(
  file: File,
  onProgress?: (progress: number) => void,
  overwriteAttachmentId?: number
): Promise<AttachmentResponse> {
  const presigned = await presignAttachmentUpload({
    filename: file.name,
    fileSize: file.size,
    mimeType: file.type || undefined,
    overwriteAttachmentId,
  })

  await putFileToPresignedUrl(presigned.upload_url, file, onProgress)

  onProgress?.(97)
  const result = await confirmAttachmentUpload(presigned.attachment_id)
  onProgress?.(100)
  return result
}

/**
 * Upload a file via the legacy multipart endpoint.
 */
function uploadAttachmentMultipart(
  file: File,
  onProgress?: (progress: number) => void,
  overwriteAttachmentId?: number
): Promise<AttachmentResponse> {
  const token = getToken()

  const formData = new FormData()
  formData.append('file', file)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', event => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100)
        onProgress(progress)
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText)
          resolve(response)
        } catch {
          reject(new Error('Failed to parse response'))
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText)
          let errorMessage = 'Upload failed'
          if (error.detail) {
            if (typeof error.detail === 'string') {
              errorMessage = error.detail
            } else if (typeof error.detail === 'object' && error.detail.message) {
              errorMessage = error.detail.message
            }
          }
          reject(new Error(errorMessage))
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`))
        }
      }
    })

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'))
    })

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload cancelled'))
    })

    const url = overwriteAttachmentId
      ? `${API_BASE_URL}/api/attachments/upload?overwrite_attachment_id=${overwriteAttachmentId}`
      : `${API_BASE_URL}/api/attachments/upload`
    xhr.open('POST', url)
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.send(formData)
  })
}

/**
 * Upload a file attachment.
 *
 * Uses the direct-to-S3 flow when the server advertises support and
 * falls back to the multipart upload endpoint otherwise. Errors in the
 * direct path also fall back so a misconfigured object store does not
 * block users from uploading.
 *
 * @param file - File to upload
 * @param onProgress - Optional progress callback (0-100)
 * @param overwriteAttachmentId - Existing attachment to overwrite (optional)
 */
export async function uploadAttachment(
  file: File,
  onProgress?: (progress: number) => void,
  overwriteAttachmentId?: number
): Promise<AttachmentResponse> {
  if (!isValidFileSize(file.size)) {
    throw new Error(`文件大小超过 ${MAX_FILE_SIZE / (1024 * 1024)} MB 限制`)
  }

  const capabilities = await getUploadCapabilities()
  if (capabilities.direct_upload) {
    try {
      return await uploadAttachmentDirect(file, onProgress, overwriteAttachmentId)
    } catch (err) {
      // Surface direct-upload failures by logging and falling back to the
      // multipart path. This keeps the user-visible behaviour unchanged
      // when MinIO is misconfigured.
      console.warn('[attachments] direct upload failed, falling back to multipart', err)
    }
  }

  return uploadAttachmentMultipart(file, onProgress, overwriteAttachmentId)
}

/**
 * Get attachment details by ID
 *
 * @param attachmentId - Attachment ID
 * @param shareToken - Optional share token for public access (no login required)
 * @returns Attachment details
 */
export async function getAttachment(
  attachmentId: number,
  shareToken?: string
): Promise<AttachmentDetailResponse> {
  const token = getToken()
  let url = `${API_BASE_URL}/api/attachments/${attachmentId}`

  // Add share_token as query parameter if provided
  if (shareToken) {
    url += `?share_token=${encodeURIComponent(shareToken)}`
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      // Only include Authorization header if we have a token and no shareToken
      // shareToken-based access doesn't require JWT authentication
      ...(!shareToken && token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to get attachment')
  }

  return response.json()
}

/**
 * Get attachment preview by ID
 *
 * @param attachmentId - Attachment ID
 * @param shareToken - Optional share token for public access (no login required)
 * @returns Attachment preview details
 */
export async function getAttachmentPreview(
  attachmentId: number,
  shareToken?: string
): Promise<AttachmentPreviewResponse> {
  const token = getToken()
  let url = `${API_BASE_URL}/api/attachments/${attachmentId}/preview`

  // Add share_token as query parameter if provided
  if (shareToken) {
    url += `?share_token=${encodeURIComponent(shareToken)}`
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      // Only include Authorization header if we have a token and no shareToken
      // shareToken-based access doesn't require JWT authentication
      ...(!shareToken && token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to get attachment preview')
  }

  return response.json()
}

/**
 * Get attachment download URL
 *
 * @param attachmentId - Attachment ID
 * @param shareToken - Optional share token for public access
 * @returns Download URL
 */
export function getAttachmentDownloadUrl(attachmentId: number, shareToken?: string): string {
  const baseUrl = `${API_BASE_URL}/api/attachments/${attachmentId}/download`
  if (shareToken) {
    return `${baseUrl}?share_token=${encodeURIComponent(shareToken)}`
  }
  return baseUrl
}

/**
 * Download attachment file
 *
 * @param attachmentId - Attachment ID
 * @param filename - Optional filename for download. If not provided, will be extracted from Content-Disposition header
 * @param shareToken - Optional share token for public access (no login required)
 */
export async function downloadAttachment(
  attachmentId: number,
  filename?: string,
  shareToken?: string
): Promise<void> {
  const token = getToken()
  const downloadUrl = getAttachmentDownloadUrl(attachmentId, shareToken)

  const response = await fetch(downloadUrl, {
    method: 'GET',
    headers: {
      // Only include Authorization header if we have a token and no shareToken
      // shareToken-based access doesn't require JWT authentication
      ...(!shareToken && token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (!response.ok) {
    throw new Error('Failed to download attachment')
  }

  // Extract filename from Content-Disposition header if not provided
  let downloadFilename = filename
  if (!downloadFilename) {
    const contentDisposition = response.headers.get('Content-Disposition')
    if (contentDisposition) {
      // Parse filename from Content-Disposition header
      // Format: attachment; filename="example.pdf" or attachment; filename*=UTF-8''example.pdf
      // Try RFC 5987 format first (filename*=UTF-8''encoded_filename)
      const rfc5987Match = contentDisposition.match(/filename\*=UTF-8''(.+)/)
      if (rfc5987Match && rfc5987Match[1]) {
        downloadFilename = rfc5987Match[1]
        // Decode URI component if it's encoded
        try {
          downloadFilename = decodeURIComponent(downloadFilename)
        } catch {
          // Keep original if decode fails
        }
      } else {
        // Fallback to standard format (filename="example.pdf")
        const standardMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (standardMatch && standardMatch[1]) {
          downloadFilename = standardMatch[1].replace(/['"]/g, '')
        }
      }
    }
    // Fallback filename if extraction fails
    if (!downloadFilename) {
      downloadFilename = `attachment-${attachmentId}.file`
    }
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = downloadFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Delete an attachment
 *
 * @param attachmentId - Attachment ID
 */
export async function deleteAttachment(attachmentId: number): Promise<void> {
  const token = getToken()

  const response = await fetch(`${API_BASE_URL}/api/attachments/${attachmentId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to delete attachment')
  }
}

/**
 * Get attachment by subtask ID
 *
 * @param subtaskId - Subtask ID
 * @returns Attachment details or null
 */
export async function getAttachmentBySubtask(
  subtaskId: number
): Promise<AttachmentDetailResponse | null> {
  const token = getToken()

  const response = await fetch(`${API_BASE_URL}/api/attachments/subtask/${subtaskId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return null
    }
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to get attachment')
  }

  const data = await response.json()
  return data || null
}

/**
 * Create public share link for attachment
 *
 * @param attachmentId - Attachment ID
 * @param expiresInDays - Link expiration time in days (1-30, default: 7)
 * @returns Share URL and expiration time
 */
export async function createAttachmentShareLink(
  attachmentId: number,
  expiresInDays: number = 7
): Promise<PublicShareLinkResponse> {
  const token = getToken()

  const response = await fetch(
    `${API_BASE_URL}/api/attachments/${attachmentId}/public-share?expires_in_days=${expiresInDays}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to create share link')
  }

  return response.json()
}

/**
 * Attachment API exports
 */
export const attachmentApis = {
  uploadAttachment,
  getUploadCapabilities,
  presignAttachmentUpload,
  confirmAttachmentUpload,
  getAttachment,
  getAttachmentPreview,
  getAttachmentDownloadUrl,
  downloadAttachment,
  deleteAttachment,
  getAttachmentBySubtask,
  createAttachmentShareLink,
}
