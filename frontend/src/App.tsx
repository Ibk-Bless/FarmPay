import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import BuyerDashboard from './pages/BuyerDashboard'
import FarmerDashboard from './pages/FarmerDashboard'
import OrderCreation from './pages/OrderCreation'
import OrderDetail from './pages/OrderDetail'
import DeliveryProfile from './pages/DeliveryProfile'
import NotFound from './pages/NotFound'
import DemoBar from './demo/DemoBar'
import { isDemo } from './lib/mode'

function App() {
  return (
    <>
      {isDemo && <DemoBar />}
      <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/buyer/dashboard" element={<BuyerDashboard />} />
      <Route path="/farmer/dashboard" element={<FarmerDashboard />} />
      <Route path="/order/create" element={<OrderCreation />} />
      <Route path="/order/:orderId" element={<OrderDetail />} />
      <Route path="/farmer/:farmerId/profile" element={<DeliveryProfile />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}

export default App
