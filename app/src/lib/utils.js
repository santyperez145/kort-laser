import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Une clases resolviendo los conflictos de Tailwind (la última gana). */
export function cn(...clases) {
  return twMerge(clsx(clases));
}
