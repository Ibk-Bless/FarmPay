import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App.tsx'
import WalletProvider from './wallet/WalletProvider'
import DemoProvider from './demo/DemoProvider'
import { initDemo } from './demo/demoApi'
import { isDemo } from './lib/mode'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

if (isDemo) initDemo()

// The demo uses hash routes, so it works on any static host without rewrite rules.
const Router = isDemo ? HashRouter : BrowserRouter
const Provider = isDemo ? DemoProvider : WalletProvider

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Router>
        <Provider>
          <App />
        </Provider>
      </Router>
    </ErrorBoundary>
  </React.StrictMode>,
)
