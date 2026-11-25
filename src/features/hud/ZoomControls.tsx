"use client";

import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.25;
const STEP = 0.08;

/** Bottom-right floating Zoom & Fit pill. */
export function ZoomControls({
  zoom,
  onFit,
  onZoomChange,
}: {
  zoom: number;
  onFit: () => void;
  onZoomChange: (next: number) => void;
}) {
  return (
    <div className="pointer-events-auto absolute right-4 bottom-3 z-20 hidden items-center gap-1.5 rounded-full border border-[#282e3b] bg-[#151820]/95 px-2.5 py-1 shadow-[0_6px_24px_rgba(0,0,0,0.45)] backdrop-blur-md lg:flex">
      <button
        type="button"
        onClick={onFit}
        aria-label="Reset zoom"
        title="Fit view"
        className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-[#96a0b3] transition-colors hover:bg-[#222733] hover:text-white"
      >
        <Maximize2 className="h-3 w-3" strokeWidth={1.6} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() =>
          onZoomChange(Math.max(MIN_ZOOM, Number((zoom - STEP).toFixed(2))))
        }
        aria-label="Zoom out"
        className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-[#96a0b3] transition-colors hover:bg-[#222733] hover:text-white"
      >
        <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
      </button>
      <input
        type="range"
        min={MIN_ZOOM * 100}
        max={MAX_ZOOM * 100}
        step={5}
        value={Math.round(zoom * 100)}
        aria-label="Canvas zoom percentage"
        onChange={(e) => onZoomChange(Number(e.target.value) / 100)}
        className="h-1 w-20 cursor-pointer accent-[#cfd6e2]"
      />
      <button
        type="button"
        onClick={() =>
          onZoomChange(Math.min(MAX_ZOOM, Number((zoom + STEP).toFixed(2))))
        }
        aria-label="Zoom in"
        className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-[#96a0b3] transition-colors hover:bg-[#222733] hover:text-white"
      >
        <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
      </button>
      <span className="min-w-[34px] text-right font-mono text-[10px] tabular-nums text-[#b8c2d4]">
        {Math.round(zoom * 100)}%
      </span>
    </div>
  );
}
