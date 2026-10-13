'use client';
import { useEffect, useState } from 'react';

/**
 * Returns false during SSR and the first client render, then true. Gate any
 * output that depends on `Date.now()`, wallet state or live data behind this so
 * server and client produce identical first paint (no hydration mismatch).
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
