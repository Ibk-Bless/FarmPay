import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Order, OrderStatus } from '../stellar/escrow.js'

export type Role = 'buyer' | 'farmer' | 'arbiter'
export type IndexedOrder = Order & { role: Role }

/** Orders in these states can never change again, so they never need re-reading. */
const TERMINAL: OrderStatus[] = ['Released', 'Refunded', 'Resolved']

/**
 * A local, rebuildable copy of every order, so "which orders am I part of?" doesn't need a
 * chain scan. The contract stays the source of truth: delete the database and the indexer
 * rebuilds it. Uses Node's built-in SQLite, so there is no native module to install.
 */
export class OrderIndex {
  private db: DatabaseSync

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS orders (
        id      INTEGER PRIMARY KEY,
        buyer   TEXT NOT NULL,
        farmer  TEXT NOT NULL,
        arbiter TEXT NOT NULL,
        status  TEXT NOT NULL,
        json    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS orders_buyer   ON orders (buyer);
      CREATE INDEX IF NOT EXISTS orders_farmer  ON orders (farmer);
      CREATE INDEX IF NOT EXISTS orders_arbiter ON orders (arbiter);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
  }

  /** Inserts the order, or replaces it with its newer state. */
  upsert(order: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders (id, buyer, farmer, arbiter, status, json) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET status = excluded.status, json = excluded.json`,
      )
      .run(Number(order.id), order.buyer, order.farmer, order.arbiter, order.status, JSON.stringify(order))
  }

  get(id: number): Order | undefined {
    const row = this.db.prepare('SELECT json FROM orders WHERE id = ?').get(id) as { json: string } | undefined
    return row && (JSON.parse(row.json) as Order)
  }

  /** Highest order id seen, or 0 when empty. Order ids are sequential from 1. */
  maxId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM orders').get() as { id: number | null }
    return row.id ?? 0
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n
  }

  /** Ids of orders that can still change. */
  openIds(): number[] {
    const marks = TERMINAL.map(() => '?').join(',')
    const rows = this.db.prepare(`SELECT id FROM orders WHERE status NOT IN (${marks}) ORDER BY id`).all(...TERMINAL)
    return (rows as { id: number }[]).map((r) => r.id)
  }

  /** Orders the account takes part in, newest first, each tagged with the account's role. */
  ordersFor(party: string, limit: number): IndexedOrder[] {
    const rows = this.db
      .prepare('SELECT json FROM orders WHERE buyer = ?1 OR farmer = ?1 OR arbiter = ?1 ORDER BY id DESC LIMIT ?2')
      .all(party, limit) as { json: string }[]
    return rows.map(({ json }) => {
      const order = JSON.parse(json) as Order
      const role: Role = order.buyer === party ? 'buyer' : order.farmer === party ? 'farmer' : 'arbiter'
      return { ...order, role }
    })
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  close(): void {
    this.db.close()
  }
}
