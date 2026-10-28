import { useEffect, useRef, useState } from 'react';
import { motionAllowed } from '../fx/effects';

/** Number that counts up from 0 with an ease-out (respects reduced motion). */
export function CountUp({ value, ms = 1100 }: { value: number; ms?: number }) {
  const [v, setV] = useState(motionAllowed() ? 0 : value);
  const from = useRef(0);
  useEffect(() => {
    if (!motionAllowed()) { setV(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 4);
      setV(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return <>{v}</>;
}
