"use client";

import { getProviderAccentHex } from "@/domain/connectors";
import type { ProviderKind } from "@/domain/types";

export function ProviderGlyph({
  provider,
  slotIndex = 1,
  presetId,
  size = 16,
}: {
  provider: ProviderKind;
  slotIndex?: number;
  presetId?: string | null;
  size?: number;
}) {
  const accent = getProviderAccentHex(provider, slotIndex, presetId);

  if (provider === "google") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="1.5"
          y="1.5"
          width="17"
          height="17"
          rx="4.5"
          fill="#182230"
          stroke={accent}
          strokeWidth="1.2"
        />
        <path
          d="M10 4.5C10.55 7.45 12.55 9.45 15.5 10C12.55 10.55 10.55 12.55 10 15.5C9.45 12.55 7.45 10.55 4.5 10C7.45 9.45 9.45 7.45 10 4.5Z"
          fill={accent}
        />
      </svg>
    );
  }

  if (provider === "anthropic") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="1.5"
          y="1.5"
          width="17"
          height="17"
          rx="4.5"
          fill="#271b16"
          stroke={accent}
          strokeWidth="1.2"
        />
        <path
          d="M10 4.6V15.4M4.6 10H15.4M6.2 6.2L13.8 13.8M13.8 6.2L6.2 13.8"
          stroke={accent}
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="1.5"
        y="1.5"
        width="17"
        height="17"
        rx="4.5"
        fill="#13211e"
        stroke={accent}
        strokeWidth="1.2"
      />
      <polygon
        points="10,4.6 14.7,7.3 14.7,12.7 10,15.4 5.3,12.7 5.3,7.3"
        stroke={accent}
        strokeWidth="1.35"
        fill="none"
      />
      <circle cx="10" cy="10" r="1.9" fill={accent} />
    </svg>
  );
}
