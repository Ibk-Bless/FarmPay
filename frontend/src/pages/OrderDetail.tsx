import PlannedPage from '../components/PlannedPage'

export default function OrderDetail() {
  return (
    <PlannedPage
      title="Order"
      description="One order's status, deadlines and the actions available to you."
      actions={[
        'See the order status and the time left in the review window',
        'Take the next step for your role: accept, deliver, confirm, dispute, claim or cancel',
        'As the cooperative, resolve a dispute by splitting the funds',
      ]}
    />
  )
}
