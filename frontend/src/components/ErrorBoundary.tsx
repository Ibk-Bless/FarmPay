import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  failed: boolean
}

/** Last line of defence: a rendering crash shows a message instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-5xl mb-4">🌾</p>
          <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
          <p className="text-gray-600 mt-2">
            The page hit an unexpected problem. Your funds are not affected: they are held by the escrow contract.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 bg-green-700 text-white px-5 py-2.5 rounded-lg font-semibold hover:bg-green-800 transition"
          >
            Reload the page
          </button>
        </div>
      </div>
    )
  }
}
