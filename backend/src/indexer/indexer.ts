import { EscrowError, type Order } from '../stellar/escrow.js'
import type { OrderIndex } from './orderIndex.js'

/** One page of "something happened to these orders" events. */
export interface EventPage {
  orderIds: bigint[]
  /** Where the next page starts. */
  cursor: string
  latestLedger: number
  /** True when there is nothing newer to read right now. */
  caughtUp: boolean
}

/** What the indexer needs from the chain. `EscrowService` implements it. */
export interface Chain {
  /** The order as it is now, or throws an `EscrowError` with code ORDER_NOT_FOUND. */
  getOrder(id: bigint): Promise<Order>
  /** The newest ledger, and the oldest one the RPC still keeps events for. */
  ledgerRange(): Promise<{ latest: number; oldest: number }>
  orderEvents(from: { ledger: number } | { cursor: string }): Promise<EventPage>
}

export interface IndexerOptions {
  /** Milliseconds between polls. */
  pollMs: number
  /** Replay events from this ledger on the very first run. Normally unnecessary: see below. */
  startLedger?: number
  log?: (message: string) => void
}

const MAX_PAGES_PER_POLL = 100
const MAX_BACKOFF_MS = 60_000
const LEDGER_KEY = 'indexed_ledger'

/**
 * Keeps an `OrderIndex` current with the escrow contract.
 *
 * Events are only a *trigger*: when one says an order changed, the order is read again from the
 * contract, so the index never depends on how an event's payload is encoded, and a duplicate or
 * out-of-order event is harmless.
 *
 * It does not need to read history. On start it re-reads every unfinished order and probes
 * forward for new order ids (they are sequential), so nothing is lost even if the indexer was
 * down for longer than the RPC keeps events.
 */
export class Indexer {
  private cursor: string | undefined
  private resumeLedger = 0
  private pending = new Set<bigint>()
  private initialised = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private failures = 0
  private current: Promise<void> = Promise.resolve()

  /** True once the first full pass has finished, so a client can tell "empty" from "loading". */
  synced = false
  lastError: string | undefined

  constructor(
    private chain: Chain,
    readonly index: OrderIndex,
    private options: IndexerOptions,
  ) {}

  /** Newest ledger the index is known to include. */
  get indexedLedger(): number {
    return Number(this.index.getMeta(LEDGER_KEY) ?? 0)
  }

  /** One pass. Safe to call repeatedly; the background loop and tests both use it. */
  async syncOnce(): Promise<void> {
    if (!this.initialised) await this.initialise()
    await this.pollEvents()
    this.synced = true
  }

  start(): void {
    if (this.running) return
    this.running = true
    const tick = () => {
      this.current = this.syncOnce().then(
        () => {
          this.failures = 0
          this.lastError = undefined
          this.schedule(tick, this.options.pollMs)
        },
        (err: unknown) => {
          this.failures++
          this.lastError = err instanceof Error ? err.message : String(err)
          const wait = Math.min(this.options.pollMs * 2 ** this.failures, MAX_BACKOFF_MS)
          this.options.log?.(`index sync failed (${this.lastError}); retrying in ${Math.round(wait / 1000)}s`)
          this.schedule(tick, wait)
        },
      )
    }
    tick()
  }

  /** Stops polling and waits for a pass in flight, so the database can be closed safely. */
  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    await this.current
  }

  private schedule(tick: () => void, ms: number) {
    if (this.running) this.timer = setTimeout(tick, ms)
  }

  /** Reads the world once: unfinished orders, then any orders created while we were away. */
  private async initialise(): Promise<void> {
    const { latest, oldest } = await this.chain.ledgerRange()
    const saved = this.index.getMeta(LEDGER_KEY)
    // Events are replayed from here. Fixed *before* reading orders, so a change that lands while
    // we read is seen twice (harmless) rather than missed.
    const wanted = saved ? Number(saved) : (this.options.startLedger ?? latest)
    this.resumeLedger = Math.max(oldest, Math.min(wanted, latest))

    for (const id of this.index.openIds()) await this.refresh(BigInt(id))
    // Order ids are sequential, so keep reading the next one until there isn't one.
    let next = this.index.maxId() + 1
    while ((await this.refresh(BigInt(next))) !== 'missing') next++

    if (!saved) this.index.setMeta(LEDGER_KEY, String(this.resumeLedger))
    this.initialised = true
    this.options.log?.(`index ready: ${this.index.count()} orders, following events from ledger ${this.resumeLedger}`)
  }

  private async pollEvents(): Promise<void> {
    // Orders whose refresh failed last time come first, so no change is dropped.
    for (const id of [...this.pending]) {
      await this.refresh(id)
      this.pending.delete(id)
    }

    let latestLedger = this.indexedLedger
    for (let pages = 0; pages < MAX_PAGES_PER_POLL; pages++) {
      const from = this.cursor ? { cursor: this.cursor } : { ledger: this.resumeLedger }
      const page = await this.chain.orderEvents(from)
      this.cursor = page.cursor
      latestLedger = page.latestLedger
      for (const id of page.orderIds) this.pending.add(id)

      for (const id of [...this.pending]) {
        await this.refresh(id)
        this.pending.delete(id)
      }
      if (page.caughtUp) break
    }
    this.index.setMeta(LEDGER_KEY, String(latestLedger))
  }

  /**
   * Re-reads one order into the index.
   *  - `found`: stored.
   *  - `missing`: no such order (the end of the sequence).
   *  - `skipped`: the contract refuses to read it for a lasting reason, for example its storage
   *    expired on the network. Logged and left alone, so one bad order cannot block the rest.
   * Network trouble throws, and the order is retried on the next pass.
   */
  private async refresh(id: bigint): Promise<'found' | 'missing' | 'skipped'> {
    try {
      this.index.upsert(await this.chain.getOrder(id))
      return 'found'
    } catch (err) {
      if (err instanceof EscrowError && err.code === 'ORDER_NOT_FOUND') return 'missing'
      if (err instanceof EscrowError && err.code !== 'RPC_UNAVAILABLE') {
        this.options.log?.(`skipping order ${id}: ${err.code}`)
        return 'skipped'
      }
      // Network trouble: rethrow. The id is still in `pending` (it is only removed after a
      // successful read), so the next pass retries it.
      throw err
    }
  }
}
