/** USDC on Stellar has 7 decimals. */
const SCALE = 10_000_000n

/** A decimal string such as "1840.5" in the smallest unit, or null if it is not a valid amount. */
export function toUnits(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(value)
  if (!match) return null
  const [, whole, fraction = ''] = match
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(7, '0'))
}

/** True when the balance is known and is less than the amount. Anything unreadable is "no". */
export function exceedsBalance(amount: string, balance: string | null): boolean {
  const wanted = toUnits(amount)
  const have = balance === null ? null : toUnits(balance)
  return wanted !== null && have !== null && wanted > have
}
