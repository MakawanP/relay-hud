"use client";

import clsx from "clsx";

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

export function ToggleSwitch({
  label,
  checked,
  disabled = false,
  onChange,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={clsx(
        "inline-flex min-h-6 items-center gap-2 rounded px-1 py-0.5 text-[10.5px] text-[#a2acc0] transition-colors hover:text-[#eef2f8]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={clsx(
          "relative inline-flex h-[15px] w-[28px] shrink-0 items-center rounded-full border transition-colors",
          checked
            ? "border-[#c7cdd8] bg-[#e6eaf0]"
            : "border-[#3a4252] bg-[#222733]",
        )}
      >
        <span
          className={clsx(
            "h-[11px] w-[11px] rounded-full transition-transform duration-200",
            checked
              ? "translate-x-[14px] bg-[#14171c]"
              : "translate-x-[1.5px] bg-[#8b95a8]",
          )}
        />
      </span>
    </button>
  );
}
