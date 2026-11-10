import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const dashboardSource = fs.readFileSync(
  path.join(frontendDir, 'src/pages/DashboardPage.tsx'),
  'utf8'
);
const layoutSource = fs.readFileSync(
  path.join(frontendDir, 'src/components/layout/Layout.tsx'),
  'utf8'
);
const styles = fs.readFileSync(path.join(frontendDir, 'src/index.css'), 'utf8');

assert.match(
  dashboardSource,
  /dashboard-start-composer dashboard-chatbar glass-chrome relative[\s\S]*?isComposerExpanded && 'is-composer-expanded'/,
  'the mobile dashboard should restore the compact launcher while preserving expanded drafts'
);
assert.match(
  styles,
  /@media \(max-width: 640px\)[\s\S]*?\.dashboard-composer-mobile-toggle\s*{\s*display: flex;/,
  'the previous compact mobile composer launcher should remain visible'
);
// The dashboard-only navigation rail gave way to one unified sidebar on
// 2026-10-14 (mode pill + per-mode lists): the overview gets the same desktop
// sidebar as every other page, without route-specific props.
assert.match(
  layoutSource,
  /\{isDesktopLayout && \(\s*<div className="hidden md:block relative z-10">\s*<Sidebar\s+contextUsage=\{isFullBleed \? headerUsage : undefined\}\s+contextStats=\{headerContextStats\}\s+contextSession=\{activeSession\}\s*\/>/,
  'the wide dashboard should share the unified sidebar instead of a dashboard-only rail'
);
assert.match(
  dashboardSource,
  /const isShowingCachedSessions = sessions\.length > 0 && \(!isOnline \|\| sessionsQuery\.isError\)/,
  'failed refreshes should keep and identify cached sessions'
);
assert.match(
  dashboardSource,
  /dashboard-session-card cursor-pointer[\s\S]*?role="link"[\s\S]*?aria-label={`Open session \$\{session\.name\}`}/,
  'session cards should retain the previous compact whole-card navigation'
);
assert.match(
  dashboardSource,
  /role="link"[\s\S]*?tabIndex={0}/,
  'whole-card navigation should remain keyboard accessible'
);
assert.match(
  dashboardSource,
  /group\.sessions\.map\(\(session\) =>/,
  'session groups should use the previous complete card grid'
);
assert.match(
  dashboardSource,
  /dashboard-session-unread[\s\S]*?unread.*message/,
  'session cards should expose the server-provided unread count'
);
assert.match(
  styles,
  /\.session-chat-layered > \.chat-scroll-shell\s*{[\s\S]*?bottom: 0;/,
  'the chat viewport should span the full height so the transcript scrolls behind the frosted composer'
);
assert.match(
  styles,
  /\.session-chat-layered \.chat-footer-stream\s*{\s*padding-bottom: calc\(var\(--chat-input-h, 112px\) \+ \d+px\);/,
  'the list footer should reserve the measured composer height'
);
assert.match(
  styles,
  /\.chat-jump-latest\s*{[\s\S]*?bottom: 12px;/,
  'the jump-to-latest action should sit inside the reserved viewport above the composer'
);

console.log('Dashboard UX regression tests passed.');
