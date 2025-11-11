import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { LicenseProvider } from './license/LicenseContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LicenseProvider>
      <App />
    </LicenseProvider>
  </React.StrictMode>,
)
