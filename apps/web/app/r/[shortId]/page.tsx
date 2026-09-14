import { notFound, redirect } from "next/navigation"

import { findRecordByShortId } from "@/lib/pdf-store"

export const runtime = "nodejs"

// The short link the QR actually encodes (see app/api/pdfs/route.ts) — just
// looks up the Blob URL and redirects, so the QR can stay small instead of
// encoding that long URL directly. A page (not a route handler) so a
// missing shortId can render the app's shared not-found.tsx instead of a
// bare text response.
export default async function ShortLinkPage({
  params,
}: {
  params: Promise<{ shortId: string }>
}) {
  const { shortId } = await params
  const record = await findRecordByShortId(shortId)

  if (!record) {
    notFound()
  }

  redirect(record.pdfPath)
}
