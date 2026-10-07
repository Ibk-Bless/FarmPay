import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import WalletProvider from './wallet/WalletProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <WalletProvider>
        <App />
      </WalletProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
