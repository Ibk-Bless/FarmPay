import PlannedPage from '../components/PlannedPage'

export default function FarmerDashboard() {
  return (
    <PlannedPage
      title="Farmer Dashboard"
      description="Funded orders waiting for you, and payments on their way."
      actions={[
        'Review funded orders and accept them',
        'Mark orders delivered to start the review window',
        'Claim payment once the review window has passed',
      ]}
    />
  )
}
