import { useEffect, useRef, useState, type FormEvent } from "react";
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
 * Camera scanner built on the native BarcodeDetector API (Chrome and Android,
 * which covers a club member's phone at a pickup table), with a paste-the-code
 * fallback that works everywhere.
 */
export function QRScanner({ onToken, busy = false }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");

  const supportsDetector = typeof window !== "undefined" && Boolean(window.BarcodeDetector);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => stopCamera, []);

  useEffect(() => {
    if (!scanning || !supportsDetector) return;
    let cancelled = false;
    const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });

    const tick = async () => {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const token = codes[0]?.rawValue?.trim();
          if (token) {
            stopCamera();
            onToken(token);
            return;
          }
        } catch {
          // Frame not ready; keep polling.
        }
      }
      window.setTimeout(() => void tick(), 250);
    };
    void tick();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, supportsDetector]);

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
    } catch {
      setCameraError("Camera unavailable. Paste the code from under the QR instead.");
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

      {supportsDetector ? (
        <div className="mt-3">
          {scanning ? (
            <>
              <video
                ref={videoRef}
                className="aspect-square w-full max-w-72 rounded-xl bg-ink object-cover"
                muted
                playsInline
              />
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
      ) : (
        <p className="mt-2 text-xs text-ink-muted">
          This browser cannot scan with the camera. Paste the code printed under the QR instead.
        </p>
      )}

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
