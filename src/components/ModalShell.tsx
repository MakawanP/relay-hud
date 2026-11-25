"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalShellProps {
  open: boolean;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  onClose: () => void;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalShell({
  open,
  title,
  subtitle,
  maxWidthClass = "max-w-3xl",
  onClose,
  children,
}: ModalShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelRef.current;
    if (panel) {
      const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstFocusable ?? panel).focus();
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (openerRef.current && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-xl border border-[#2a303d] bg-[#14171d] shadow-[0_24px_80px_rgba(0,0,0,0.65)] ${maxWidthClass}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#222732] px-5 py-3.5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[14px] font-semibold text-[#eef2f8]"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[11.5px] text-[#96a0b3]">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-md border border-[#282e3b] bg-[#1a1e27] p-1.5 text-[#9aa4b6] transition-colors hover:border-[#3b4354] hover:text-white"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
