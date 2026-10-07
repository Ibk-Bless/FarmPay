import { Link } from 'react-router-dom'
import WalletButton from './WalletButton'

export default function AppHeader() {
  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex justify-between items-center">
        <Link to="/" className="flex items-center space-x-2">
          <span className="text-2xl">🌾</span>
          <span className="text-xl font-bold text-green-700">FarmPay</span>
          <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded">testnet</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link to="/order/create" className="hidden sm:inline text-gray-700 hover:text-green-600">
            New order
          </Link>
          <WalletButton />
        </div>
      </div>
    </nav>
  )
}
