import { useState, type ReactNode } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import type {
  UiLiveDataMap,
  UiLiveNode,
  UiLiveNodeType,
  UiLiveSource,
  UiNodeOf,
  UiResult,
} from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import type { Ctx } from '../context';

const LABELS: Record<UiLiveNodeType, string> = {
  weather: 'Wetter',
  currency: 'Wechselkurs',
  stock: 'Kurs',
  entity: 'Steckbrief',
  news: 'Nachrichten',
  gallery: 'Bilder',
};

const bar = (width: string, height = 12, className?: string) => (
  <span className={cn('dui-sk', className)} style={{ width, height }} />
);

/** Placeholders at the final size of each widget, so nothing jumps on arrival. */
export function LiveSkeleton({ type }: { type: UiLiveNodeType }) {
  const label = `${LABELS[type]} wird geladen`;
  let body: ReactNode;
  switch (type) {
    case 'weather':
      body = (
        <>
          {bar('42%', 13)}
          <div className="dui-sk-row" style={{ marginTop: 18 }}>
            {bar('64px', 64, 'is-round')}
            <div className="dui-sk-col">
              {bar('120px', 40)}
              {bar('200px', 12)}
            </div>
          </div>
          {bar('210px', 32, 'is-pill')}
          {bar('100%', 150, 'is-block')}
          <div className="dui-sk-col">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="dui-sk-line">
                {bar('18%', 12)}
                {bar('22px', 22, 'is-round')}
                {bar('52%', 6, 'is-pill')}
              </span>
            ))}
          </div>
        </>
      );
      break;
    case 'stock':
      body = (
        <>
          {bar('38%', 13)}
          {bar('170px', 38)}
          {bar('140px', 13)}
          {bar('220px', 32, 'is-pill')}
          {bar('100%', 210, 'is-block')}
          <div className="dui-sk-grid">
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="dui-sk-col">
                {bar('60%', 10)}
                {bar('80%', 14)}
              </span>
            ))}
          </div>
        </>
      );
      break;
    case 'currency':
      body = (
        <>
          {bar('46%', 13)}
          <div className="dui-sk-row">
            {bar('100%', 64, 'is-block')}
            {bar('100%', 64, 'is-block')}
          </div>
          {bar('52%', 12)}
          {bar('100%', 96, 'is-block')}
        </>
      );
      break;
    case 'entity':
      body = (
        <div className="dui-sk-row">
          <div className="dui-sk-col" style={{ flex: 1 }}>
            {bar('55%', 20)}
            {bar('35%', 12)}
            {bar('100%', 11)}
            {bar('96%', 11)}
            {bar('80%', 11)}
          </div>
          {bar('112px', 112, 'is-block')}
        </div>
      );
      break;
    case 'news':
      body = (
        <div className="dui-sk-row is-scroll">
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="dui-sk-col dui-sk-card">
              {bar('100%', 128, 'is-block')}
              {bar('40%', 10)}
              {bar('92%', 13)}
              {bar('70%', 13)}
            </span>
          ))}
        </div>
      );
      break;
    case 'gallery':
      body = (
        <div className="dui-sk-gallery">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="dui-sk is-block" />
          ))}
        </div>
      );
      break;
  }
  return (
    <div className={cn('dui-live dui-skeleton', `is-${type}`)} role="status" aria-label={label}>
      {body}
      <span className="sr-only">{label} …</span>
    </div>
  );
}

const timeFormat = new Intl.DateTimeFormat('de-CH', { hour: '2-digit', minute: '2-digit' });

export function LiveSource({ source, fetchedAt }: { source?: UiLiveSource; fetchedAt?: string }) {
  if (!source) return null;
  const at = fetchedAt ? new Date(fetchedAt) : null;
  return (
    <p className="dui-live-source">
      Quelle:{' '}
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {source.name}
      </a>
      {at && !Number.isNaN(at.getTime()) && <> · Stand {timeFormat.format(at)}</>}
    </p>
  );
}

/**
 * Pending → skeleton at final size; failed → a quiet local note with
 * „Erneut versuchen“; resolved → the widget plus its source.
 */
export function LiveFrame<T extends UiLiveNodeType>({
  node,
  ctx,
  children,
}: {
  node: UiNodeOf<T>;
  ctx: Ctx;
  children: (data: UiLiveDataMap[T], result: UiResult<T>) => ReactNode;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const live = node as unknown as UiLiveNode;
  const type = live.type as T;
  const result = ctx.live(live) as UiResult<T> | undefined;
  const retry = async () => {
    if (!ctx.refresh) return;
    setRefreshing(true);
    setError('');
    try {
      await ctx.refresh(live.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Erneut versuchen fehlgeschlagen');
    } finally {
      setRefreshing(false);
    }
  };
  if (!result || result.status === 'pending' || refreshing) return <LiveSkeleton type={type} />;
  if (result.status === 'failed' || !result.data)
    return (
      <div className="dui-live-failed" role="status">
        <CloudOff size={16} aria-hidden />
        <span>
          {LABELS[type]}: {error || result.error || 'Die Daten sind gerade nicht verfügbar.'}
        </span>
        {result.retryable !== false && ctx.refresh && (
          <button type="button" className="dui-link-button" onClick={() => void retry()}>
            <RefreshCw size={13} aria-hidden />
            Erneut versuchen
          </button>
        )}
      </div>
    );
  return (
    <div className={cn('dui-live', `is-${type}`)}>
      {children(result.data, result)}
      <LiveSource source={result.data.source} fetchedAt={result.fetchedAt} />
    </div>
  );
}
