import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import BuyerDashboard from './pages/BuyerDashboard'
import FarmerDashboard from './pages/FarmerDashboard'
import OrderCreation from './pages/OrderCreation'
import OrderDetail from './pages/OrderDetail'
import DeliveryProfile from './pages/DeliveryProfile'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/buyer/dashboard" element={<BuyerDashboard />} />
      <Route path="/farmer/dashboard" element={<FarmerDashboard />} />
      <Route path="/order/create" element={<OrderCreation />} />
      <Route path="/order/:orderId" element={<OrderDetail />} />
      <Route path="/farmer/:farmerId/profile" element={<DeliveryProfile />} />
    </Routes>
  )
}

export default App
