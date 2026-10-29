import { useEffect, useState } from 'react'

// The app's idea of "now". It is the real time, except in the demo, where it can be moved
// forward so the review window can be shown without waiting days.
let offsetMs = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const clock = {
  now: () => Date.now() + offsetMs,
  get offsetMs() {
    return offsetMs
  },
  set(ms: number) {
    offsetMs = ms
    emit()
  },
  advance(ms: number) {
    offsetMs += ms
    emit()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Current time in ms; re-renders every `intervalMs` and whenever the demo clock is moved. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(clock.now)
  useEffect(() => {
    const update = () => setNow(clock.now())
    const timer = setInterval(update, intervalMs)
    const unsubscribe = clock.subscribe(update)
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [intervalMs])
  return now
}
