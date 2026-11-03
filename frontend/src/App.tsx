import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import MyOrders from './pages/MyOrders'
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
      <Route path="/orders" element={<MyOrders />} />
      <Route path="/buyer/dashboard" element={<MyOrders role="buyer" />} />
      <Route path="/farmer/dashboard" element={<MyOrders role="farmer" />} />
      <Route path="/cooperative/dashboard" element={<MyOrders role="arbiter" />} />
      <Route path="/order/create" element={<OrderCreation />} />
      <Route path="/order/:orderId" element={<OrderDetail />} />
      <Route path="/farmer/:farmerId/profile" element={<DeliveryProfile />} />
      <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}

export default App
