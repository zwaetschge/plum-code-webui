import type { Renderer } from '../context';
import { EntityCard } from '../EntityCard';
import { Currency } from './Currency';
import { Gallery } from './Gallery';
import { LiveFrame } from './LiveFrame';
import { News } from './News';
import { Stock } from './Stock';
import { Weather } from './Weather';
import '../dynamic-ui-live.css';

/*
 * Live widgets: the server resolves the data (turn.uiResults); these
 * renderers only lay it out. Loaded as one lazy chunk with the line charts.
 */
export const WeatherNode: Renderer<'weather'> = ({ node, ctx }) => (
  <LiveFrame node={node} ctx={ctx}>
    {(data) => <Weather data={data} />}
  </LiveFrame>
);
export const CurrencyNode: Renderer<'currency'> = ({ node, ctx }) => (
  <LiveFrame node={node} ctx={ctx}>
    {(data) => <Currency key={`${data.from}-${data.to}-${data.amount}`} data={data} />}
  </LiveFrame>
);
export const StockNode: Renderer<'stock'> = ({ node, ctx }) => (
  <LiveFrame node={node} ctx={ctx}>
    {(data) => <Stock data={data} />}
  </LiveFrame>
);
export const EntityNode: Renderer<'entity'> = ({ node, ctx }) => (
  <LiveFrame node={node} ctx={ctx}>
    {(data) => <EntityCard data={data} />}
  </LiveFrame>
);
export const NewsNode: Renderer<'news'> = ({ node, ctx }) => (
  <LiveFrame node={node} ctx={ctx}>
    {(data) => <News data={data} />}
  </LiveFrame>
);
export const GalleryNode: Renderer<'gallery'> = ({ node, ctx }) => (
  <LiveFrame node={node} ctx={ctx}>
    {(data) => <Gallery data={data} />}
  </LiveFrame>
);
