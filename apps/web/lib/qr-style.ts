import { Resvg } from "@resvg/resvg-js"
import QRCode from "qrcode"

// Quiet zone width, in modules, around the symbol.
const MARGIN = 2

// Corner radius of a module, as a fraction of its 1x1 cell.
const CORNER_RADIUS = 0.5

function isFinderModule(row: number, col: number, size: number): boolean {
  const inTopLeft = row < 7 && col < 7
  const inTopRight = row < 7 && col >= size - 7
  const inBottomLeft = row >= size - 7 && col < 7
  return inTopLeft || inTopRight || inBottomLeft
}

type Corners = { tl: boolean; tr: boolean; br: boolean; bl: boolean }

// Path for one module's 1x1 cell, rounding only the corners flagged `true`
// in `corners`. A corner is left square (not rounded) when a same-color
// orthogonal neighbor continues through it, so a run of adjacent modules
// draws as one seamless blob instead of a chain of separate rounded
// squares — the fluid look of most modern styled QR codes.
function moduleClockwisePath(x: number, y: number, s: number, corners: Corners): string {
  const rtl = corners.tl ? CORNER_RADIUS : 0
  const rtr = corners.tr ? CORNER_RADIUS : 0
  const rbr = corners.br ? CORNER_RADIUS : 0
  const rbl = corners.bl ? CORNER_RADIUS : 0

  const p = [`M ${x + rtl} ${y}`, `L ${x + s - rtr} ${y}`]
  if (rtr) p.push(`A ${rtr} ${rtr} 0 0 1 ${x + s} ${y + rtr}`)
  p.push(`L ${x + s} ${y + s - rbr}`)
  if (rbr) p.push(`A ${rbr} ${rbr} 0 0 1 ${x + s - rbr} ${y + s}`)
  p.push(`L ${x + rbl} ${y + s}`)
  if (rbl) p.push(`A ${rbl} ${rbl} 0 0 1 ${x} ${y + s - rbl}`)
  p.push(`L ${x} ${y + rtl}`)
  if (rtl) p.push(`A ${rtl} ${rtl} 0 0 1 ${x + rtl} ${y}`)
  p.push("Z")
  return p.join(" ")
}

// Renders the symbol with merged, rounded-corner blobs for the data
// modules, and rounded "eye" shapes for the 3 finder patterns — the softer,
// denser look used by most modern QR designs, instead of the default
// hard-edged grid.
function buildQrSvg(data: string): string {
  // "M" (not "H") keeps the module count as low as the data allows, while
  // still giving the rounded rendering enough error tolerance to stay
  // scannable.
  const qr = QRCode.create(data, { errorCorrectionLevel: "M" })
  const { size } = qr.modules
  // BitMatrix#get reads `this.data`/`this.size` internally, so it must stay
  // bound to `qr.modules` — destructuring it directly loses `this`.
  const get = qr.modules.get.bind(qr.modules)
  const total = size + MARGIN * 2

  const isDark = (row: number, col: number): boolean => {
    if (row < 0 || col < 0 || row >= size || col >= size) return false
    if (isFinderModule(row, col, size)) return false
    return !!get(row, col)
  }

  const modulePaths: string[] = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue
      const top = isDark(row - 1, col)
      const bottom = isDark(row + 1, col)
      const left = isDark(row, col - 1)
      const right = isDark(row, col + 1)
      const corners: Corners = {
        tl: !(top || left),
        tr: !(top || right),
        br: !(bottom || right),
        bl: !(bottom || left),
      }
      modulePaths.push(
        moduleClockwisePath(col + MARGIN, row + MARGIN, 1, corners)
      )
    }
  }

  const eyes: string[] = []
  const eyeOrigins: Array<[number, number]> = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]
  for (const [row, col] of eyeOrigins) {
    const x = col + MARGIN
    const y = row + MARGIN
    eyes.push(
      `<rect x="${x}" y="${y}" width="7" height="7" rx="2.2" ry="2.2"/>`,
      `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1.6" ry="1.6" fill="#fff"/>`,
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1" ry="1"/>`
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}">
<rect width="${total}" height="${total}" rx="4" ry="4" fill="#fff"/>
<g fill="#000">
${eyes.join("\n")}
<path d="${modulePaths.join(" ")}"/>
</g>
</svg>`
}

export function renderStyledQrPng(data: string, width = 512): Buffer {
  const svg = buildQrSvg(data)
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } })
  return resvg.render().asPng()
}
