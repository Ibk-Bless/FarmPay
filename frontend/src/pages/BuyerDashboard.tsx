import PlannedPage from '../components/PlannedPage'

export default function BuyerDashboard() {
  return (
    <PlannedPage
      title="Buyer Dashboard"
      description="All your orders and what each one is waiting on."
      actions={[
        'See funded, accepted, delivered and disputed orders',
        'Confirm deliveries or open a dispute before the review window closes',
        'Cancel orders the farmer has not accepted, or that missed their delivery deadline',
      ]}
    />
  )
}
