import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/globals.css'

function getBasename(): string | undefined {
  if (window.__TAURI_INTERNALS__) return undefined
  const path = window.location.pathname
  if (path.startsWith('/admin')) return '/admin'
  return undefined
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={getBasename()}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
