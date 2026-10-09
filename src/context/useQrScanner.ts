import { useEffect, useRef, type RefObject } from "react";
import { showToast } from "@/components/ui/toastStore";

export function useQrScanner(enabled: boolean, video: RefObject<HTMLVideoElement>, onResult: (code: string) => void) {
  const handler = useRef(onResult);
  useEffect(() => { handler.current = onResult; }, [onResult]);
  useEffect(() => {
    if (!enabled || !video.current) return;
    let cancelled = false;
    let scanned = false;
    let controls: { stop(): void } | undefined;
    const element = video.current;
    void (async () => {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (cancelled) return;
      controls = await new BrowserQRCodeReader().decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } }, element,
        (result, _error, activeControls) => {
          if (cancelled) { activeControls.stop(); return; }
          controls = activeControls;
          if (!result || scanned) return;
          scanned = true;
          handler.current(result.getText());
        },
      );
      // Camera permission can resolve after the modal was already closed.
      if (cancelled) controls.stop();
    })().catch(() => { if (!cancelled) showToast("error", "Không thể mở camera. Kiểm tra quyền camera hoặc nhập mã điểm danh."); });
    return () => { cancelled = true; controls?.stop(); };
  }, [enabled, video]);
}
