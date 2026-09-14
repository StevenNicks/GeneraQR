import { randomBytes } from "node:crypto"

import { prisma } from "@/lib/prisma"

export type PdfRecord = {
  id: string
  shortId: string
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
  shortId: string
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

export async function findRecordByShortId(
  shortId: string
): Promise<PdfRecord | null> {
  const row = await prisma.pdfRecord.findUnique({ where: { shortId } })
  return row ? toPdfRecord(row) : null
}

// 6 random bytes as base64url is 8 URL-safe characters — short enough to
// keep the QR's target URL (and so the QR itself) small, with a collision
// space (2^48) large enough that resolveUniqueShortId only ever needs its
// retry loop as a safety net, not in practice.
function generateShortId(): string {
  return randomBytes(6).toString("base64url")
}

export async function resolveUniqueShortId(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShortId()
    const existing = await prisma.pdfRecord.findUnique({
      where: { shortId: candidate },
      select: { id: true },
    })
    if (!existing) return candidate
  }
  throw new Error("No se pudo generar un identificador corto único.")
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

// Resolving a unique short id and creating the DB row must happen as one
// step so two concurrent uploads (within the same function instance) never
// pick the same one.
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

