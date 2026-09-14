// Fixed, full-viewport backdrop: a square grid of thin lines with a small
// dot at every intersection — themed via `currentColor`, so it automatically
// follows light/dark mode like the rest of the app. Purely decorative
// (`aria-hidden`), sits behind everything else (`-z-10`) and never
// intercepts pointer events.
const CELL = 80

export function DotGridBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <div
        className="absolute inset-0 text-foreground/10"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px),
            radial-gradient(circle, currentColor 2px, transparent 2px)
          `,
          backgroundSize: `${CELL}px ${CELL}px`,
          // A bare radial-gradient centers its circle in the middle of its
          // own tile, not at the tile's corner — shifting just that layer by
          // half a cell lines its dot back up with the line intersections.
          // The extra 0.5px accounts for the 1px line stroke itself being
          // centered on the grid point, not starting from it.
          backgroundPosition: `0 0, 0 0, ${-CELL / 2 + 0.5}px ${-CELL / 2 + 0.5}px`,
        }}
      />
    </div>
  )
}
