import { useEffect, useRef, useState, type FormEvent } from "react";
import jsQR from "jsqr";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
  }
}

interface QRScannerProps {
  /** Called once per detected or pasted token. */
  onToken: (token: string) => void;
  busy?: boolean;
}

/**
 * Camera scanner that works across browsers. Uses the native BarcodeDetector
 * API where available (Chrome/Edge/Android — fast), and falls back to jsQR
 * decoding of canvas frames everywhere else, including Safari on macOS and iOS
 * — which has no BarcodeDetector. A paste-the-code field is the final fallback.
 */
export function QRScanner({ onToken, busy = false }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  // Always stop the camera when the component unmounts.
  useEffect(() => stopCamera, []);

  // Once `scanning` is true the <video> is mounted, so we attach the stream
  // HERE (not in startCamera, where the element doesn't exist yet) and then run
  // the decode loop. Attaching before render is what left the screen black.
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.setAttribute("playsinline", "true"); // iOS Safari: stay inline
      void video.play().catch(() => {
        /* autoplay may reject; muted+playsinline normally allows it */
      });
    }

    const detector =
      typeof window !== "undefined" && window.BarcodeDetector
        ? new window.BarcodeDetector({ formats: ["qr_code"] })
        : null;

    const handleToken = (token: string) => {
      stopCamera();
      onToken(token);
    };

    const tick = async () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        try {
          if (detector) {
            const codes = await detector.detect(v);
            const token = codes[0]?.rawValue?.trim();
            if (token) return handleToken(token);
          } else {
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const result = jsQR(image.data, image.width, image.height, {
                  inversionAttempts: "dontInvert",
                });
                const token = result?.data?.trim();
                if (token) return handleToken(token);
              }
            }
          }
        } catch {
          // Frame not ready or transient decode error; keep polling.
        }
      }
      window.setTimeout(() => void tick(), 200);
    };
    void tick();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      // Prefer the rear camera on phones; fall back to any camera (e.g. a Mac).
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setScanning(true); // mounts the <video>; the effect above attaches the stream
    } catch {
      setCameraError(
        "Couldn't open the camera. Allow camera access in your browser settings, or paste the code below.",
      );
    }
  };

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const token = manualToken.trim();
    if (!token) return;
    setManualToken("");
    onToken(token);
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <h3 className="text-base font-bold">Scan a pickup pass</h3>

      <div className="mt-3">
        {scanning ? (
          <>
            <div className="relative mx-auto w-full max-w-72 overflow-hidden rounded-xl bg-ink">
              <video
                ref={videoRef}
                className="aspect-square w-full object-cover"
                muted
                autoPlay
                playsInline
              />
              {/* Framing guide */}
              <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
            </div>
            <Button variant="secondary" size="sm" className="mt-3" onClick={stopCamera}>
              <CameraOff className="size-3.5" aria-hidden="true" />
              Stop camera
            </Button>
          </>
        ) : (
          <Button onClick={() => void startCamera()} disabled={busy}>
            <Camera className="size-4" aria-hidden="true" />
            Start camera
          </Button>
        )}
        {cameraError && (
          <p className="mt-2 text-xs font-medium text-accent" role="alert">
            {cameraError}
          </p>
        )}
      </div>

      {/* Off-screen canvas used for jsQR frame decoding on Safari. */}
      <canvas ref={canvasRef} className="hidden" />

      <form onSubmit={submitManual} className="mt-4">
        <Label htmlFor="manual-token">Or enter the pass code</Label>
        <div className="flex gap-2">
          <Input
            id="manual-token"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            placeholder="Paste the code from the email"
            className="flex-1 font-mono text-sm"
          />
          <Button type="submit" variant="secondary" loading={busy} disabled={!manualToken.trim()}>
            Check
          </Button>
        </div>
      </form>
    </div>
  );
}
