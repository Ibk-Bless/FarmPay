import { Link } from 'react-router-dom'

interface PlannedPageProps {
  title: string
  description: string
  actions: string[]
}

// Shown for screens that are on the roadmap but not built yet.
export default function PlannedPage({ title, description, actions }: PlannedPageProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/" className="text-green-600 hover:text-green-700 text-sm">← FarmPay</Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-4">{title}</h1>
        <p className="text-gray-600 mt-2">{description}</p>
        <div className="mt-6 bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="font-semibold text-gray-900 mb-3">This screen will let you</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-700">
            {actions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
        <p className="text-sm text-gray-500 mt-6">
          Not built yet. The API behind it already works on testnet. Want to build it? See the{' '}
          <a href="https://github.com/Ibk-Bless/FarmPay#roadmap" className="text-green-600 hover:underline">roadmap</a>.
        </p>
      </div>
    </div>
  )
}
