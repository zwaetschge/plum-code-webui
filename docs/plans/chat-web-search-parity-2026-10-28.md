# Plum Chat web search on par with Claude / ChatGPT (2026-10-28)

User goal: web search in Plum Chat (`/chat`, API model chats) should feel like Claude's or ChatGPT's: the model searches on its own when a question needs current or verifiable facts, reads the best pages, answers with inline numbered citations, and the answer shows its sources. Must work for every chat model (GLM, DeepSeek, Mistral, Anthropic, Strata) because it is a Plum tool, not a provider feature.

## Backend (`packages/backend/src/services/assistant`)

Search backend stays SearXNG (`PLUM_SEARXNG_URL`, JSON API) with the Bing page fallback (`chatTools.ts`).

### Tools

`web_search` parameters:
- `query` (string, required, ≤ 500)
- `recency` (optional): `day | week | month | year` → SearXNG `time_range`
- `topic` (optional): `general | news` → SearXNG `categories`

`web_search` result:
```json
{
  "query": "…",
  "results": [{ "ref": 1, "title": "…", "url": "https://…", "domain": "srf.ch", "excerpt": "…", "publishedAt": "2026-10-27T…" | null }],
  "pages": [{ "ref": 1, "url": "https://…", "title": "…", "text": "main text, ≤ 4000 chars" }],
  "retrievedAt": "…"
}
```
Up to 8 results. The top 3 results are read in parallel right away (`pages`, via the existing `fetchPublicSource`, public-URL boundary unchanged, per-page timeout, failures simply omitted) so the model can answer without extra round trips.

`web_fetch` result gains `ref` (same numbering) next to `title`, `url`, `text`.

### Turn-wide source numbering

`ref` numbers are stable for the whole turn: the same URL keeps its number across several searches and fetches; new URLs get the next number. The registry lives with the turn being generated (chatGeneration / chatToolset call path) and is persisted on the turn as:

```ts
// packages/shared/src/types/assistant.ts, AssistantApiTurn
webSources?: Array<{
  ref: number;
  url: string;
  title: string;
  domain: string;          // hostname without leading "www."
  excerpt: string;         // ≤ 300 chars, plain text
  publishedAt: string | null;
  read: boolean;           // page text was fetched (auto-read or web_fetch)
}>;
```
It is updated while the turn streams (same channel/persist path as `toolEvents`) so clients can show sources before the answer finishes.

### Prompt (apiChats.ts system part, English like the rest)

- Current date and time with timezone (Europe/Zurich), so "today/latest" questions are grounded.
- When `web_search` is available: use it whenever the answer depends on current, local, niche or verifiable facts; run several focused queries for complex questions; use `recency`/`topic: news` for current events; read pages with `web_fetch` when excerpts are not enough; do not search for pure chat, writing or reasoning tasks.
- Citations: put `[n](URL)` right after the sentence it supports, using the `ref` number and exact URL from tool results; never invent refs or URLs; no separate source list in the text (the UI shows it).
- Replace the old "cite with the actual returned HTTPS URL" wording accordingly; document citations stay as they are.

### Default

Web search is on by default for new chats (the model decides when to use it). The existing per-chat toggle and the personalization preference still switch it off. Existing chats keep their stored option.

## WebUI (`packages/frontend`)

- Inline citations: in assistant text, a markdown link whose URL matches one of the turn's `webSources` renders as a compact chip (domain, or `domain +N` when several adjacent refs) instead of a plain link; hover/focus shows title, domain, date and excerpt; click opens the URL in a new tab.
- Sources row under the answer: „Quellen“ with count; compact cards (title, domain, date), cited ones first; expands to all. Only when `webSources` is non-empty.
- Search activity: web tool events render as one line like „Web durchsucht · 2 Suchen · 9 Quellen“ with the queries (and running state while streaming) instead of the generic „Werkzeuge“ block; other tools keep the existing block.
- No external favicon requests (privacy/CSP); use a neutral globe icon or the domain initial.
- Default toggle state follows the backend default.

## Android (`packages/android`)

Same three elements in the Plum Chat screen (`AssistantModelChat.kt` and its markdown rendering): citation chips for links matching `webSources`, a „Quellen“ row/sheet with cards, and the compact search-activity line. German UI strings with umlauts, no helper copy.

## Working rules

Other sessions edit this repo concurrently: targeted edits only, never revert foreign changes, no `git checkout/stash/reset`, no commits. Work under `/mnt/cache/appdata/claude-code-webui`. Deploy is done by the coordinating session.
