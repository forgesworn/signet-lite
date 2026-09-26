import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { PwaUpdater } from './ui/components/PwaUpdater.js'
import { loadAndApplyTheme } from './ui/theme.js'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/playfair-display/wght.css'
import './ui/styles/global.css'

void loadAndApplyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <App />
      <PwaUpdater />
    </>
  </StrictMode>,
)
