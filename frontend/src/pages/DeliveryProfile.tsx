import PlannedPage from '../components/PlannedPage'

export default function DeliveryProfile() {
  return (
    <PlannedPage
      title="Delivery History"
      description="A farmer's completed orders, read from the escrow contract."
      actions={[
        'See every released and resolved order for this farmer',
        'Share a link with new buyers as verifiable proof of delivery',
      ]}
    />
  )
}
