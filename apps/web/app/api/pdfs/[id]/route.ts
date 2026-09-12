import { promises as fs } from "fs"
import path from "path"

import { PDF_DIR, QR_DIR, removeFromManifest } from "@/lib/pdf-store"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function unlinkIfExists(filePath: string) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Identificador inválido." }, { status: 400 })
  }

  const record = await removeFromManifest(id)

  if (!record) {
    return Response.json({ error: "No se encontró el PDF." }, { status: 404 })
  }

  await Promise.all([
    unlinkIfExists(path.join(PDF_DIR, path.basename(record.pdfPath))),
    unlinkIfExists(path.join(QR_DIR, path.basename(record.qrPath))),
  ])

  return Response.json({ ok: true })
}
