import { promises as fs } from "fs"
import path from "path"

export type PdfRecord = {
  id: string
  originalName: string
  pdfPath: string
  qrPath: string
  size: number
  createdAt: string
}

const DATA_DIR = path.join(process.cwd(), "data")
const MANIFEST_PATH = path.join(DATA_DIR, "pdfs.json")
const PUBLIC_DIR = path.join(process.cwd(), "public")

export const PDF_DIR = path.join(PUBLIC_DIR, "uploads", "pdfs")
export const QR_DIR = path.join(PUBLIC_DIR, "uploads", "qrcodes")

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(PDF_DIR, { recursive: true }),
    fs.mkdir(QR_DIR, { recursive: true }),
  ])
}

export async function readManifest(): Promise<PdfRecord[]> {
  await ensureDirs()

  try {
    const raw = await fs.readFile(MANIFEST_PATH, "utf-8")
    return JSON.parse(raw) as PdfRecord[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return []
    }
    throw error
  }
}

export async function persistManifest(records: PdfRecord[]): Promise<void> {
  // Write to a temp file and rename over the manifest so a reader never
  // observes a partially-written file, then rename is atomic.
  const tmpPath = path.join(DATA_DIR, `.pdfs.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(tmpPath, JSON.stringify(records, null, 2), "utf-8")
  await fs.rename(tmpPath, MANIFEST_PATH)
}

// Every mutation that touches the manifest or the upload directories (saving
// a new PDF, picking its on-disk filename, deleting one) runs through this
// queue so concurrent requests never interleave their reads/writes and
// corrupt the manifest or collide on a filename.
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

// Turns the uploaded file's own name into a safe on-disk base name (no
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

// Appends " (1)", " (2)", ... until the name doesn't collide with an
// existing PDF or QR file. Must be called from inside withUploadLock so two
// concurrent uploads with the same original name can't pick the same slot.
export async function resolveUniqueBaseName(baseName: string): Promise<string> {
  let candidate = baseName
  let attempt = 1

  while (
    (await pathExists(path.join(PDF_DIR, `${candidate}.pdf`))) ||
    (await pathExists(path.join(QR_DIR, `${candidate}.png`)))
  ) {
    candidate = `${baseName} (${attempt})`
    attempt += 1
  }

  return candidate
}
