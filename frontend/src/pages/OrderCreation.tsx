import PlannedPage from '../components/PlannedPage'

export default function OrderCreation() {
  return (
    <PlannedPage
      title="Create Order"
      description="Fund a new order. The USDC is held by the escrow contract until the order completes."
      actions={[
        'Choose the farmer and their cooperative (the arbiter)',
        'Set the USDC amount, delivery deadline and review window',
        'Sign with your wallet to lock the funds',
      ]}
    />
  )
}
