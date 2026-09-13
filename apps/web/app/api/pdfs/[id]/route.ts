import { del } from "@vercel/blob"

import { removeRecord } from "@/lib/pdf-store"

export const runtime = "nodejs"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Identificador inválido." }, { status: 400 })
  }

  const record = await removeRecord(id)

  if (!record) {
    return Response.json({ error: "No se encontró el PDF." }, { status: 404 })
  }

  await Promise.all([del(record.pdfPath), del(record.qrPath)])

  return Response.json({ ok: true })
}
