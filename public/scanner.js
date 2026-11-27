// Camera barcode scanner.
// Uses the browser's built-in BarcodeDetector where available (Android Chrome),
// otherwise the bundled ZXing library (iPhone Safari, desktop).

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

export function createScanner(video) {
  let stream = null;
  let stopped = true;

  async function nativeDetector() {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new window.BarcodeDetector({ formats }) : null;
    } catch {
      return null;
    }
  }

  async function openCamera() {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  }

  function zxingDecoder() {
    const ZXing = window.ZXing;
    if (!ZXing) throw new Error('Scanner library failed to load');
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.CODE_128,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(hints);
    // Draw each frame into our own canvas at the video's current size (phones can
    // change camera resolution after starting, which confuses ZXing's own cache).
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      try {
        const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
        return reader.decodeWithState(bitmap).getText();
      } catch {
        return null; // no barcode in this frame
      }
    };
  }

  function nativeDecoder(detector) {
    return async () => {
      try {
        const codes = await detector.detect(video);
        return codes.length ? codes[0].rawValue : null;
      } catch {
        return null;
      }
    };
  }

  function loop(decode, onCode) {
    const tick = async () => {
      if (stopped) return;
      if (video.readyState >= 2) {
        const code = await decode();
        if (code && !stopped) {
          onCode(code);
          return;
        }
      }
      setTimeout(tick, 150);
    };
    tick();
  }

  return {
    async start(onCode) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot use the camera. Type the barcode instead.');
      }
      stopped = false;
      let fired = false;
      const once = (code) => {
        if (fired) return;
        fired = true;
        if (navigator.vibrate) navigator.vibrate(60);
        onCode(code);
      };
      const detector = await nativeDetector();
      const decode = detector ? nativeDecoder(detector) : zxingDecoder();
      await openCamera();
      loop(decode, once);
    },
    stop() {
      stopped = true;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      video.srcObject = null;
    },
  };
}
