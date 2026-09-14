import { findRecordByShortId } from "@/lib/pdf-store"

export const runtime = "nodejs"

// The short link the QR actually encodes (see app/api/pdfs/route.ts) — just
// looks up the Blob URL and redirects, so the QR can stay small instead of
// encoding that long URL directly.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shortId: string }> }
) {
  const { shortId } = await params
  const record = await findRecordByShortId(shortId)

  if (!record) {
    return new Response("No se encontró el PDF.", { status: 404 })
  }

  return Response.redirect(record.pdfPath, 307)
}
