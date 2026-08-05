import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { XIcon } from './icons'

/**
 * ZXing, compiled to WebAssembly, loaded on demand.
 *
 * It replaced jsQR, which is a small and honest decoder that simply runs out of
 * road on a dense code: an IPS slip at ~40 modules read instantly and a fiscal
 * receipt at ~140 would not read at all, on any resolution, at any distance.
 * ZXing is the mature implementation and its binariser and perspective
 * correction are in a different class. That is the whole reason for the swap.
 *
 * The .wasm is bundled and served from our own origin. Left to itself the
 * package fetches it from a CDN at first use, which is a network dependency in
 * the middle of a scan and a third party in the middle of a receipt.
 */
let decoderPromise: Promise<typeof import('zxing-wasm/reader')> | null = null
function decoder() {
  decoderPromise ??= (async () => {
    const [mod, wasm] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
    mod.prepareZXingModule({
      overrides: { locateFile: () => wasm.default },
      fireImmediately: true,
    })
    return mod
  })()
  return decoderPromise
}

/** QR only, and let ZXing work for it — tryHarder is the whole point of the
 *  swap, and a frame this app throws away every 16ms can afford it. */
const QR_ONLY: import('zxing-wasm/reader').ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
}

/**
 * The camera, pointed at a QR code.
 *
 * Three ways in, because a dense fiscal code defeated the first one on its own:
 * point the camera, photograph it, or paste the link. The last cannot fail —
 * the phone's own camera app reads any QR natively and hands you the URL — so
 * there is always a way to record a receipt.
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
  // Shown, not assumed: `ideal` is a wish and every phone answers it its own
  // way. When a dense code will not read, this is the first number to look at.
  const [resolution, setResolution] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const [pasteFailed, setPasteFailed] = useState(false)

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
          // Resolution is THE constraint, and it is worth understanding why.
          //
          // A QR needs roughly three camera pixels per module to decode. An IPS
          // slip is about 40 modules across and reads instantly off almost
          // anything. A fiscal receipt is about 140 — the payload is 572 bytes —
          // so the same code wants three and a half times the detail across the
          // same piece of paper. At 1280 wide, a receipt filling the frame gives
          // barely 2 px per module, and no amount of processing invents the
          // rest.
          //
          // So: ask for as much as the camera has. `ideal` is a wish and phones
          // answer it differently, which is why the resolution actually granted
          // is shown on screen rather than assumed.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            // @ts-expect-error — not in the typed constraint set, ignored where
            // unsupported. A dense code close up is exactly what fixed focus
            // gets wrong.
            focusMode: 'continuous',
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
      const settings = track?.getSettings?.()
      if (settings?.width && settings?.height) {
        setResolution(`${settings.width}×${settings.height}`)
      }

      // ZXing everywhere, including where BarcodeDetector exists. Two decoders
      // meant two sets of behaviour to reason about, and the native one was
      // never the one failing.
      const zxing = await decoder()
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })

      // How much of the frame the decoder is given, cycled tick by tick.
      //
      // Cropped rather than scaled, because a dense code cannot spare the
      // resolution — and cropping is also the speed-up, since the cost is per
      // pixel. Two crops because they answer different distances: the wide one
      // finds a receipt held back far enough to fit, the tighter one a code
      // brought closer. Alternating tries both several times a second instead
      // of betting on either.
      // 1.0 is the whole centred square; 0.8 is for a code brought closer. The
      // tighter 0.6 that was here cut a large fiscal code in half, which is
      // worse than useless — half a QR is not a QR, and it cost every other
      // frame.
      const crops = [1, 0.8]
      let pass = 0

      const hit = (text: string) => {
        if (doneRef.current || !text) return
        stop()
        onRead(text)
      }

      const tick = async () => {
        if (doneRef.current || cancelled) return
        if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
          try {
            const vw = video.videoWidth
            const vh = video.videoHeight
            const side = Math.floor(Math.min(vw, vh) * crops[pass++ % crops.length])
            const sx = Math.floor((vw - side) / 2)
            const sy = Math.floor((vh - side) / 2)

            canvas.width = side
            canvas.height = side
            ctx.drawImage(video, sx, sy, side, side, 0, 0, side, side)
            const img = ctx.getImageData(0, 0, side, side)
            const found = await zxing.readBarcodes(img, QR_ONLY)
            if (found[0]?.text) return hit(found[0].text)
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

  /**
   * The escape hatch: a still photograph instead of the video stream.
   *
   * A video frame is a compromise the camera makes for frame rate. A still is
   * not — it comes back at the sensor's real resolution, often twelve megapixels
   * against the two a stream gives, and at that size a fiscal code has ten-odd
   * pixels per module rather than two. It is also focused, because the camera
   * app took its time about it.
   *
   * Slower and clumsier than pointing, so it is offered rather than imposed:
   * the live scan reads an IPS slip instantly and there is no reason to make
   * anyone photograph one.
   */
  const readPhoto = async (file: File) => {
    setPhotoBusy(true)
    setPhotoFailed(false)
    try {
      // The file goes in whole. ZXing decodes a Blob itself, at the sensor's
      // own resolution, with no canvas in the middle to lose anything.
      const zxing = await decoder()
      const found = await zxing.readBarcodes(file, QR_ONLY)
      if (found[0]?.text) {
        stop()
        onRead(found[0].text)
        return
      }
      setPhotoFailed(true)
    } catch {
      setPhotoFailed(true)
    } finally {
      setPhotoBusy(false)
    }
  }

  /**
   * The path that cannot fail: paste the link.
   *
   * Every phone's own camera app reads a QR natively — hardware-accelerated,
   * full sensor, and better than anything that will ever run in this page. Point
   * it at the receipt, tap the banner it offers, copy the address, come back.
   *
   * Clumsy, and deliberately last. But it means a receipt can always be
   * recorded, whatever the camera in here makes of it.
   */
  const pasteLink = async () => {
    setPasteFailed(false)
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) {
        stop()
        onRead(text.trim())
        return
      }
    } catch {
      // Refused, or no clipboard permission.
    }
    setPasteFailed(true)
  }

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

      <div className="flex flex-col items-center gap-3 px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <p className="text-center text-xs text-white/70">
          Fill the square. Hold it flat, and pull back until it focuses.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {hasTorch && (
            <Button variant="secondary" onClick={toggleTorch}>
              {torchOn ? 'Light off' : 'Light on'}
            </Button>
          )}
          {/* A label, not a button: the input has to be the thing that is
              clicked for the camera to open on iOS. */}
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-white/40 px-4 text-sm text-white hover:bg-white/10 sm:min-h-9">
            {photoBusy ? 'Reading…' : 'Photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) readPhoto(file)
                e.target.value = ''
              }}
            />
          </label>

          <Button variant="secondary" onClick={pasteLink}>
            Paste link
          </Button>
        </div>

        {pasteFailed && (
          <p className="max-w-xs text-center text-xs text-white">
            Nothing to paste. Scan the receipt with the phone’s own Camera app,
            copy the address it offers, then come back and press this.
          </p>
        )}

        {photoFailed && (
          <p className="text-center text-xs text-white">
            No code found in that photo. Get closer, and keep the whole code in
            the shot.
          </p>
        )}
        {resolution && (
          <p className="text-center text-[10px] text-white/40">
            Camera {resolution}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
