import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 4000

// Middleware
app.use(cors())
app.use(express.json())

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'FarmPay API is running' })
})

// Routes (to be implemented)
app.get('/api/orders', (req, res) => {
  res.json({ message: 'Orders endpoint - coming soon' })
})

app.get('/api/farmers/:id', (req, res) => {
  res.json({ message: 'Farmer profile endpoint - coming soon' })
})

app.get('/api/buyers/:id', (req, res) => {
  res.json({ message: 'Buyer profile endpoint - coming soon' })
})

app.listen(PORT, () => {
  console.log(`🌾 FarmPay API server running on port ${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV}`)
  console.log(`Stellar Network: ${process.env.STELLAR_NETWORK}`)
})
