import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Merge Tailwind class lists with conflict resolution (clsx → tailwind-merge).
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
