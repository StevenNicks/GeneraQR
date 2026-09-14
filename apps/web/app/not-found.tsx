import { ArrowLeftIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@workspace/ui/components/button"

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6 text-center">
      {/* A translucent text-foreground/15 let the fixed grid background show
          through the glyph strokes. A flat, non-alpha gray keeps the same
          light tone while staying fully opaque. */}
      <p className="text-8xl font-bold tracking-tighter text-[oklch(0.87_0_0)] sm:text-9xl dark:text-[oklch(0.32_0_0)]">
        404
      </p>

      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Página no encontrada
      </h1>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
        La página que buscas no existe o fue movida. Es posible que el enlace
        esté roto o que la dirección se haya escrito mal.
      </p>

      <Button
        size="lg"
        className="mt-8"
        nativeButton={false}
        render={<Link href="/" />}
      >
        <ArrowLeftIcon className="size-4" />
        Volver al inicio
      </Button>
    </main>
  )
}
