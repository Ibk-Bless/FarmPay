export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

export function formatUsdc(amount: string): string {
  const [whole, fraction = ''] = amount.split('.')
  const grouped = Number(whole).toLocaleString('en-US')
  return `${grouped}.${fraction.padEnd(2, '0')} USDC`
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** "2d 4h", "3h 12m", "45m" — or null once the time has passed. */
export function timeLeft(unixSeconds: number, now = Date.now()): string | null {
  const seconds = Math.floor(unixSeconds - now / 1000)
  if (seconds <= 0) return null
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.max(1, Math.floor((seconds % 3600) / 60))
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
