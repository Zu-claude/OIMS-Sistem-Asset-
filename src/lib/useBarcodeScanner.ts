import { useEffect, useRef } from 'react';

export function normalizeScannedBarcode(raw: string): string {
  // Strip control chars (CR, LF, TAB, STX/ETX prefixes) and trim whitespace
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

export function playScanBeep(success = true) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(success ? 1320 : 420, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (success ? 0.09 : 0.2));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.095 : 0.21));
    osc.onended = () => {
      ctx.close().catch(() => undefined);
    };
  } catch {
    // Audio playback unavailable or blocked
  }
}

interface UseBarcodeScannerOptions {
  /** Whether hardware HID/Bluetooth keyboard-wedge capture is active */
  enabled: boolean;
  /** Primary scan/search input element ref */
  targetInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Fired when a barcode scan completes (rapid burst or Enter in target input) */
  onScan: (code: string, source: 'hardware-wedge' | 'manual-enter') => void;
  /** Minimum character count to classify a rapid keystroke burst as a scanner read */
  minLength?: number;
  /** Max ms between consecutive keys for USB HID / Bluetooth keyboard-wedge detection */
  maxInterKeyMs?: number;
}

/**
 * Captures barcode/QR scans from USB HID and Bluetooth keyboard-wedge scanners.
 * - Works even if the user hasn't clicked into the scan input (hands-free capture).
 * - Prevents concatenating new scans onto stale text when focused on targetInputRef.
 * - Ignores normal typing inside unrelated modals, textareas, or select dropdowns.
 */
export function useBarcodeScanner({
  enabled,
  targetInputRef,
  onScan,
  minLength = 3,
  maxInterKeyMs = 65,
}: UseBarcodeScannerOptions) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyTime = 0;
    let fastKeyCount = 0;
    let resetTimer: number | null = null;

    const resetBuffer = () => {
      buffer = '';
      fastKeyCount = 0;
      lastKeyTime = 0;
      if (resetTimer !== null) {
        window.clearTimeout(resetTimer);
        resetTimer = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const isTargetInput = Boolean(targetInputRef?.current && activeEl === targetInputRef.current);
      const isOtherEditable =
        !isTargetInput &&
        Boolean(
          activeEl &&
            (activeEl.tagName === 'INPUT' ||
              activeEl.tagName === 'TEXTAREA' ||
              activeEl.tagName === 'SELECT' ||
              activeEl.isContentEditable)
        );

      // Never interfere when the user is typing inside modals, filters, or other form fields
      if (isOtherEditable) {
        resetBuffer();
        return;
      }

      const now = performance.now();
      const delta = lastKeyTime > 0 ? now - lastKeyTime : Number.POSITIVE_INFINITY;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const cleanedBuffer = normalizeScannedBarcode(buffer);
        const isRapidBurst = fastKeyCount >= minLength - 1 && cleanedBuffer.length >= minLength;

        if (isRapidBurst) {
          e.preventDefault();
          e.stopPropagation();
          resetBuffer();
          if (targetInputRef?.current) {
            targetInputRef.current.focus();
          }
          onScanRef.current(cleanedBuffer, 'hardware-wedge');
          return;
        }

        if (isTargetInput && e.key === 'Enter' && targetInputRef?.current) {
          const manualValue = normalizeScannedBarcode(targetInputRef.current.value);
          resetBuffer();
          if (manualValue.length > 0) {
            e.preventDefault();
            onScanRef.current(manualValue, 'manual-enter');
          }
          return;
        }

        resetBuffer();
        return;
      }

      if (e.key.length === 1) {
        if (delta <= maxInterKeyMs) {
          buffer += e.key;
          fastKeyCount += 1;
        } else {
          buffer = e.key;
          fastKeyCount = 0;
        }
        lastKeyTime = now;

        if (resetTimer !== null) {
          window.clearTimeout(resetTimer);
        }
        resetTimer = window.setTimeout(resetBuffer, maxInterKeyMs * 3);
      } else if (e.key !== 'Shift') {
        resetBuffer();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      resetBuffer();
    };
  }, [enabled, targetInputRef, minLength, maxInterKeyMs]);
}
