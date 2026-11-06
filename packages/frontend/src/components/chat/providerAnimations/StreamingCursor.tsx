import type { UiProvider } from '@/lib/providers';

export function StreamingCursor({ provider }: { provider: UiProvider }) {
  switch (provider) {
    case 'codex':
      return <span className="pl-cursor-codex" aria-hidden="true" />;
    case 'claude':
    case 'plum':
    default:
      return <span className="pl-cursor-claude" aria-hidden="true" />;
  }
}

export function streamingContentClass(provider: UiProvider): string {
  // All providers now get a subtle trailing-edge fade so freshly-arriving
  // text eases in instead of popping. Provider-specific nuance is in the
  // cursor + cursor aura above, not in the stream mask itself.
  switch (provider) {
    case 'codex':
      return 'pl-stream-codex pl-stream-fade';
    case 'claude':
    case 'plum':
    default:
      return 'pl-stream-claude pl-stream-fade';
  }
}
