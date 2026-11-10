import { ExternalLink, Newspaper } from 'lucide-react';
import type { UiNewsData } from '@plum-code-webui/shared';
import { CarouselShell } from '../Carousel';
import { UiImg } from '../media';

const initial = (domain: string) =>
  domain
    .replace(/^www\./, '')
    .charAt(0)
    .toUpperCase() || '•';

/** Article carousel: preview image, publisher, date, headline; opens the article. */
export function News({ data }: { data: UiNewsData }) {
  return (
    <div className="dui-news">
      <header className="dui-live-head">
        <Newspaper size={15} aria-hidden />
        <span>Nachrichten zu „{data.query}“</span>
      </header>
      <CarouselShell
        label={`Nachrichten zu ${data.query}`}
        className="is-news"
        slides={data.articles.map((article) => (
          <a
            key={article.url}
            className="dui-slide is-action dui-news-card"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
          >
            <span className="dui-slide-media">
              <UiImg
                src={article.image}
                alt=""
                aspect="16 / 9"
                fallback={
                  <span className="dui-news-fallback" aria-hidden>
                    {initial(article.source)}
                  </span>
                }
              />
            </span>
            <span className="dui-slide-body">
              <span className="dui-news-source">
                <span className="dui-news-initial" aria-hidden>
                  {initial(article.source)}
                </span>
                {article.source}
                {article.date_text && <span className="dui-news-date"> · {article.date_text}</span>}
              </span>
              <span className="dui-slide-title dui-news-title">{article.title}</span>
              {article.excerpt && <span className="dui-news-excerpt">{article.excerpt}</span>}
            </span>
            <ExternalLink size={14} className="dui-slide-external" aria-hidden />
          </a>
        ))}
      />
    </div>
  );
}
