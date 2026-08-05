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

      // How much of the frame jsQR is given, cycled tick by tick.
      //
      // A dense fiscal code needs its resolution kept, so the frame is CROPPED
      // rather than scaled — and cropping is also the speed-up. jsQR is pure
      // JavaScript and its cost is per pixel: a whole 1920×1080 frame is two
      // million of them and buys perhaps three attempts a second, which is why
      // scanning felt like hunting. A centred square is half that, and a
      // tighter one a fifth.
      //
      // Two crops rather than one because they answer different distances: the
      // wide one finds a receipt held back far enough to fit, the tight one a
      // code brought close enough to fill the middle. Alternating tries both
      // several times a second instead of betting on either.
      const crops = [1, 0.6]
      let pass = 0

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
              const vw = video.videoWidth
              const vh = video.videoHeight
              const side = Math.floor(Math.min(vw, vh) * crops[pass++ % crops.length])
              const sx = Math.floor((vw - side) / 2)
              const sy = Math.floor((vh - side) / 2)

              canvas.width = side
              canvas.height = side
              ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side)
              const img = ctx.getImageData(0, 0, side, side)
              // "dontInvert" rather than "attemptBoth": trying both doubles the
              // work every frame to catch a light-on-dark code, which a printed
              // receipt never is. The frames saved are worth more than the case.
              const found = jsQR(img.data, side, side, {
                inversionAttempts: 'dontInvert',
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
      {/* Full screen means full screen — the notch and the home indicator are
          this component's problem, not the browser's. */}
      <div className="flex items-center justify-between px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
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
        {/* The box is now the truth: the decoder is given the centre of the
            frame, so a code outside it is a code that will not be read. It is
            drawn large because a fiscal code is dense enough that filling this
            square is roughly what it takes. */}
        {!error && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <div className="aspect-square w-[78%] max-w-80 rounded-2xl border-2 border-white/90" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-8">
            <p className="max-w-xs text-center text-sm text-white">{error}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {hasTorch && (
          <Button variant="secondary" onClick={toggleTorch}>
            {torchOn ? 'Light off' : 'Light on'}
          </Button>
        )}
        <p className="text-center text-xs text-white/70">
          Fill the square. Hold it flat, and pull back until it focuses.
        </p>
      </div>
    </div>,
    document.body,
  )
}
