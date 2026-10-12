import { useEffect, useRef, useState } from 'react';
/** No delivery command or network operation exists until the grace period expires. */
export function useNativeOrderDelay(scope: string) {
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const job = useRef<{ scope: string; deadline: number; execute: () => void } | null>(null);
  const [remaining, setRemaining] = useState(0);
  function cancel() {
    job.current = null;
    setRemaining(0);
  }
  useEffect(() => {
    cancel();
    const timer = window.setInterval(() => {
      const pending = job.current;
      if (!pending) return;
      if (pending.scope !== currentScope.current || document.hidden) {
        cancel();
        return;
      }
      const ms = pending.deadline - Date.now();
      if (ms > 0) {
        setRemaining(Math.ceil(ms / 1000));
        return;
      }
      job.current = null;
      setRemaining(0);
      pending.execute();
    }, 100);
    const hide = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      job.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [scope]);
  return {
    remaining,
    cancel,
    stage(execute: () => void) {
      if (job.current) return;
      job.current = { scope, deadline: Date.now() + 5000, execute };
      setRemaining(5);
    },
  };
}
