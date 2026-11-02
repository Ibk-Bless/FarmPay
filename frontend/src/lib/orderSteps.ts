import type { ListedOrder, OrderAction, OrderRole } from './api'

/** What an order means for one account right now. Mirrors the rules on the order page. */
export interface Step {
  /** One sentence about where the order stands for this account. */
  text: string
  /** The account has something to do. */
  needsAction: boolean
  /** A one-click action that needs no extra input. Anything else is done on the order page. */
  action?: { type: OrderAction; label: string }
  /** The deadline that matters (Unix seconds), shown as time left and used to sort. */
  until?: number
  /** What the deadline is for, e.g. "to review". */
  untilLabel?: string
}

export type Section = 'action' | 'waiting' | 'done'

const SETTLE: Step = {
  text: 'The cooperative did not rule in time: settle with an even split',
  needsAction: true,
  action: { type: 'expire', label: 'Settle by default' },
}

export function summarize(order: ListedOrder, role: OrderRole, nowSeconds: number): Step {
  switch (order.status) {
    case 'Funded':
      return role === 'farmer'
        ? { text: 'Accept this order to start', needsAction: true, action: { type: 'accept', label: 'Accept order' } }
        : { text: 'Waiting for the farmer to accept', needsAction: false }

    case 'Accepted': {
      const late = nowSeconds > order.deliveryDeadline
      if (role === 'farmer') {
        return {
          text: late ? 'Past the delivery deadline: deliver now, or the buyer may cancel' : 'Deliver, then mark the order delivered',
          needsAction: true,
          action: { type: 'deliver', label: 'Mark as delivered' },
          ...(!late && { until: order.deliveryDeadline, untilLabel: 'to deliver' }),
        }
      }
      if (role === 'buyer' && late) {
        return { text: 'Past the delivery deadline: you can cancel for a full refund', needsAction: true }
      }
      return {
        text: 'Waiting for delivery',
        needsAction: false,
        ...(!late && { until: order.deliveryDeadline, untilLabel: 'to deliver' }),
      }
    }

    case 'Delivered': {
      const open = nowSeconds <= order.reviewDeadline
      if (role === 'buyer') {
        return open
          ? {
              text: 'Confirm the delivery, or open a dispute',
              needsAction: true,
              action: { type: 'confirm', label: 'Confirm delivery' },
              until: order.reviewDeadline,
              untilLabel: 'to review',
            }
          : { text: 'Review window ended: the farmer can claim payment', needsAction: false }
      }
      if (role === 'farmer' && !open) {
        return { text: 'Review window ended: claim your payment', needsAction: true, action: { type: 'claim', label: 'Claim payment' } }
      }
      return {
        text: role === 'farmer' ? 'Delivered: waiting for the buyer to confirm' : 'Delivered: in review',
        needsAction: false,
        ...(open && { until: order.reviewDeadline, untilLabel: 'review window' }),
      }
    }

    case 'Disputed': {
      const open = nowSeconds <= order.disputeDeadline
      if (!open) return SETTLE
      return role === 'arbiter'
        ? { text: 'Rule on this dispute', needsAction: true, until: order.disputeDeadline, untilLabel: 'to rule' }
        : { text: 'Waiting for the cooperative to rule', needsAction: false, until: order.disputeDeadline, untilLabel: 'for the cooperative' }
    }

    case 'Released':
      return { text: role === 'farmer' ? 'Paid in full' : 'Complete: the farmer was paid', needsAction: false }
    case 'Refunded':
      return { text: 'Cancelled: the buyer was refunded', needsAction: false }
    case 'Resolved':
      return { text: 'Dispute settled between farmer and buyer', needsAction: false }
  }
}

export function sectionOf(order: ListedOrder, step: Step): Section {
  if (step.needsAction) return 'action'
  return ['Released', 'Refunded', 'Resolved'].includes(order.status) ? 'done' : 'waiting'
}

/** The order as it will be once a one-click action goes through, so the list can show it at once. */
export function applyAction(order: ListedOrder, action: OrderAction, nowSeconds: number): ListedOrder {
  switch (action) {
    case 'accept':
      return { ...order, status: 'Accepted' }
    case 'deliver':
      return { ...order, status: 'Delivered', reviewDeadline: nowSeconds + order.reviewWindow }
    case 'confirm':
    case 'claim':
      return { ...order, status: 'Released' }
    case 'expire':
      return { ...order, status: 'Resolved' }
    default:
      return order
  }
}
