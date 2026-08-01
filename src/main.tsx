import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient } from 'convex/react'
import { ConvexAuthProvider } from '@convex-dev/auth/react'
import './index.css'
import App from './App.tsx'

// Vite inlines this at BUILD time, so a deployment built without it produces a
// bundle that can never reach a backend. Say so out loud — the alternative is a
// blank white page whose only clue is a stack trace in the console.
const convexUrl = import.meta.env.VITE_CONVEX_URL
if (!convexUrl) {
  document.getElementById('root')!.innerHTML =
    '<p style="font:16px system-ui;padding:2rem;max-width:34rem;margin:auto">' +
    '<strong>VITE_CONVEX_URL is not set.</strong><br><br>This build has no ' +
    'backend to talk to. Set it in the deployment environment (or run ' +
    '<code>npx convex dev</code> locally to write it into .env.local) and build again.</p>'
  throw new Error('VITE_CONVEX_URL is not set')
}

const convex = new ConvexReactClient(convexUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
)
