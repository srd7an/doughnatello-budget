import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { XIcon } from './icons'

/**
 * The camera, pointed at a QR code.
 *
 * Two decoders, in order. `BarcodeDetector` is native, hardware-accelerated and
 * markedly better on a dense code — but it does not exist on iOS, so `jsqr` is
 * loaded behind it. jsqr is imported dynamically: it is only ever needed once
 * the camera is actually open, and it has no business in the main bundle.
 *
 * The torch is not a flourish. A fiscal receipt is thermal paper, it fades
 * within weeks, and a faded code under kitchen light is exactly the one that
 * will not read — the lamp is often the difference between scanning and typing.
 * It is Chromium-on-Android only, so it appears only where it works.
 *
 * Whatever is read is handed back RAW. Deciding what it means is `lib/qr`'s job;
 * this component's only promises are a picture, a decode, and a camera that is
 * switched off on the way out.
 */
export function QrScanner({
  onRead,
  onClose,
}: {
  onRead: (text: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [hasTorch, setHasTorch] = useState(false)

  // In a ref, not state: the decode loop reads it every frame, and a stale
  // closure would keep scanning after a hit and fire onRead twice.
  const doneRef = useRef(false)

  const stop = useCallback(() => {
    doneRef.current = true
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let raf = 0
    let cancelled = false

    async function run() {
      // getUserMedia does not exist without a secure context, and the message
      // for that is not "permission denied" — it is "this needs https".
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          window.isSecureContext
            ? 'This browser has no camera API.'
            : 'The camera needs a secure connection (https).',
        )
        return
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, and as much detail as it will give: a fiscal code
          // is dense enough that a low-resolution frame simply cannot carry it.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
      } catch (e) {
        const name = e instanceof DOMException ? e.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was refused. Allow it in the browser’s site settings and try again.'
            : name === 'NotFoundError'
              ? 'No camera on this device.'
              : 'Could not start the camera.',
        )
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      // iOS plays inline only when told to; without this it hijacks the screen
      // with the native fullscreen player and there is nothing left to scan in.
      video.setAttribute('playsinline', 'true')
      try {
        await video.play()
      } catch {
        // Autoplay can be refused; the frames still arrive.
      }

      const track = stream.getVideoTracks()[0]
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined
      if (caps?.torch) setHasTorch(true)

      const detector =
        'BarcodeDetector' in window
          ? // @ts-expect-error — not in lib.dom yet, and absent on iOS.
            new window.BarcodeDetector({ formats: ['qr_code'] })
          : null
      const jsQR = detector ? null : (await import('jsqr')).default
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      const hit = (text: string) => {
        if (doneRef.current || !text) return
        stop()
        onRead(text)
      }

      const tick = async () => {
        if (doneRef.current || cancelled) return
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          try {
            if (detector) {
              const codes = await detector.detect(video)
              if (codes[0]?.rawValue) return hit(codes[0].rawValue)
            } else if (jsQR && ctx) {
              canvas.width = video.videoWidth
              canvas.height = video.videoHeight
              ctx.drawImage(video, 0, 0)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              // Both inversions: a receipt is dark-on-light, but a code on a
              // screen is often the other way round.
              const found = jsQR(img.data, img.width, img.height, {
                inversionAttempts: 'attemptBoth',
              })
              if (found?.data) return hit(found.data)
            }
          } catch {
            // A single failed frame means nothing — the next one is 16ms away.
          }
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    run()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stop()
    }
  }, [onRead, stop])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({
        // @ts-expect-error — torch is not in the typed constraint set.
        advanced: [{ torch: !torchOn }],
      })
      setTorchOn((t) => !t)
    } catch {
      setHasTorch(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-stone-900">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-base font-medium text-white">Scan a code</h2>
        <button
          onClick={() => {
            stop()
            onClose()
          }}
          aria-label="Close"
          className="grid size-11 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <XIcon size={20} aria-hidden />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          muted
          playsInline
          className="size-full object-cover"
        />
        {/* A frame to aim with. Nothing is cropped to it — the whole picture is
            decoded — but a code held at arm's length reads far better than one
            filling the lens, and a target is how you say that without words. */}
        {!error && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <div className="size-64 max-w-[70vw] rounded-2xl border-2 border-white/80" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-8">
            <p className="max-w-xs text-center text-sm text-white">{error}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 pb-8 pt-4">
        {hasTorch && (
          <Button variant="secondary" onClick={toggleTorch}>
            {torchOn ? 'Light off' : 'Light on'}
          </Button>
        )}
        <p className="text-center text-xs text-white/70">
          A receipt or a payment slip. Hold it flat and fill the frame.
        </p>
      </div>
    </div>,
    document.body,
  )
}
