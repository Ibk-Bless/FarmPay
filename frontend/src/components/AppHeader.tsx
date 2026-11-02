import { Link } from 'react-router-dom'
import WalletButton from './WalletButton'

export default function AppHeader() {
  return (
    <nav className="bg-white shadow-sm">
      {/* On a narrow screen the links and wallet drop to a second line instead of overflowing. */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-2 flex flex-wrap justify-between items-center gap-x-4 gap-y-2">
        <Link to="/" className="flex items-center space-x-2">
          <span className="text-2xl">🌾</span>
          <span className="text-xl font-bold text-green-700">FarmPay</span>
          <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded">testnet</span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 sm:gap-x-6">
          <Link to="/orders" className="whitespace-nowrap text-gray-700 hover:text-green-700">
            My orders
          </Link>
          <Link to="/order/create" className="hidden sm:inline whitespace-nowrap text-gray-700 hover:text-green-700">
            New order
          </Link>
          <WalletButton />
        </div>
      </div>
    </nav>
  )
}
