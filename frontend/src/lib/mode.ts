/**
 * True in the interactive demo build (`npm run dev:demo` / `build:demo`): orders are simulated
 * in the browser, with no backend, wallet or blockchain. See src/demo/.
 */
export const isDemo = import.meta.env.VITE_DEMO === 'true'
