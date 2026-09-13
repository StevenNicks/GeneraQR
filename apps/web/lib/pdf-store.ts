import { head } from "@vercel/blob"

import { prisma } from "@/lib/prisma"

export type PdfRecord = {
  id: string
  originalName: string
  pdfPath: string
  qrPath: string
  size: number
  createdAt: string
}

export const PDF_PREFIX = "uploads/pdfs/"
export const QR_PREFIX = "uploads/qrcodes/"

function toPdfRecord(row: {
  id: string
  originalName: string
  pdfPath: string
  qrPath: string
  size: number
  createdAt: Date
}): PdfRecord {
  return { ...row, createdAt: row.createdAt.toISOString() }
}

export async function readManifest(): Promise<PdfRecord[]> {
  const rows = await prisma.pdfRecord.findMany({
    orderBy: { createdAt: "desc" },
  })
  return rows.map(toPdfRecord)
}

export async function createRecord(
  data: Omit<PdfRecord, "id" | "createdAt">
): Promise<PdfRecord> {
  const row = await prisma.pdfRecord.create({ data })
  return toPdfRecord(row)
}

export async function removeRecord(id: string): Promise<PdfRecord | null> {
  try {
    const row = await prisma.pdfRecord.delete({ where: { id } })
    return toPdfRecord(row)
  } catch {
    return null
  }
}

// Resolving a free filename in Blob storage and creating the DB row must
// happen as one step so two concurrent uploads (within the same function
// instance) with the same original name never pick the same slot.
let writeQueue: Promise<unknown> = Promise.resolve()

export function withUploadLock<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task)
  writeQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
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
