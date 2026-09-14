import { put } from "@vercel/blob"

import {
  PDF_PREFIX,
  QR_PREFIX,
  type PdfRecord,
  createRecord,
  readManifest,
  resolveUniqueShortId,
  sanitizeFileBaseName,
  withUploadLock,
} from "@/lib/pdf-store"
import { renderStyledQrPng } from "@/lib/qr-style"

export const runtime = "nodejs"

const MAX_SIZE_BYTES = 25 * 1024 * 1024

export async function GET() {
  const records = await readManifest()
  return Response.json(records)
}

export async function POST(request: Request) {
  let formData: FormData

  try {
    formData = await request.formData()
  } catch {
    return Response.json(
      { error: "La solicitud no contiene un formulario válido." },
      { status: 400 }
    )
  }

  const file = formData.get("file")

  if (!(file instanceof File)) {
    return Response.json(
      { error: "No se recibió ningún archivo." },
      { status: 400 }
    )
  }

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")

  if (!isPdf) {
    return Response.json(
      { error: "El archivo debe ser un PDF." },
      { status: 400 }
    )
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Response.json(
      { error: "El PDF supera el tamaño máximo permitido (25MB)." },
      { status: 400 }
    )
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  // The QR encodes this app's own short redirect (see app/r/[shortId]),
  // not the Blob URL directly — much shorter, so the QR itself renders as a
  // simpler symbol. `request.url`'s origin matches however the app is being
  // reached (localhost, LAN IP, or a real domain), so the link keeps
  // working for whoever scans it.
  const origin = new URL(request.url).origin

  // Resolving the short id and creating the DB row must happen as one
  // atomic step so two concurrent uploads never pick the same one.
  const record = await withUploadLock(async (): Promise<PdfRecord> => {
    const baseName = sanitizeFileBaseName(file.name)
    const shortId = await resolveUniqueShortId()

    // `addRandomSuffix: true` guarantees a fresh URL on every upload, even
    // when re-uploading a file with the same name right after deleting the
    // old one — without it, the new file would land at the exact same Blob
    // URL, and the CDN (which treats Blob URLs as immutable) would keep
    // serving the deleted file's cached bytes instead of the new content.
    const pdfBlob = await put(`${PDF_PREFIX}${baseName}.pdf`, bytes, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/pdf",
    })

    const qrBuffer = renderStyledQrPng(`${origin}/r/${shortId}`, 512)

    const qrBlob = await put(`${QR_PREFIX}${baseName}.png`, qrBuffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: "image/png",
    })

    return createRecord({
      shortId,
      originalName: file.name,
      pdfPath: pdfBlob.url,
      qrPath: qrBlob.url,
      size: file.size,
    })
  })

  return Response.json(record, { status: 201 })
}
