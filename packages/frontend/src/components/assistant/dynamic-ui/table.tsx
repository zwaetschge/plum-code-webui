import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Maximize2, Search } from 'lucide-react';
import { formatUiValue, tableSortable, type UiRow } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { isTruthy } from './runtime';
import { stagger, type Renderer } from './context';
import { downloadCsv, fileName, toCsv } from './download';
import { Fullscreen } from './media';

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

const compare = (a: unknown, b: unknown) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a).localeCompare(String(b), 'de-CH', { numeric: true });
};

/** Sortable columns, a search field from ten rows, CSV and full screen. */
export const Table: Renderer<'table'> = ({ node, ctx }) => {
  const rows = ctx.rt.source(node.data);
  const sortable = tableSortable(node, rows.length);
  const [sort, setSort] = useState<Sort>(null);
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('de-CH');
    let out = rows.map((row, index) => ({ row, index }));
    if (needle)
      out = out.filter(({ row }) =>
        node.columns.some((column) =>
          formatUiValue(row[column.key], column.format).toLocaleLowerCase('de-CH').includes(needle)
        )
      );
    if (sort) {
      const sign = sort.dir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => compare(a.row[sort.key], b.row[sort.key]) * sign);
    }
    return out;
  }, [rows, query, sort, node.columns]);
  const right = (key: string, align?: 'left' | 'right') =>
    align ? align === 'right' : typeof rows.find((row) => row[key] !== null)?.[key] === 'number';
  const cycle = (key: string) =>
    setSort((current) =>
      current?.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null
    );
  const csv = () =>
    downloadCsv(
      fileName(ctx.rt.spec.title, 'tabelle', 'csv'),
      toCsv(
        shown.map(({ row }) => row as UiRow),
        node.columns
      )
    );
  const tools = (
    <div className="dui-toolbar">
      <button type="button" className="dui-tool" onClick={csv} title="Als CSV herunterladen">
        <Download size={14} aria-hidden />
        <span>CSV</span>
      </button>
      {!full && (
        <button
          type="button"
          className="dui-tool"
          onClick={() => setFull(true)}
          aria-label="Tabelle vergrössern"
          title="Vergrössern"
        >
          <Maximize2 size={14} aria-hidden />
        </button>
      )}
    </div>
  );
  const table = (
    <div className="dui-table-wrap" role="region" aria-label="Tabelle" tabIndex={0}>
      <table className="dui-table">
        <thead>
          <tr>
            {node.columns.map((column) => {
              const active = sort?.key === column.key ? sort.dir : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(right(column.key, column.align) && 'is-right')}
                  aria-sort={
                    active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={cn('dui-sort', active && 'is-active')}
                      onClick={() => cycle(column.key)}
                    >
                      {column.label}
                      {active === 'asc' ? (
                        <ArrowUp size={12} aria-hidden />
                      ) : active === 'desc' ? (
                        <ArrowDown size={12} aria-hidden />
                      ) : (
                        <ArrowUpDown size={12} className="dui-sort-idle" aria-hidden />
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map(({ row, index }, position) => (
            <tr
              key={index}
              style={stagger(position)}
              className={cn(
                node.highlight &&
                  isTruthy(ctx.rt.with(row).safe(node.highlight)) &&
                  'is-highlighted'
              )}
            >
              {node.columns.map((column) => (
                <td key={column.key} className={cn(right(column.key, column.align) && 'is-right')}>
                  {formatUiValue(row[column.key], column.format)}
                </td>
              ))}
            </tr>
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={node.columns.length} className="dui-empty">
                {query ? 'Keine Treffer.' : 'Keine Einträge für diese Auswahl.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const head = (
    <div className="dui-table-head">
      {rows.length >= 10 ? (
        <label className="dui-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="In Tabelle suchen"
            aria-label="In Tabelle suchen"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : (
        <span className="dui-table-count">
          {rows.length} {rows.length === 1 ? 'Zeile' : 'Zeilen'}
        </span>
      )}
      {tools}
    </div>
  );
  return (
    <div className="dui-table-block">
      {head}
      {table}
      <Fullscreen open={full} title={ctx.rt.spec.title || 'Tabelle'} onClose={() => setFull(false)}>
        {full && (
          <div className="dui-table-block is-full">
            {head}
            {table}
          </div>
        )}
      </Fullscreen>
    </div>
  );
};
