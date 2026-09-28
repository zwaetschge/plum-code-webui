import { memo, useEffect, useRef } from 'react';
import type { NeonSceneController } from './neonScene';

/** Loads WebGL only while Neon Glow is selected; the image is its static fallback. */
export const NeonGlowBackground = memo(function NeonGlowBackground() {
  const backgroundRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const background = backgroundRef.current;
    const canvas = canvasRef.current;
    if (!background || !canvas) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let scene: NeonSceneController | undefined;
    let generation = 0;

    const syncVisibility = () => {
      background.classList.toggle('is-paused', document.hidden);
      scene?.setVisible(!document.hidden);
    };

    const syncScene = async () => {
      const currentGeneration = ++generation;
      const isEink = document.documentElement.classList.contains('eink');
      if (motionQuery.matches || isEink) {
        scene?.dispose();
        scene = undefined;
        background.classList.remove('is-three-ready');
        return;
      }

      if (scene) {
        scene.setLight(document.documentElement.classList.contains('light'));
        return;
      }

      try {
        const { startNeonScene } = await import('./neonScene');
        if (generation !== currentGeneration || motionQuery.matches) return;
        scene = startNeonScene(canvas, {
          light: document.documentElement.classList.contains('light'),
          onFirstFrame: () => background.classList.add('is-three-ready'),
        });
        scene.setVisible(!document.hidden);
      } catch (error) {
        // WebGL can be disabled or unavailable. Keep the photographed fallback.
        console.warn('Neon Glow WebGL fallback:', error);
      }
    };

    const observer = new MutationObserver(() => {
      void syncScene();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    motionQuery.addEventListener('change', syncScene);
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    void syncScene();

    return () => {
      generation += 1;
      observer.disconnect();
      motionQuery.removeEventListener('change', syncScene);
      document.removeEventListener('visibilitychange', syncVisibility);
      scene?.dispose();
    };
  }, []);

  return (
    <div
      ref={backgroundRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden neon-glow-backdrop"
      style={{ zIndex: 0 }}
    >
      <div className="neon-glow-image" />
      <canvas ref={canvasRef} className="neon-glow-canvas" />
      <div className="neon-glow-atmosphere" />
      <div className="neon-glow-reflection" />
      <div className="neon-glow-vignette" />
    </div>
  );
});
