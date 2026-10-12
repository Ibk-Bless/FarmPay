import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="max-w-xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-6xl mb-4">🌾</p>
        <h1 className="text-3xl font-bold text-gray-900">Page not found</h1>
        <p className="text-gray-600 mt-2">The page you're looking for doesn't exist or has moved.</p>
        <div className="mt-8 flex justify-center gap-4">
          <Link to="/" className="bg-green-600 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-green-700 transition">
            Back to home
          </Link>
          <Link to="/order/create" className="border-2 border-gray-300 text-gray-700 px-5 py-2.5 rounded-lg font-semibold hover:bg-gray-50 transition">
            Create an order
          </Link>
        </div>
      </main>
    </div>
  )
}
