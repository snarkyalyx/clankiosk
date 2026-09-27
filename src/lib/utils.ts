import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtTokens(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T"
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(n)
}

export function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return "resetting…"
  const m = Math.floor(msLeft / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const min = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${min}m`
  return `${min}m`
}
