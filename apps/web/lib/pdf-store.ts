import { head, put } from "@vercel/blob"

export type PdfRecord = {
  id: string
  originalName: string
  pdfPath: string
  qrPath: string
  size: number
  createdAt: string
}

const MANIFEST_KEY = "data/pdfs.json"

export const PDF_PREFIX = "uploads/pdfs/"
export const QR_PREFIX = "uploads/qrcodes/"

export async function readManifest(): Promise<PdfRecord[]> {
  try {
    const blob = await head(MANIFEST_KEY)
    const res = await fetch(blob.url, { cache: "no-store" })
    if (!res.ok) return []
    return (await res.json()) as PdfRecord[]
  } catch {
    return []
  }
}

export async function persistManifest(records: PdfRecord[]): Promise<void> {
  await put(MANIFEST_KEY, JSON.stringify(records, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  })
}

// Every mutation that touches the manifest or the upload files (saving a new
// PDF, picking its blob key, deleting one) runs through this queue so
// concurrent requests within the same function instance never interleave
// their reads/writes and corrupt the manifest or collide on a filename.
// Note: this only guards a single serverless instance — see resolveUniqueBaseName.
let writeQueue: Promise<unknown> = Promise.resolve()

export function withUploadLock<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task)
  writeQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

export function removeFromManifest(id: string): Promise<PdfRecord | null> {
  return withUploadLock(async () => {
    const records = await readManifest()
    const record = records.find((r) => r.id === id) ?? null
    if (!record) {
      return null
    }
    const next = records.filter((r) => r.id !== id)
    await persistManifest(next)
    return record
  })
}

const RESERVED_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

// Turns the uploaded file's own name into a safe blob key base name (no
// extension) so the saved PDF and its QR share the name the user recognizes,
// instead of an opaque id.
export function sanitizeFileBaseName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.pdf$/i, "")
  const cleaned = withoutExtension
    .replace(/[\\/?%*:|"<>]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 150)

  if (!cleaned || RESERVED_WINDOWS_NAMES.test(cleaned)) {
    return "documento"
  }

  return cleaned
}

async function blobExists(key: string): Promise<boolean> {
  try {
    await head(key)
    return true
  } catch {
    return false
  }
}

// Appends " (1)", " (2)", ... until the name doesn't collide with an
// existing PDF or QR blob. Must be called from inside withUploadLock so two
// concurrent uploads (within the same function instance) with the same
// original name can't pick the same slot.
export async function resolveUniqueBaseName(baseName: string): Promise<string> {
  let candidate = baseName
  let attempt = 1

  while (
    (await blobExists(`${PDF_PREFIX}${candidate}.pdf`)) ||
    (await blobExists(`${QR_PREFIX}${candidate}.png`))
  ) {
    candidate = `${baseName} (${attempt})`
    attempt += 1
  }

  return candidate
}
