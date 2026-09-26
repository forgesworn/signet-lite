import { useRegisterSW } from 'virtual:pwa-register/react'
import { UpdateBanner } from './UpdateBanner.js'

export function PwaUpdater() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, r) {
      if (!r) return
      setInterval(() => {
        if (navigator?.onLine === false) return
        r.update().catch(() => {})
      }, 60_000)
    },
  })

  return (
    <UpdateBanner
      show={needRefresh}
      onReload={() => void updateServiceWorker(true)}
      onDismiss={() => setNeedRefresh(false)}
    />
  )
}
