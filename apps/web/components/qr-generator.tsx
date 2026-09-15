"use client"

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
  CircleHelpIcon,
  FileWarningIcon,
  LinkIcon,
  MoonIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { PDF } from "@react-symbols/icons/files"
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
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@workspace/ui/components/drawer"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { toast } from "sonner"
import { cn } from "@workspace/ui/lib/utils"

import { FadeArc } from "@/components/fade-arc"
import { useMediaQuery } from "@/hooks/use-media-query"

type PdfRecord = {
  id: string
  shortId: string
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

// A plain CSS/text ellipsis truncates from the end, which on a long file
// name cuts off the ".pdf" extension — the one part that tells you what
// kind of file it is. Truncate the middle of the base name instead, always
// keeping the extension visible.
function truncateFileName(name: string, maxLength = 40): string {
  if (name.length <= maxLength) return name

  const extMatch = name.match(/\.[a-z0-9]+$/i)
  const ext = extMatch ? extMatch[0] : ""
  const base = ext ? name.slice(0, -ext.length) : name

  const keep = maxLength - ext.length - 1
  if (keep <= 0) return `${name.slice(0, maxLength - 1)}…`

  return `${base.slice(0, keep)}…${ext}`
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
    toast.success(`"${truncateFileName(record.originalName, 40)}" se subió`)
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

// Stacked, fading file rows — echoes the app's own Attachment rows so the
// empty state reads as "your files will look like this" rather than a
// generic stock illustration.
function StackedCardsIllustration() {
  return (
    <div className="relative h-24 w-52" aria-hidden="true">
      <div className="absolute inset-x-6 top-0 h-6 rounded-t-lg border border-border/50 bg-muted/60 dark:bg-muted/30" />
      <div className="absolute inset-x-3 top-3 h-6 rounded-t-lg border border-border/60 bg-muted/80 dark:bg-muted/50" />
      <div className="absolute inset-x-0 top-6 flex h-16 items-center gap-3 rounded-lg border border-border bg-card px-4 shadow-sm">
        <div className="size-8 shrink-0 rounded bg-muted" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-2.5 w-3/4 rounded bg-muted" />
          <div className="h-2 w-1/2 rounded bg-muted/60" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-b from-card/0 via-card/60 to-card" />
    </div>
  )
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
    <div className="relative flex size-56 items-center justify-center rounded-[12%] border border-border">
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempt}
          src={attempt === 0 ? src : `${src}?retry=${attempt}`}
          alt={alt}
          width={224}
          height={224}
          className={cn("size-56 object-contain", !loaded && "invisible")}
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
        <div className="absolute inset-0 flex items-center justify-center rounded-[12%] bg-card">
          <Spinner />
        </div>
      ) : null}
    </div>
  )
}

// Shares the record's short link. `navigator.share({ url })` opens the
// OS-native "send to" sheet on devices that support it; elsewhere (desktop
// browsers, or a non-secure origin such as the LAN IP) it falls back to
// copying the link to the clipboard.
async function shareRecordUrl(url: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url })
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
    }
  }

  try {
    await navigator.clipboard.writeText(url)
    toast.success("Enlace copiado al portapapeles")
  } catch {
    toast.error("No se pudo copiar el enlace")
  }
}

// Shares the QR PNG itself (e.g. to forward for someone else to scan).
// Falls back to opening the image in a new tab — from there it can be
// long-pressed/saved — instead of silently doing nothing.
async function shareRecordQrImage(record: PdfRecord) {
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
        await navigator.share({ files: [file], title: record.originalName })
        return
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
    }
  }

  window.open(record.qrPath, "_blank", "noopener,noreferrer")
}

export function QrGenerator() {
  const [records, setRecords] = useState<PdfRecord[]>([])
  const [isLoadingList, setIsLoadingList] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PdfRecord | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  // Bottom sheet on phones, centered dialog from tablet up — matches
  // Tailwind's own `sm` breakpoint so it lines up with the rest of the
  // page's responsive classes.
  const isDesktop = useMediaQuery("(min-width: 640px)")

  const { resolvedTheme, setTheme } = useTheme()
  // The server has no way to know the visitor's theme, so resolvedTheme is
  // undefined until the client mounts — render a neutral icon until then to
  // avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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
      toast(`"${truncateFileName(record.originalName, 40)}" se eliminó`)
    } catch (err) {
      toast.error(
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

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleBulkDelete(ids: string[]) {
    setDeletingIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.add(id))
      return next
    })

    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/pdfs/${id}`, { method: "DELETE" }))
    )

    const deletedIds = ids.filter((_, index) => {
      const result = results[index]
      return result?.status === "fulfilled" && result.value.ok
    })
    const failedCount = ids.length - deletedIds.length

    setRecords((prev) => prev.filter((r) => !deletedIds.includes(r.id)))
    setDeletingIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
    setSelectedIds(new Set())

    if (deletedIds.length > 0) {
      toast(
        deletedIds.length === 1
          ? "1 PDF se eliminó"
          : `${deletedIds.length} PDFs se eliminaron`
      )
    }
    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "No se pudo eliminar 1 PDF."
          : `No se pudieron eliminar ${failedCount} PDFs.`
      )
    }
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col gap-6 overflow-hidden p-4 sm:gap-8 sm:p-6">
      <Card className="shrink-0">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <QrCodeIcon className="size-5" />
            </div>
            <div>
              <CardTitle className="text-xl sm:text-2xl">GeneraQR</CardTitle>
              <CardDescription>
                Solo PDF, hasta 25MB cada uno y puedes elegir varios a la vez.
              </CardDescription>
            </div>
          </div>
          <CardAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="relative"
              aria-label={
                mounted && resolvedTheme === "dark"
                  ? "Cambiar a tema claro"
                  : "Cambiar a tema oscuro"
              }
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              <SunIcon
                className={cn(
                  "size-4 transition-all duration-500",
                  mounted && resolvedTheme === "dark"
                    ? "scale-100 rotate-0 opacity-100"
                    : "scale-0 rotate-90 opacity-0"
                )}
              />
              <MoonIcon
                className={cn(
                  "absolute size-4 transition-all duration-500",
                  mounted && resolvedTheme === "dark"
                    ? "scale-0 -rotate-90 opacity-0"
                    : "scale-100 rotate-0 opacity-100"
                )}
              />
            </Button>
          </CardAction>
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
                <EmptyMedia>
                  <PDF className="size-10" />
                </EmptyMedia>
                <EmptyTitle>Elige tus archivos o arrástralos aquí</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
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

          {pendingUploads.length > 0 ? (
            <ScrollArea className="-mr-3 max-h-[62px] pr-3">
              <div className="flex flex-col gap-4 p-0.5">
                {pendingUploads.map((upload) => {
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
                          <FadeArc className="size-6 text-green-600 dark:text-green-400" />
                        )}
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle title={upload.file.name}>
                          {truncateFileName(upload.file.name)}
                        </AttachmentTitle>
                        <AttachmentDescription>
                          {upload.state.phase === "uploading"
                            ? `${formatSize(upload.state.loaded)} de ${formatSize(upload.state.total)}`
                            : upload.state.message}
                        </AttachmentDescription>
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
              </div>
            </ScrollArea>
          ) : null}
        </CardContent>
      </Card>

      <Card className="min-h-0">
        <CardHeader className="shrink-0">
          {selectedIds.size > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancelar selección"
                  onClick={() => setSelectedIds(new Set())}
                >
                  <XIcon />
                </Button>
                <CardTitle>
                  {selectedIds.size}{" "}
                  {selectedIds.size === 1 ? "seleccionado" : "seleccionados"}
                </CardTitle>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2Icon />
                Eliminar
              </Button>
            </div>
          ) : (
            <CardTitle>PDFs guardados</CardTitle>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
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
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia>
                  <StackedCardsIllustration />
                </EmptyMedia>
                <EmptyTitle>Sin PDFs por ahora</EmptyTitle>
                <EmptyDescription>
                  Los archivos que subas arriba aparecerán aquí.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="-mr-3 min-h-0 flex-1 pr-3">
              <div className="flex flex-col gap-3 p-0.5">
                {records.map((record) => {
                  // Bottom sheet on phones, centered dialog from tablet up —
                  // same content either way, just a different shell.
                  const Root = isDesktop ? Dialog : Drawer
                  const Trigger = isDesktop ? DialogTrigger : DrawerTrigger
                  const Content = isDesktop ? DialogContent : DrawerContent
                  const Header = isDesktop ? DialogHeader : DrawerHeader
                  const Title = isDesktop ? DialogTitle : DrawerTitle
                  const Description = isDesktop
                    ? DialogDescription
                    : DrawerDescription
                  const Footer = isDesktop ? DialogFooter : DrawerFooter
                  const Close = isDesktop ? DialogClose : DrawerClose

                  const isSelected = selectedIds.has(record.id)
                  const isSelectionMode = selectedIds.size > 0

                  return (
                    <Root
                      key={record.id}
                      {...(!isDesktop ? { showSwipeHandle: true } : {})}
                    >
                      <Attachment
                        state="done"
                        className={cn(
                          "w-full",
                          isSelected && "border-primary/50 bg-primary/5"
                        )}
                      >
                        <div className="relative z-20 shrink-0">
                          <AttachmentMedia
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            aria-label={
                              isSelected
                                ? `Deseleccionar ${record.originalName}`
                                : `Seleccionar ${record.originalName}`
                            }
                            className={cn(
                              "cursor-pointer bg-secondary text-secondary-foreground transition-opacity",
                              isSelected && "opacity-50"
                            )}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleSelected(record.id)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault()
                                toggleSelected(record.id)
                              }
                            }}
                          >
                            <PDF className="size-5" />
                          </AttachmentMedia>
                          {isSelected ? (
                            <span className="pointer-events-none absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
                              <CheckIcon className="size-2.5" />
                            </span>
                          ) : null}
                        </div>
                        <AttachmentContent>
                          <AttachmentTitle title={record.originalName}>
                            {truncateFileName(record.originalName)}
                          </AttachmentTitle>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <AttachmentDescription className="flex-1 shrink-0 truncate">
                              {formatSize(record.size)} ·{" "}
                              {formatDate(record.createdAt)}
                            </AttachmentDescription>
                          </div>
                        </AttachmentContent>
                        {!isSelectionMode ? (
                          <AttachmentActions>
                            <AttachmentAction
                              type="button"
                              aria-label={`Eliminar ${record.originalName}`}
                              disabled={deletingIds.has(record.id)}
                              onClick={() => setDeleteTarget(record)}
                            >
                              {deletingIds.has(record.id) ? (
                                <FadeArc />
                              ) : (
                                <XIcon />
                              )}
                            </AttachmentAction>
                          </AttachmentActions>
                        ) : null}
                        {isSelectionMode ? (
                          <button
                            type="button"
                            className="absolute inset-0 z-10 outline-none"
                            aria-label={
                              isSelected
                                ? `Deseleccionar ${record.originalName}`
                                : `Seleccionar ${record.originalName}`
                            }
                            onClick={() => toggleSelected(record.id)}
                          />
                        ) : (
                          <Trigger
                            render={
                              <AttachmentTrigger
                                aria-label={`Ver código QR de ${record.originalName}`}
                              />
                            }
                          />
                        )}
                      </Attachment>
                      <Content
                        className={isDesktop ? undefined : "min-h-[75dvh]"}
                        {...(isDesktop ? { showCloseButton: false } : {})}
                      >
                        <Close
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="absolute top-3 right-3"
                            />
                          }
                        >
                          <XIcon />
                          <span className="sr-only">Cerrar</span>
                        </Close>
                        <Header>
                          <Title
                            title={record.originalName}
                            className="truncate"
                          >
                            {truncateFileName(record.originalName, 30)}
                          </Title>
                          <Description>
                            {formatSize(record.size)} · Subido el{" "}
                            {formatDate(record.createdAt)}
                          </Description>
                        </Header>
                        <div
                          className={cn(
                            "flex flex-col items-center gap-2",
                            isDesktop ? "py-2" : "flex-1 justify-center py-6"
                          )}
                        >
                          <QrImage
                            src={record.qrPath}
                            alt={`Código QR de ${record.originalName}`}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 px-4 pb-4">
                          <span className="text-xs font-medium text-muted-foreground">
                            Enlace
                          </span>
                          <div className="flex items-center gap-1 rounded-lg border border-input bg-muted/40 py-1.5 pr-1.5 pl-3">
                            <span className="flex-1 truncate text-xs text-muted-foreground">
                              {`${window.location.origin}/r/${record.shortId}`}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Compartir enlace"
                              onClick={() =>
                                void shareRecordUrl(
                                  `${window.location.origin}/r/${record.shortId}`,
                                  record.originalName
                                )
                              }
                            >
                              <LinkIcon />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Compartir imagen del QR"
                              onClick={() => void shareRecordQrImage(record)}
                            >
                              <QrCodeIcon />
                            </Button>
                          </div>
                        </div>
                        <Footer className={isDesktop ? undefined : "pb-6"}>
                          <a
                            href={record.pdfPath}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonVariants()}
                          >
                            Abrir PDF
                          </a>
                        </Footer>
                      </Content>
                    </Root>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
        <CardFooter className="shrink-0 justify-end">
          <a
            href="mailto:stevealvaradopaez@gmail.com?subject=Ayuda%20con%20GeneraQR"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <CircleHelpIcon className="size-4" />
            Ayuda
          </a>
        </CardFooter>
      </Card>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="rounded-full bg-destructive/10 dark:bg-destructive/10">
              <CircleAlertIcon className="size-5 text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>¿Eliminar este PDF?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará{" "}
              <span className="font-medium text-foreground">
                &quot;{deleteTarget?.originalName}&quot;
              </span>{" "}
              junto con su código QR de forma permanente. Esta acción no se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void handleDelete(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="rounded-full bg-destructive/10 dark:bg-destructive/10">
              <CircleAlertIcon className="size-5 text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              ¿Eliminar {selectedIds.size}{" "}
              {selectedIds.size === 1 ? "PDF" : "PDFs"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se{" "}
              {selectedIds.size === 1
                ? "eliminará el archivo seleccionado"
                : "eliminarán los archivos seleccionados"}{" "}
              junto con sus códigos QR de forma permanente. Esta acción no se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                void handleBulkDelete(Array.from(selectedIds))
                setBulkDeleteOpen(false)
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
