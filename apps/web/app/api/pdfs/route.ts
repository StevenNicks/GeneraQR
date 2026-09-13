import { put } from "@vercel/blob"
import QRCode from "qrcode"

import {
  PDF_PREFIX,
  QR_PREFIX,
  type PdfRecord,
  createRecord,
  readManifest,
  resolveUniqueBaseName,
  sanitizeFileBaseName,
  withUploadLock,
} from "@/lib/pdf-store"

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

  // Resolving a free filename and writing both files must happen as one
  // atomic step so two concurrent uploads with the same name never collide.
  const record = await withUploadLock(async (): Promise<PdfRecord> => {
    const baseName = await resolveUniqueBaseName(
      sanitizeFileBaseName(file.name)
    )

    const pdfBlob = await put(`${PDF_PREFIX}${baseName}.pdf`, bytes, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/pdf",
    })

    const qrBuffer = await QRCode.toBuffer(pdfBlob.url, {
      width: 512,
      margin: 1,
    })

    const qrBlob = await put(`${QR_PREFIX}${baseName}.png`, qrBuffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/png",
    })

    return createRecord({
      originalName: file.name,
      pdfPath: pdfBlob.url,
      qrPath: qrBlob.url,
      size: file.size,
    })
  })

  return Response.json(record, { status: 201 })
}
