import { useEffect, useRef, useState } from 'react'

/** Camera QR scanner. Streams the back camera into a <video>, decodes each frame with jsQR, and
 *  fires onResult with the first decoded payload that `accept` validates (non-null). Integration
 *  glue — the camera + canvas + jsQR loop is not unit-tested; the `accept` validator and the
 *  no-camera/permission error paths are. */
export function QrScanner({ accept, onResult, onCancel }: {
  accept: (text: string) => string | null
  onResult: (value: string) => void
  onCancel: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Hold the callbacks in refs so the camera effect runs exactly once (inline callbacks would
  // otherwise restart the stream on every render).
  const acceptRef = useRef(accept); acceptRef.current = accept
  const onResultRef = useRef(onResult); onResultRef.current = onResult
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This device's camera isn't available here — paste the link instead.")
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        setError('Camera access was blocked. Allow the camera in your browser, or paste the link instead.')
        return
      }
      // Lazy-load the QR decoder only when the camera actually opens, so it stays out of the main bundle.
      let jsQR: (typeof import('jsqr'))['default']
      try {
        jsQR = (await import('jsqr')).default
      } catch {
        stream.getTracks().forEach(t => t.stop())
        setError("Couldn't load the QR scanner — paste the link instead.")
        return
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
      const video = videoRef.current
      if (!video) return
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      video.srcObject = stream
      await video.play().catch(() => { /* autoplay race — the scan loop tolerates a not-yet-ready frame */ })
      const tick = () => {
        if (cancelled) return
        if (ctx && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(img.data, img.width, img.height)
          if (code) {
            const value = acceptRef.current(code.data)
            if (value) { onResultRef.current(value); return } // stop the loop on a usable code
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  return (
    <main className="page fade-in">
      <h2 className="section-title">Scan the app's QR code</h2>
      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: '8px 0 16px', lineHeight: 1.5 }}>{error}</p>
      ) : (
        <>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 0, marginBottom: 12 }}>
            Point your camera at the connection QR code shown by the app.
          </p>
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Camera preview"
            style={{ width: '100%', borderRadius: 12, background: '#000', aspectRatio: '1 / 1', objectFit: 'cover' }}
          />
        </>
      )}
      <button className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={onCancel}>Cancel</button>
    </main>
  )
}
