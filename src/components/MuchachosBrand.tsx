"use client";

import React from "react";

interface MuchachosSymbolProps {
  className?: string;
  size?: number | string;
  color?: string; // stroke/fill color, defaults to currentColor or #E11D2A
}

/**
 * Pixel-accurate SVG reproduction of the authentic MUCHACHOS storefront logo:
 * - Playful "YumYum!" text
 * - Friendly curved tongue arch
 * - Wide joyful smile with cheek dimples
 */
export function MuchachosSymbol({
  className = "",
  size = 36,
  color,
}: MuchachosSymbolProps) {
  const strokeColor = color || "currentColor";

  return (
    <svg
      width={size}
      height={typeof size === "number" ? Math.round((size * 84) / 120) : "auto"}
      viewBox="0 0 120 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className}`}
      aria-label="Muchachos Logo Symbol"
    >
      {/* "YumYum!" script lettering above the tongue */}
      <text
        x="60"
        y="19"
        textAnchor="middle"
        fill={strokeColor}
        fontFamily="'Brush Script MT', 'Comic Sans MS', cursive, sans-serif"
        fontWeight="900"
        fontSize="17"
        fontStyle="italic"
        letterSpacing="0.5"
      >
        YumYum!
      </text>

      {/* Tongue arch */}
      <path
        d="M 43 56 C 43 30, 77 30, 77 56"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Tongue vertical crease line */}
      <path
        d="M 60 37 L 60 52"
        stroke={strokeColor}
        strokeWidth="3.5"
        strokeLinecap="round"
      />

      {/* Smile cheek dots */}
      <circle cx="15" cy="36" r="4" fill={strokeColor} />
      <circle cx="105" cy="36" r="4" fill={strokeColor} />

      {/* Wide smile curve looping below tongue */}
      <path
        d="M 15 38 C 22 70, 43 65, 60 65 C 77 65, 98 70, 105 38"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

interface MuchachosBrandProps {
  variant?: "signboard" | "inline" | "stacked" | "icon";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  subtitle?: string; // e.g. "POS", "OWNER PORTAL", "KDS"
  showTagline?: boolean;
  className?: string;
}

/**
 * Unified Muchachos Brand Component
 * Replicates the authentic physical storefront identity:
 * - Brand Red: #E11D2A / #DC2626
 * - Font: MUCHACHOS
 * - Tagline: "An Oasis Of Taste"
 */
export default function MuchachosBrand({
  variant = "inline",
  size = "md",
  subtitle,
  showTagline = true,
  className = "",
}: MuchachosBrandProps) {
  // Signboard badge variant: mimics the glowing red storefront sign
  if (variant === "signboard") {
    return (
      <div
        className={`inline-flex items-center gap-3 bg-[#E11D2A] text-white px-4 py-2 rounded-2xl shadow-lg border-2 border-red-500/40 select-none ${className}`}
      >
        <MuchachosSymbol size={38} color="#FFFFFF" />
        <div className="flex flex-col items-center leading-none">
          <div className="flex items-center gap-1.5">
            <span className="font-black text-xl sm:text-2xl tracking-wider text-white uppercase drop-shadow-sm font-sans">
              MUCHACHOS
            </span>
            {subtitle && (
              <span className="bg-white/20 text-white font-black text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider">
                {subtitle}
              </span>
            )}
          </div>
          {showTagline && (
            <span className="text-[11px] font-serif italic text-white/95 tracking-wide mt-0.5">
              An Oasis Of Taste
            </span>
          )}
        </div>
      </div>
    );
  }

  // Icon only variant
  if (variant === "icon") {
    const iconSize = size === "xs" ? 22 : size === "sm" ? 28 : size === "lg" ? 44 : 34;
    return (
      <div
        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center shadow-sm shrink-0 border border-red-400/40 p-1.5 ${className}`}
        title="Muchachos - An Oasis Of Taste"
      >
        <MuchachosSymbol size={iconSize} color="#FFFFFF" />
      </div>
    );
  }

  // Size styling maps
  const titleSize =
    size === "xs"
      ? "text-sm sm:text-base"
      : size === "sm"
      ? "text-base sm:text-lg"
      : size === "lg"
      ? "text-2xl sm:text-3xl"
      : size === "xl"
      ? "text-3xl sm:text-4xl"
      : "text-lg sm:text-xl";

  const symbolSize =
    size === "xs" ? 26 : size === "sm" ? 30 : size === "lg" ? 44 : size === "xl" ? 54 : 34;

  const taglineSize =
    size === "xs"
      ? "text-[9px]"
      : size === "sm"
      ? "text-[10px]"
      : size === "lg"
      ? "text-xs"
      : size === "xl"
      ? "text-sm"
      : "text-[11px]";

  // Stacked variant
  if (variant === "stacked") {
    return (
      <div className={`flex flex-col items-center text-center select-none ${className}`}>
        <div className="w-12 h-12 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center shadow-md mb-2 p-2 border border-red-400/40">
          <MuchachosSymbol size={36} color="#FFFFFF" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`font-black tracking-tight text-[#E11D2A] dark:text-red-400 uppercase ${titleSize}`}>
            MUCHACHOS
          </span>
          {subtitle && (
            <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-[#E11D2A]/10 text-[#E11D2A] dark:bg-red-950/60 dark:text-red-300 border border-red-500/20">
              {subtitle}
            </span>
          )}
        </div>
        {showTagline && (
          <span className={`font-serif italic text-mutedForeground tracking-wide mt-0.5 ${taglineSize}`}>
            An Oasis Of Taste
          </span>
        )}
      </div>
    );
  }

  // Default: Responsive Inline Header variant
  return (
    <div className={`flex items-center gap-2.5 sm:gap-3 select-none ${className}`}>
      {/* Brand Icon with authentic red background */}
      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center shadow-sm shrink-0 border border-red-400/40 p-1.5">
        <MuchachosSymbol size={symbolSize} color="#FFFFFF" />
      </div>

      <div className="flex flex-col leading-tight">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className={`font-black tracking-tight text-[#E11D2A] dark:text-red-400 uppercase leading-none ${titleSize}`}>
            MUCHACHOS
          </span>
          {subtitle && (
            <span className="text-[10px] sm:text-[11px] font-black uppercase px-1.5 py-0.5 rounded-md bg-[#E11D2A]/10 text-[#E11D2A] dark:bg-red-950/60 dark:text-red-300 border border-red-500/20 leading-none">
              {subtitle}
            </span>
          )}
        </div>
        {showTagline && (
          <span className={`font-serif italic text-slate-500 dark:text-slate-400 tracking-wide mt-0.5 ${taglineSize}`}>
            An Oasis Of Taste
          </span>
        )}
      </div>
    </div>
  );
}
