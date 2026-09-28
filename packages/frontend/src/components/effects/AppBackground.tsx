import { memo, useEffect, useRef } from 'react';
import type { BackgroundAnimation } from '@plum-code-webui/shared';
import { AuroraBackground } from '@/components/effects/AuroraBackground';
import { GalaxyStars } from '@/components/effects/GalaxyStars';
import { MistyWindowBackground } from '@/components/effects/MistyWindowBackground';
import { NeonGlowBackground } from '@/components/effects/NeonGlowBackground';
import { cn } from '@/lib/utils';

interface AppBackgroundProps {
  animation: BackgroundAnimation;
}

export const AppBackground = memo(function AppBackground({ animation }: AppBackgroundProps) {
  const backgroundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (animation === 'aurora' || animation === 'glass' || animation === 'ribbons') return;
    const syncPlayback = () =>
      backgroundRef.current?.classList.toggle('is-paused', document.hidden);
    document.addEventListener('visibilitychange', syncPlayback);
    syncPlayback();
    return () => document.removeEventListener('visibilitychange', syncPlayback);
  }, [animation]);

  if (animation === 'aurora') {
    return <AuroraBackground intensity="vivid" />;
  }

  if (animation === 'glass') {
    return <MistyWindowBackground />;
  }

  if (animation === 'ribbons') {
    return <NeonGlowBackground />;
  }

  return (
    <div
      ref={backgroundRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed inset-0 overflow-hidden plum-app-background',
        `plum-bg-${animation}`
      )}
      style={{ zIndex: 0 }}
    >
      <div className="plum-bg-sheet plum-bg-sheet-a" />
      <div className="plum-bg-sheet plum-bg-sheet-b" />
      <div className="plum-bg-line plum-bg-line-a" />
      <div className="plum-bg-special plum-bg-special-c" />
      <GalaxyStars />
      <div className="plum-bg-grain" />
    </div>
  );
});
