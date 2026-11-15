import { useEffect, useRef } from 'react'

/**
 * Calls `tick` every `intervalMs` while `active` and the tab is visible. Hiding the tab stops it;
 * showing the tab calls `tick` at once (the page may have been away for a while) and restarts it.
 * The latest `tick` is always used, so callers need not memoise it.
 */
export function usePolling(tick: () => void, intervalMs: number, active: boolean) {
  const latest = useRef(tick)
  latest.current = tick

  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer === undefined) timer = setInterval(() => latest.current(), intervalMs)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        latest.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [active, intervalMs])
}
