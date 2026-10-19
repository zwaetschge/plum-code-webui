# ChatGPT frontend inspection and Plum workspace direction

Date: 2026-10-19. Scope: inspect the actual signed-in ChatGPT interface in Firefox and use REA MCP on its shipped frontend assets before continuing the Plum redesign.

## Completed observations

- [x] Inspected the rendered new-chat surface and project navigation in Firefox.
- [x] Created one empty private test project, **Plum UI-Analyse**, to inspect its working page. No chat messages, uploads, or published GPTs were created. The project remains in the account.
- [x] Inspected the project **Chats** and **Quellen** tabs and the settings dialog without editing instructions or account settings.
- [x] Inspected `/gpts/mine` and the actual `/gpts/editor` page. The editor is a full page with configuration on the left and a chat preview on the right. Name, description, instructions, conversation starters, knowledge, recommended model, capabilities, and actions are visible.
- [x] Ran REA MCP `analyze_javascript_application` on public shipped project-creation, project-settings, and GPT-list modules, inspected retained evidence, and exported the full evidence bundle.

The project working page keeps its name, new-chat composer, chat list, and sources in one navigable workspace. Project settings are secondary. ChatGPT itself still uses dialogs for project creation and settings; the useful pattern is that daily project work happens on a dedicated page.

The inspected account displays a GPT-to-plugins migration notice in its GPT list. This is an observation of that account, not a claim about availability for every account. The old GPT editor remains reachable. Account memory was off; it was not enabled. The test project's settings displayed default memory and a non-changeable-state message. Static settings code includes additional gated branches; those branches were not exercised and do not establish runtime availability or server-side memory behaviour.

## REA evidence

Browser control used the Firefox MCP. REA performed **static analysis of the shipped JavaScript**, not live CDP browser observation. No server implementation, hidden conversation history, tokens, cookies, or hydration payloads were extracted.

- Project creation full retained evidence: `ev_9ab1a61f3f958bb934670c470e8446b5f740bc1ab538506adb41670756c42f21`.
- Project settings / GPT-list full retained evidence: `ev_a2efda00fa6bae58d5f9f5e6033a0f0b939e9ed6799642f8e87dd02c3eb9b6dc`.
- Static semantic observations include separate `gizmo.instructions` and `memoryScope` reads and the `project_v2` literal in the settings module. This supports separating instruction editing from context policy in our UI; it does not reveal the server's context selection algorithm.
- Application graph coverage is partial because shared dependencies were deliberately outside the selected source scope. The exploratory string trace returned no matches; that is not evidence that memory functionality is absent.
- Full exported evidence: `.logs/chatgpt-rea-20261019/evidence.json` (8 retained records, about 17 MB).
- Download URLs, exact SHA-256 identities and byte sizes: `.logs/chatgpt-rea-20261019/provenance.json`.
- Selected retained semantic nodes: `.logs/chatgpt-rea-20261019/project-settings-observations.json`.
- Screenshots without private chat history: `.screenshots/chatgpt-project-main.png` and `.screenshots/chatgpt-gpt-editor.png`.

REA initially failed because BusyBox `ps` lacked its required process-list options. Installed `procps-ng` in the running Geekom container using the existing authorised SSH connection, then analysis succeeded. The Dockerfile now also declares this small dependency; the site release must retain it across image recreation. No MCP registration or main-container restart was performed.

## Plum product direction

The user's desired semantics take precedence over copying ChatGPT limitations:

1. **Projects get a dedicated working page.** Project title and context mode remain visible, with a direct start-chat action, expert choice, existing conversations and sources. Opening a conversation preserves its project and expert binding.
2. **Experts are reusable across projects.** Give each an own page/editor for system prompt, model preference, knowledge and explicitly maintained shared memories. An expert is not another project folder.
3. **Project context is an explicit choice:** shared context between its conversations, or separate conversation histories. Instructions and explicitly assigned knowledge still apply in either mode. Expert-level shared notes remain visible as a separate source of context.
4. **Creation and editing use normal page navigation.** Avoid the current management-dialog-inside-chat workflow. Use ordinary links, browser Back, and matching Android back navigation.
5. **Primary flow:** open a project → choose a prompt expert → continue its matching conversation or start a new chat. No obligatory setup popup in that path.

## Remaining implementation todo

- [x] Replace the WebUI popup manager with reachable project/expert list, detail and editor routes; update sidebar and library entry points.
- [x] Keep project/expert context visible in new and existing chat views; honour preferred models from expert deep links.
- [x] Implement matching full-screen Android navigation and the same project/expert selection semantics.
- [x] Complete backend context modes and expert notes. Project-bound automatic memories now follow the explicit chat project; separate conversations do not feed shared recall.
- [x] Verify account isolation, shared/separate history, expert notes and ownership with the existing backend integration suite.
- [x] Inspect rendered desktop and narrow WebUI paths, including the wider mobile expert selector.
- [ ] Build Android through android-builder and verify/copy the APK. Installation remains separately authorised.
- [ ] Roll out through the production Geekom repair-bot path, preserving unrelated working-tree edits.

Research completed first, then implementation continued in this same task. Rollout and APK evidence are recorded below when verified. Existing `AGENTS.md` and `utils/piConfig.ts` changes belong to other work and must be preserved.

## Implementation progress

- WebUI routes: `/chat/projects`, `/chat/projects/:id`, `/chat/projects/:id/edit` and the equivalent `/chat/assistants` routes. Creation uses `/new`. Sources edit inline within the project working page, with URL state and browser Back. Legacy workspace and project/profile library links redirect to the new pages.
- Existing chat view now shows its project, expert and project context mode with links back. New-chat deep links honour the expert's preferred API model.
- Android `ChatWorkspaceScreen` replaces the modal sheet, with list/detail/editor navigation, system Back, project chat filtering, sources, context choice, expert notes and a dedicated new-chat action that does not reassign the existing conversation.
- Backend API chat integration suite passes, including live notes versus pinned instructions, cross-owner/project, archived/temporary exclusions and switching shared/separate context. Long-term memory regression: 38 checks pass.
- Final WebUI browser journeys pass at 1440/390px, including browser Back and legacy library redirects, with no dialogs, JavaScript errors or horizontal overflow. Screenshot inspection prompted a wider mobile expert selector. Both typechecks pass. Android build and production rollout remain in progress.
