import { useEffect, useState } from "react"

// SSR-safe: starts `false` (matches nothing) until the effect runs on the
// client, then tracks the query live via the native change event instead of
// polling or re-checking on every render.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query)
    setMatches(mediaQueryList.matches)

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    mediaQueryList.addEventListener("change", onChange)
    return () => mediaQueryList.removeEventListener("change", onChange)
  }, [query])

  return matches
}
