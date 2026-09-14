"use client"

import Image from "next/image"
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import {
  CheckIcon,
  CircleAlertIcon,
  CloudUploadIcon,
  CopyIcon,
  FileTextIcon,
  FileWarningIcon,
  ImageIcon,
  LinkIcon,
  MailIcon,
  MessageCircleIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SendIcon,
  XIcon,
} from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@workspace/ui/components/attachment"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "@workspace/ui/components/toast"
import { cn } from "@workspace/ui/lib/utils"

import { FadeArc } from "@/components/fade-arc"

type PdfRecord = {
  id: string
  originalName: string
  pdfPath: string
  qrPath: string
  size: number
  createdAt: string
}

type PendingUploadState =
  | { phase: "uploading"; loaded: number; total: number }
  | { phase: "error"; message: string; canRetry: boolean }

type PendingUpload = {
  id: string
  file: File
  controller: AbortController | null
  state: PendingUploadState
}

// Same soft-tint green as the "Completado" badge (literal green, not the
// theme's --primary token) so every accented icon/button in this page reads
// as one consistent color, mirroring the button's own built-in
// "destructive" variant shape (bg-color/10 + text-color, no solid fill).
const SOFT_GREEN_ICON_CLASS =
  "bg-green-600/10 text-green-600 dark:bg-green-400/10 dark:text-green-400"

const SOFT_GREEN_BUTTON_CLASS =
  "border-transparent bg-green-600/10 text-green-600 hover:bg-green-600/20 focus-visible:border-green-600/40 focus-visible:ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:hover:bg-green-400/20 dark:focus-visible:ring-green-400/40"

// Fallback "send to" targets shown when the native share sheet
// (navigator.share) isn't available — e.g. desktop browsers, or any
// non-secure origin such as the LAN IP used to scan QRs from a phone.
const SHARE_APPS: {
  label: string
  icon: typeof MessageCircleIcon
  getHref: (url: string, title: string) => string
}[] = [
  {
    label: "WhatsApp",
    icon: MessageCircleIcon,
    getHref: (url, title) =>
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    label: "Telegram",
    icon: SendIcon,
    getHref: (url, title) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    label: "Correo",
    icon: MailIcon,
    getHref: (url, title) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
  },
]

const MAX_SIZE_BYTES = 25 * 1024 * 1024
// Uploads on a fast local network finish almost instantly, which makes the
// progress animation barely visible. Stretch every upload to at least this
// long (real progress is never held back beyond it) so it reads clearly.
const MIN_VISIBLE_UPLOAD_MS = 1500

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function generateId() {
  // crypto.randomUUID is only exposed in secure contexts (HTTPS/localhost),
  // so it's unavailable when the app is opened over HTTP via the LAN IP.
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function validateFile(file: File): { message: string } | null {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  if (!isPdf) {
    return { message: "El archivo debe ser un PDF." }
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { message: "El PDF supera el tamaño máximo permitido (25MB)." }
  }
  return null
}

function uploadPdf(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<PdfRecord> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append("file", file)

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded, event.total)
      }
    })

    xhr.addEventListener("load", () => {
      let data: unknown
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        reject(new Error("Respuesta inválida del servidor."))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as PdfRecord)
      } else {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : "No se pudo generar el código QR."
        reject(new Error(message))
      }
    })

    xhr.addEventListener("error", () =>
      reject(new Error("Error de red al subir el archivo."))
    )
    xhr.addEventListener("abort", () =>
      reject(new DOMException("Upload aborted", "AbortError"))
    )

    signal.addEventListener("abort", () => xhr.abort())

    xhr.open("POST", "/api/pdfs")
    xhr.send(formData)
  })
}

async function runUpload(
  id: string,
  file: File,
  controller: AbortController,
  setPendingUploads: Dispatch<SetStateAction<PendingUpload[]>>,
  setRecords: Dispatch<SetStateAction<PdfRecord[]>>
) {
  const startedAt = Date.now()
  let realLoaded = 0
  let realTotal = file.size

  function setUploading(loaded: number, total: number) {
    setPendingUploads((prev) =>
      prev.map((upload) =>
        upload.id === id
          ? { ...upload, state: { phase: "uploading", loaded, total } }
          : upload
      )
    )
  }

  const ticker = setInterval(() => {
    const elapsed = Date.now() - startedAt
    const realPct = realTotal > 0 ? (realLoaded / realTotal) * 100 : 0
    const timeCapPct = Math.min(100, (elapsed / MIN_VISIBLE_UPLOAD_MS) * 100)
    const displayPct =
      elapsed < MIN_VISIBLE_UPLOAD_MS ? Math.min(realPct, timeCapPct) : realPct
    setUploading(Math.round((displayPct / 100) * realTotal), realTotal)
  }, 100)

  try {
    const record = await uploadPdf(
      file,
      (loaded, total) => {
        realLoaded = loaded
        realTotal = total
      },
      controller.signal
    )

    const elapsed = Date.now() - startedAt
    if (elapsed < MIN_VISIBLE_UPLOAD_MS) {
      await sleep(MIN_VISIBLE_UPLOAD_MS - elapsed)
    }

    clearInterval(ticker)
    setRecords((prev) => [record, ...prev])
    setPendingUploads((prev) => prev.filter((upload) => upload.id !== id))
  } catch (err) {
    clearInterval(ticker)
    if (err instanceof DOMException && err.name === "AbortError") {
      setPendingUploads((prev) => prev.filter((upload) => upload.id !== id))
      return
    }
    setPendingUploads((prev) =>
      prev.map((upload) =>
        upload.id === id
          ? {
              ...upload,
              controller: null,
              state: {
                phase: "error",
                message:
                  err instanceof Error
                    ? err.message
                    : "Ocurrió un error inesperado.",
                canRetry: true,
              },
            }
          : upload
      )
    )
  }
}

type ShareTarget = {
  kind: "link" | "image"
  url: string
  title: string
}

const QR_IMAGE_RETRY_DELAYS_MS = [500, 1000, 2000, 3000]

// Right after upload, the QR PNG can take a moment to become fetchable from
// Vercel Blob's CDN. A plain <img> has no retry, so opening the dialog
// immediately can show a broken image until the dialog is closed and
// reopened (which remounts the element). Retry with backoff instead, and
// show a spinner while waiting.
function QrImage({ src, alt }: { src: string; alt: string }) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setAttempt(0)
    setLoaded(false)
    setFailed(false)
  }, [src])

  return (
    <div className="relative flex size-56 items-center justify-center rounded-lg border border-border">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempt}
          src={attempt === 0 ? src : `${src}?retry=${attempt}`}
          alt={alt}
          width={224}
          height={224}
          className={cn(
            "size-56 rounded-lg object-contain",
            !loaded && "invisible"
          )}
          onLoad={() => setLoaded(true)}
          onError={() => {
            if (attempt < QR_IMAGE_RETRY_DELAYS_MS.length) {
              setTimeout(
                () => setAttempt((prev) => prev + 1),
                QR_IMAGE_RETRY_DELAYS_MS[attempt]
              )
            } else {
              setFailed(true)
            }
          }}
        />
      ) : (
        <span className="px-4 text-center text-xs text-muted-foreground">
          No se pudo cargar el código QR. Cierra y vuelve a abrir para
          reintentar.
        </span>
      )}
      {!failed && !loaded ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-card">
          <Spinner />
        </div>
      ) : null}
    </div>
  )
}

// Shares the PDF's own view URL — the same destination the QR encodes.
// `navigator.share({ url })` opens the OS-native "send to" sheet. Where that
// isn't available (desktop browsers, or any non-secure origin such as the
// LAN IP), `onFallback` opens our own share sheet instead of silently
// copying or downloading.
async function sharePdfLink(record: PdfRecord, onFallback: (target: ShareTarget) => void) {
  const url = new URL(record.pdfPath, window.location.origin).toString()

  if (navigator.share) {
    try {
      await navigator.share({
        title: record.originalName,
        text: `Código QR de ${record.originalName}`,
        url,
      })
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
    }
  }

  onFallback({ kind: "link", url, title: record.originalName })
}

// Shares the QR PNG itself (e.g. to forward for someone else to scan). Falls
// back to our own share sheet (pointed at the image URL) instead of
// triggering a download when native file-sharing isn't supported.
async function shareQrImage(record: PdfRecord, onFallback: (target: ShareTarget) => void) {
  const url = new URL(record.qrPath, window.location.origin).toString()

  if (navigator.share) {
    try {
      const response = await fetch(record.qrPath)
      const blob = await response.blob()
      const file = new File(
        [blob],
        `qr-${record.originalName.replace(/\.pdf$/i, "")}.png`,
        { type: blob.type || "image/png" }
      )

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: record.originalName,
          text: `Código QR de ${record.originalName}`,
        })
        return
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
    }
  }

  onFallback({ kind: "image", url, title: record.originalName })
}

export function QrGenerator() {
  const [records, setRecords] = useState<PdfRecord[]>([])
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingUploadsRef = useRef<PendingUpload[]>([])

  useEffect(() => {
    fetch("/api/pdfs")
      .then((res) => res.json())
      .then((data: PdfRecord[]) => setRecords(data))
      .catch(() =>
        setListError("No se pudo cargar la lista de PDFs guardados.")
      )
      .finally(() => setIsLoadingList(false))
  }, [])

  useEffect(() => {
    pendingUploadsRef.current = pendingUploads
  }, [pendingUploads])

  useEffect(() => {
    return () => {
      pendingUploadsRef.current.forEach((upload) => upload.controller?.abort())
    }
  }, [])

  function addPendingUpload(file: File) {
    const id = generateId()
    const validation = validateFile(file)

    if (validation) {
      setPendingUploads((prev) => [
        ...prev,
        {
          id,
          file,
          controller: null,
          state: {
            phase: "error",
            message: validation.message,
            canRetry: false,
          },
        },
      ])
      return
    }

    const controller = new AbortController()
    setPendingUploads((prev) => [
      ...prev,
      {
        id,
        file,
        controller,
        state: { phase: "uploading", loaded: 0, total: file.size },
      },
    ])
    void runUpload(id, file, controller, setPendingUploads, setRecords)
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return
    }
    Array.from(fileList).forEach(addPendingUpload)
  }

  function retryUpload(upload: PendingUpload) {
    const controller = new AbortController()
    setPendingUploads((prev) =>
      prev.map((item) =>
        item.id === upload.id
          ? {
              ...item,
              controller,
              state: { phase: "uploading", loaded: 0, total: upload.file.size },
            }
          : item
      )
    )
    void runUpload(
      upload.id,
      upload.file,
      controller,
      setPendingUploads,
      setRecords
    )
  }

  function removePendingUpload(upload: PendingUpload) {
    upload.controller?.abort()
    setPendingUploads((prev) => prev.filter((item) => item.id !== upload.id))
  }

  async function handleDelete(record: PdfRecord) {
    setDeletingIds((prev) => new Set(prev).add(record.id))
    try {
      const res = await fetch(`/api/pdfs/${record.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "No se pudo eliminar el PDF.")
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id))
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "No se pudo eliminar el PDF."
      )
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(record.id)
        return next
      })
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:gap-8 sm:p-6">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            SOFT_GREEN_ICON_CLASS
          )}
        >
          <QrCodeIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">GeneraQR</h1>
          <p className="text-sm text-muted-foreground">
            Sube uno o varios PDF para generar sus códigos QR. Los archivos
            quedan guardados en el proyecto, así nunca se pierden.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Subir PDF</CardTitle>
          <CardDescription>
            Solo se aceptan archivos .pdf (máximo 25MB cada uno). Puedes
            seleccionar varios a la vez.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setIsDraggingOver(true)
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDraggingOver(false)
              handleFilesSelected(event.dataTransfer.files)
            }}
          >
            <Empty
              className={cn(
                "border border-dashed transition-colors",
                isDraggingOver &&
                  "border-green-600 bg-green-600/5 dark:border-green-400 dark:bg-green-400/5"
              )}
            >
              <EmptyHeader>
                <EmptyMedia variant="icon" className={SOFT_GREEN_ICON_CLASS}>
                  <CloudUploadIcon />
                </EmptyMedia>
                <EmptyTitle>Elige tus archivos o arrástralos aquí</EmptyTitle>
                <EmptyDescription>
                  Formato PDF, hasta 25MB cada uno.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  className={SOFT_GREEN_BUTTON_CLASS}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Buscar archivos
                </Button>
              </EmptyContent>
            </Empty>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                handleFilesSelected(event.target.files)
                event.target.value = ""
              }}
            />
          </div>

          {pendingUploads.map((upload) => {
            const pct =
              upload.state.phase === "uploading" && upload.state.total > 0
                ? Math.round((upload.state.loaded / upload.state.total) * 100)
                : null

            return (
              <Attachment
                key={upload.id}
                state={upload.state.phase}
                className="w-full"
              >
                <AttachmentMedia
                  className={
                    upload.state.phase === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-secondary text-secondary-foreground"
                  }
                >
                  {upload.state.phase === "error" ? (
                    <FileWarningIcon />
                  ) : (
                    <FileTextIcon />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{upload.file.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {upload.state.phase === "uploading" ? (
                      <>
                        {formatSize(upload.state.loaded)} de{" "}
                        {formatSize(upload.state.total)}
                        {" · "}
                        <span className="inline-flex items-center gap-1 align-middle">
                          <FadeArc className="size-3" />
                          Subiendo...
                        </span>
                      </>
                    ) : (
                      upload.state.message
                    )}
                  </AttachmentDescription>
                  {upload.state.phase === "uploading" ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Progress value={pct} className="flex-1" />
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {pct ?? 0}%
                      </span>
                    </div>
                  ) : null}
                </AttachmentContent>
                <AttachmentActions>
                  {upload.state.phase === "uploading" ? (
                    <AttachmentAction
                      type="button"
                      aria-label={`Cancelar subida de ${upload.file.name}`}
                      onClick={() => upload.controller?.abort()}
                    >
                      <XIcon />
                    </AttachmentAction>
                  ) : (
                    <>
                      {upload.state.canRetry ? (
                        <AttachmentAction
                          type="button"
                          aria-label={`Reintentar subida de ${upload.file.name}`}
                          onClick={() => retryUpload(upload)}
                        >
                          <RefreshCwIcon />
                        </AttachmentAction>
                      ) : null}
                      <AttachmentAction
                        type="button"
                        aria-label={`Quitar ${upload.file.name}`}
                        onClick={() => removePendingUpload(upload)}
                      >
                        <XIcon />
                      </AttachmentAction>
                    </>
                  )}
                </AttachmentActions>
              </Attachment>
            )
          })}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">PDFs guardados</h2>

        {listError ? (
          <Alert variant="destructive">
            <AlertTitle>Ocurrió un problema</AlertTitle>
            <AlertDescription>{listError}</AlertDescription>
          </Alert>
        ) : isLoadingList ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <Image
              src="/illustrations/empty-cabinet.png"
              alt=""
              width={1254}
              height={1254}
              className="h-auto w-56 dark:invert"
              priority
            />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Sin PDFs por ahora</p>
              <p className="text-sm text-muted-foreground">
                Los archivos que subas arriba aparecerán aquí.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {records.map((record) => (
              <Dialog key={record.id}>
                <Attachment state="done" className="w-full">
                  <AttachmentMedia className={SOFT_GREEN_ICON_CLASS}>
                    <QrCodeIcon />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle title={record.originalName}>
                      {record.originalName}
                    </AttachmentTitle>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <AttachmentDescription className="flex-1 truncate shrink-0">
                        {formatSize(record.size)} ·{" "}
                        {formatDate(record.createdAt)}
                      </AttachmentDescription>
                    </div>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <AttachmentAction
                            aria-label={`Eliminar ${record.originalName}`}
                            disabled={deletingIds.has(record.id)}
                            variant="destructive"
                            size="icon-xs"
                            className="rounded-full"
                          />
                        }
                      >
                        {deletingIds.has(record.id) ? (
                          <FadeArc />
                        ) : (
                          <XIcon />
                        )}
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogMedia className="rounded-full bg-destructive/10 dark:bg-destructive/10">
                            <CircleAlertIcon className="size-5 text-destructive" />
                          </AlertDialogMedia>
                          <AlertDialogTitle>
                            ¿Eliminar este PDF?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Se eliminará{" "}
                            <span className="font-medium text-foreground">
                              &quot;{record.originalName}&quot;
                            </span>{" "}
                            junto con su código QR de forma permanente. Esta
                            acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void handleDelete(record)}
                          >
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </AttachmentActions>
                  <DialogTrigger
                    render={
                      <AttachmentTrigger
                        aria-label={`Ver código QR de ${record.originalName}`}
                      />
                    }
                  />
                </Attachment>
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>{record.originalName}</DialogTitle>
                    <DialogDescription>
                      {formatSize(record.size)} · Subido el{" "}
                      {formatDate(record.createdAt)}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-center py-2">
                    <QrImage
                      src={record.qrPath}
                      alt={`Código QR de ${record.originalName}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void shareQrImage(record, setShareTarget)}
                  >
                    <ImageIcon />
                    Compartir imagen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void sharePdfLink(record, setShareTarget)}
                  >
                    <LinkIcon />
                    Compartir enlace
                  </Button>
                  <DialogFooter className="flex-wrap">
                    <a
                      href={record.pdfPath}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(buttonVariants(), SOFT_GREEN_BUTTON_CLASS)}
                    >
                      Abrir PDF
                    </a>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={shareTarget !== null}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>
              Compartir {shareTarget?.kind === "image" ? "imagen" : "enlace"}
            </DialogTitle>
            <DialogDescription>{shareTarget?.title}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2">
            {SHARE_APPS.map((app) => (
              <button
                key={app.label}
                type="button"
                className="flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => {
                  if (!shareTarget) return
                  window.open(
                    app.getHref(shareTarget.url, shareTarget.title),
                    "_blank",
                    "noopener,noreferrer"
                  )
                  setShareTarget(null)
                }}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-muted [&_svg]:size-5">
                  <app.icon />
                </span>
                {app.label}
              </button>
            ))}
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={async () => {
                if (!shareTarget) return
                try {
                  await navigator.clipboard.writeText(shareTarget.url)
                  toast.add({
                    title: "Enlace copiado al portapapeles",
                    type: "success",
                  })
                } catch {
                  toast.add({
                    title: "No se pudo copiar el enlace",
                    type: "error",
                  })
                }
                setShareTarget(null)
              }}
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-muted [&_svg]:size-5">
                <CopyIcon />
              </span>
              Copiar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
