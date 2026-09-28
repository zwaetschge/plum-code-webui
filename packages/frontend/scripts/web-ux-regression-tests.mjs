import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const search = read('../src/components/session/MessageSearch.tsx');
const globalSearch = read('../src/components/search/GlobalMessageSearchDialog.tsx');
const session = read('../src/pages/SessionPage.tsx');
const dashboard = read('../src/pages/DashboardPage.tsx');
const layout = read('../src/components/layout/Layout.tsx');
const sidebar = read('../src/components/layout/Sidebar.tsx');
const socket = read('../src/services/socket.ts');
const composer = read('../src/components/chat/ChatInput.tsx');
const styles = read('../src/index.css');
const providers = read('../src/lib/providers.ts');
const providerLogo = read('../src/components/branding/ProviderLogo.tsx');
const providerLogins = read('../src/components/settings/ProviderLoginsPanel.tsx');

assert.match(search, /messages\/search\?\$\{params\}/);
assert.match(search, /getContextSnippet[\s\S]*?<HighlightedSnippet/);
assert.match(search, /role="listbox"[\s\S]*?role="option"/);
assert.match(globalSearch, /event\.shiftKey[\s\S]*?setOpen\(true\)/);
assert.match(
  globalSearch,
  /navigate\(`\/session\/\$\{target\.sessionId\}\?\$\{params\.toString\(\)\}`\)/
);
assert.match(session, /MESSAGE_JUMP_WINDOW_SIZE = 160/);
// Claude Code reports the bare model id for both context variants; the model
// label must keep the selected `[1m]` variant instead of reading "200k".
assert.match(session, /runtimeModel === intended\.replace\(\/\\\[1m\\\]\$\/i, ''\)/);
assert.match(session, /around: target\.messageId/);
assert.match(session, /chat-message-\$\{messageId\}/);

assert.match(sidebar, /const isCollapsed = mobile \? false : navigationOnly \? true : collapsed/);
assert.match(layout, /<header className="mobile-app-header md:hidden flex h-14/);
assert.match(session, /session-right-dock session-content-dock hidden lg:flex/);
assert.match(session, /createPortal\(/);
assert.match(layout, /SessionMenuContext.Provider/);
assert.doesNotMatch(session, /<nav className="session-right-menu/);

assert.match(dashboard, /isComposerExpanded && 'is-composer-expanded'/);
assert.match(dashboard, /group\.sessions\.map\(\(session\) =>/);
assert.match(dashboard, /dashboard-session-card cursor-pointer[\s\S]*?role="link"/);

assert.match(
  composer,
  /composer-bubble-button is-followup[\s\S]*?activeFollowupMode === 'steer'[\s\S]*?'Steering' : 'Follow-up'/
);
assert.match(composer, /const showActiveFollowupButton = !!isActive && !!activeFollowupMode/);
assert.match(composer, /queued-locally/);
assert.match(composer, /uploadAbortRef\.current\?\.abort\(\)/);
assert.match(composer, /chat-attachment-progress[\s\S]*?role="progressbar"/);
assert.match(socket, /OUTBOX_STORAGE_KEY = 'plum\.chat\.outbox\.v1'/);
assert.match(socket, /uploadIds/);
assert.match(socket, /Content-Range/);
assert.match(socket, /X-Chunk-SHA256/);
assert.match(socket, /for \(let attempt = 1; attempt <= 3; attempt \+= 1\)/);
assert.match(socket, /currentUpload\.missingChunks/);
assert.match(socket, /title: 'Queued message was not sent'/);
assert.match(socket, /title: 'Message is still waiting to send'/);
assert.match(socket, /lastSequence/);

assert.match(
  styles,
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration: 0\.01ms !important/
);
assert.match(styles, /:where\(a, button, input, textarea, select/);
assert.match(styles, /\.is-search-highlighted/);
assert.match(styles, /\.dashboard-session-unread,[\s\S]*?\.sidebar-session-unread/);

// Mistral Vibe is a real harness, so it needs an entry in every exhaustive
// provider map instead of silently falling back to the Plum/Codex defaults.
assert.match(providers, /export type UiProvider = [^\n]*'kimi' \| 'vibe';/);
assert.match(providers, /CLI_PROVIDER_LABEL[\s\S]{0,300}vibe: 'Mistral Vibe',/);
assert.match(providers, /CLI_PROVIDER_ICON[\s\S]{0,300}vibe: '🧡',/);
assert.match(providers, /CLI_PROVIDER_DEFAULT_MODEL[\s\S]{0,400}vibe: 'mistral-medium-3\.5',/);
// Vibe turns carry a bare `mistral-*` model id, so the plan they spend must be
// resolved from the harness and not from the model prefix.
assert.match(providers, /if \(cliProvider === 'vibe'\) return 'vibe';/);
assert.match(providerLogo, /provider === 'vibe'/);

// Vibe calls its reasoning levels "Thinking" and accepts off/low/medium/high/max.
assert.match(
  session,
  /if \(sessionProvider === 'vibe'\) \{[\s\S]{0,260}\{ value: 'off', label: 'Off' \}/
);
assert.match(session, /sessionProvider === 'vibe'\s*\?\s*'Thinking'/);
assert.match(session, /'opencode', 'pi', 'vibe'\]\.includes\(/);

// Sign-in: the shared cli-login dialog plus the write-only key field.
assert.match(providerLogins, /DEVICE_LOGIN = new Set\(\['codex', 'claude', 'kimi', 'vibe'\]\)/);
assert.match(providerLogins, /api\.post\('\/api\/cli-login\/vibe\/key'/);
assert.match(providerLogins, /api\.delete\('\/api\/cli-login\/vibe\/key'\)/);
assert.match(providerLogins, /Vibe-Code-Kontingent \(255 EUR\/Monat\)/);

console.log('Web UX regression tests passed.');
