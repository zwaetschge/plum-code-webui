'use strict';

/* Chat panel: one Plum session's conversation inside the browser, like the chat
 * in Claude's browser extension. History and live events come from Plum over
 * the extension's bridge socket (see chatRelay.ts on the server); sending,
 * stopping, approvals and questions go back the same way.
 */

const CHAT_PAGE_ID = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------- markdown (safe, DOM only)

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function renderInline(parent, text) {
  let last = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > last) parent.append(text.slice(last, match.index));
    const [token] = match;
    if (match[1]) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (match[2]) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else {
      const link = document.createElement('a');
      const label = match[3] ? token.slice(1, token.indexOf('](')) : token;
      link.href = match[4] || token;
      link.textContent = label;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      parent.append(link);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function renderMarkdown(container, source) {
  container.replaceChildren();
  const parts = String(source || '').split(/^```[^\n]*\n?/m);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = part.replace(/\n$/, '');
      pre.append(code);
      container.append(pre);
      return;
    }
    for (const block of part.split(/\n{2,}/)) {
      const trimmed = block.replace(/^\n+|\n+$/g, '');
      if (!trimmed) continue;
      const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
      const node = document.createElement(heading ? 'h4' : 'p');
      const lines = (heading ? heading[2] : trimmed).split('\n');
      lines.forEach((line, lineIndex) => {
        if (lineIndex) node.append(document.createElement('br'));
        renderInline(node, line);
      });
      container.append(node);
    }
  });
}

// ---------------------------------------------------------------- chat view

function plumMountChat(
  root,
  { onSwitch, onOpenInPlum, onHandOver, onRecord, onGuide, decorate } = {}
) {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (label, className, onClick, title) => {
    const node = el('button', className, label);
    node.type = 'button';
    if (title) node.title = title;
    node.addEventListener('click', onClick);
    return node;
  };

  const view = {
    session: null,
    busy: false,
    thinking: false,
    activity: '',
    streaming: null, // { bubble, body, text }
    tools: new Map(), // toolId → row
    pending: new Map(), // clientMessageId → bubble
    cards: new Map(), // requestId → card
    sentTexts: new Set(), // own messages, in case the echo lacks our id
  };

  root.classList.add('chat');
  const head = el('header', 'chat-head glass');
  const switcher = button('', 'chat-switch', () => onSwitch && onSwitch(), 'Session wechseln');
  const switchName = el('span', 'chat-name');
  const switchMeta = el('span', 'chat-meta');
  const switchText = el('span', 'chat-switch-text');
  switchText.append(switchName, switchMeta);
  switcher.append(switchText, el('span', 'chat-caret', '▾'));
  const headActions = el('span', 'chat-head-actions');
  const speakToggle = button('🔈', 'icon', () => setSpeak(!view.speak), 'Antworten vorlesen');
  speakToggle.setAttribute('aria-pressed', 'false');
  headActions.append(
    speakToggle,
    button('⇲', 'icon', () => onHandOver && onHandOver(view.session), 'Aktuellen Tab übergeben'),
    button('↗', 'icon', () => onOpenInPlum && onOpenInPlum(view.session), 'In Plum öffnen')
  );
  head.append(switcher, headActions);

  const log = el('div', 'chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  const activity = el('p', 'chat-activity');
  activity.hidden = true;

  const form = el('form', 'composer glass');
  const input = el('textarea');
  input.rows = 1;
  input.placeholder = 'Nachricht an die Session …';
  input.setAttribute('aria-label', 'Nachricht');
  const send = el('button', 'primary send', 'Senden');
  send.type = 'submit';
  const stop = button('Stopp', 'danger stop', () => interrupt(), 'Aktuellen Durchlauf abbrechen');
  stop.hidden = true;
  const formActions = el('div', 'composer-actions');
  const hint = el('span', 'composer-hint', 'Enter senden · Shift+Enter Zeile');
  const mic = button(
    '🎙',
    'mic',
    () => void toggleMic(),
    'Diktieren (nochmal klicken zum Beenden)'
  );
  mic.setAttribute('aria-label', 'Diktieren');
  formActions.append(hint, mic, stop, send);
  form.append(input, formActions);

  // Tutorial modes: the user demonstrates (recording) or the agent coaches (guide).
  const modes = el('div', 'chat-modes');
  const recordButton = button(
    '● Vorführen',
    'mode-toggle record',
    () => onRecord && onRecord('toggle'),
    'Du führst etwas im Browser vor; Plum zeichnet die Schritte mit Screenshots auf und schickt sie der Session zum Lernen.'
  );
  const guideButton = button(
    '✎ Anleiten',
    'mode-toggle guide',
    () => onGuide && onGuide(),
    'Plum sieht deinen aktiven Tab und zeigt dir mit Cursor, Markierungen und Stift, was zu tun ist – klicken musst du selbst.'
  );
  recordButton.setAttribute('aria-pressed', 'false');
  guideButton.setAttribute('aria-pressed', 'false');
  modes.append(recordButton, guideButton);
  const modeBanner = el('div', 'mode-banner');
  modeBanner.hidden = true;

  root.replaceChildren(head, modes, modeBanner, log, activity, form);

  // ------------------------------------------------------------ helpers

  const call = async (message) => {
    const reply = await browser.runtime.sendMessage(message);
    if (!reply || !reply.ok) throw new Error((reply && reply.error) || 'Keine Antwort');
    return reply.data;
  };
  const rpc = (method, params) => call({ plumRpc: method, params });

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const scrollDown = (force) => {
    if (force || nearBottom()) log.scrollTop = log.scrollHeight;
  };

  function note(text, kind = '') {
    const row = el('p', `chat-note ${kind}`, text);
    const stick = nearBottom();
    log.append(row);
    scrollDown(stick);
    return row;
  }

  function bubble(role, content) {
    const wrap = el('div', `bubble ${role}`);
    const body = el('div', 'bubble-body');
    if (role === 'assistant') renderMarkdown(body, content);
    else body.textContent = content;
    wrap.append(body);
    const stick = nearBottom();
    log.append(wrap);
    scrollDown(stick);
    return { wrap, body };
  }

  function renderHead() {
    const session = view.session;
    switchName.textContent = session ? session.name : 'Session wählen';
    const parts = [];
    if (session) {
      parts.push(session.providerName || session.provider);
      if (session.modelLabel || session.model) parts.push(session.modelLabel || session.model);
    }
    switchMeta.textContent = parts.join(' · ');
  }

  function renderActivity() {
    const text = view.thinking ? 'denkt …' : view.busy ? view.activity || 'arbeitet …' : '';
    activity.textContent = text;
    activity.hidden = !text;
    stop.hidden = !view.busy;
    send.textContent = view.busy ? 'Einreihen' : 'Senden';
  }

  function setBusy(busy) {
    view.busy = !!busy;
    if (!view.busy) view.thinking = false;
    renderActivity();
  }

  // ------------------------------------------------------------ streaming + tools

  function streamDelta(delta) {
    if (!view.streaming) {
      const created = bubble('assistant', '');
      created.wrap.classList.add('streaming');
      view.streaming = { ...created, text: '' };
    }
    view.streaming.text += delta;
    const stick = nearBottom();
    renderMarkdown(view.streaming.body, view.streaming.text);
    scrollDown(stick);
  }

  // ------------------------------------------------------------ voice

  function speak(text) {
    if (!view.speak || !('speechSynthesis' in window) || !text) return;
    const plain = String(text)
      .replace(/```[\s\S]*?```/g, ' Codeblock. ')
      .replace(/[*_`#>]/g, '')
      .replace(/https?:\/\/\S+/g, 'Link')
      .slice(0, 1200);
    const utterance = new SpeechSynthesisUtterance(plain);
    utterance.lang = navigator.language || 'de-DE';
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  function setSpeak(on) {
    view.speak = !!on;
    speakToggle.textContent = view.speak ? '🔊' : '🔈';
    speakToggle.setAttribute('aria-pressed', String(view.speak));
    if (!view.speak && 'speechSynthesis' in window) speechSynthesis.cancel();
    void browser.storage.local.set({ speakReplies: view.speak });
  }
  void browser.storage.local
    .get('speakReplies')
    .then(({ speakReplies }) => setSpeak(!!speakReplies));

  let recorder = null;
  async function toggleMic() {
    if (recorder) {
      recorder.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      // Chrome's side panel cannot show the permission prompt; a tab can.
      note(
        'Mikrofon nicht freigegeben – ich öffne einen Tab zum Erlauben, danach nochmal 🎙.',
        'error'
      );
      void browser.tabs.create({ url: browser.runtime.getURL('panel.html?grantMic=1') });
      return;
    }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.addEventListener('dataavailable', (event) => chunks.push(event.data));
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((track) => track.stop());
      recorder = null;
      mic.classList.remove('on');
      mic.textContent = '🎙';
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      if (blob.size < 800) return;
      mic.disabled = true;
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        const result = await rpc('transcribe', { data: btoa(binary), mimeType: blob.type });
        if (result.text) {
          input.value = input.value ? `${input.value} ${result.text}` : result.text;
          autosize();
          input.focus();
        }
      } catch (error) {
        note(`Diktat fehlgeschlagen: ${error.message}`, 'error');
      } finally {
        mic.disabled = false;
      }
    });
    recorder.start();
    mic.classList.add('on');
    mic.textContent = '■';
  }

  function finishAssistant(content) {
    if (content || view.streaming) speak(content || view.streaming.text);
    if (view.streaming) {
      renderMarkdown(view.streaming.body, content || view.streaming.text);
      view.streaming.wrap.classList.remove('streaming');
      view.streaming = null;
    } else if (content) {
      bubble('assistant', content);
    }
  }

  function toolEvent(payload) {
    const key = payload.toolId || `${payload.toolName}-${payload.timestamp}`;
    let row = view.tools.get(key);
    if (!row) {
      if (view.streaming) finishAssistant('');
      row = el('div', 'tool');
      row.append(el('span', 'tool-icon'), el('span', 'tool-name'), el('span', 'tool-summary'));
      view.tools.set(key, row);
      const stick = nearBottom();
      log.append(row);
      scrollDown(stick);
    }
    const [icon, name, summary] = row.children;
    row.dataset.status = payload.status;
    icon.textContent =
      payload.status === 'error' ? '✕' : payload.status === 'completed' ? '✓' : '⋯';
    name.textContent = payload.toolName || 'Werkzeug';
    summary.textContent = payload.actionSummary || '';
    if (payload.status === 'error' && payload.error) summary.textContent = String(payload.error);
  }

  // ------------------------------------------------------------ approvals + questions

  function dropCard(requestId) {
    view.cards.get(requestId)?.remove();
    view.cards.delete(requestId);
  }

  function permissionCard(request) {
    const requestId = request.requestId || `legacy-${Date.now()}`;
    if (view.cards.has(requestId)) return;
    const card = el('div', 'card-inline approval');
    const legacy = Array.isArray(request.denials);
    card.append(el('strong', null, legacy ? 'Werkzeuge wurden blockiert' : 'Freigabe nötig'));
    if (legacy) {
      const names = request.denials
        .map((denial) => denial.toolName || denial.tool_name)
        .filter(Boolean);
      card.append(el('p', null, names.join(', ') || 'Werkzeugaufruf'));
    } else {
      card.append(el('p', 'mono', request.toolName || 'Werkzeug'));
      if (request.description) card.append(el('p', null, request.description));
    }
    const row = el('div', 'row');
    const respond = async (action) => {
      row.querySelectorAll('button').forEach((node) => (node.disabled = true));
      try {
        if (legacy) {
          await rpc('permission.legacy', {
            sessionId: view.session.id,
            approve: action !== 'deny',
            toolNames: request.denials.map((denial) => denial.toolName || denial.tool_name),
            originalMessage: request.originalMessage || '',
          });
        } else {
          await rpc('permission.respond', { sessionId: view.session.id, requestId, action });
        }
        dropCard(requestId);
        note(action === 'deny' ? 'Abgelehnt.' : 'Erlaubt.', 'muted');
      } catch (error) {
        note(error.message, 'error');
        row.querySelectorAll('button').forEach((node) => (node.disabled = false));
      }
    };
    row.append(button('Erlauben', 'primary', () => respond('allow_once')));
    if (!legacy) {
      row.append(
        button('Immer (Projekt)', '', () => respond('allow_project'), 'Für dieses Projekt merken')
      );
    }
    row.append(button('Ablehnen', 'danger', () => respond('deny')));
    card.append(row);
    view.cards.set(requestId, card);
    log.append(card);
    scrollDown(true);
  }

  function questionCard(request) {
    if (view.cards.has(request.requestId)) return;
    const card = el('div', 'card-inline question');
    const answers = [];
    for (const [index, question] of (request.questions || []).entries()) {
      answers[index] = new Set();
      if (question.header) card.append(el('span', 'badge', question.header));
      card.append(el('p', null, question.question));
      const options = el('div', 'options');
      for (const option of question.options || []) {
        const choice = button(
          option.label,
          'option',
          () => {
            if (!question.multiple) {
              answers[index].clear();
              options
                .querySelectorAll('.option')
                .forEach((node) => node.classList.remove('chosen'));
            }
            if (answers[index].has(option.label)) {
              answers[index].delete(option.label);
              choice.classList.remove('chosen');
            } else {
              answers[index].add(option.label);
              choice.classList.add('chosen');
            }
          },
          option.description || ''
        );
        options.append(choice);
      }
      card.append(options);
      if (question.custom !== false) {
        const custom = el('input', 'custom');
        custom.type = 'text';
        custom.placeholder = 'Eigene Antwort …';
        custom.dataset.index = String(index);
        card.append(custom);
      }
    }
    const row = el('div', 'row');
    const finish = async (reject) => {
      row.querySelectorAll('button').forEach((node) => (node.disabled = true));
      const payload = {
        requestId: request.requestId,
        providerSessionId: request.providerSessionId,
      };
      if (!reject) {
        card.querySelectorAll('input.custom').forEach((field) => {
          if (field.value.trim()) answers[Number(field.dataset.index)].add(field.value.trim());
        });
        payload.answers = answers.map((set) => [...set]);
      }
      try {
        await rpc('question.respond', payload);
        dropCard(request.requestId);
        note(reject ? 'Frage abgelehnt.' : 'Antwort gesendet.', 'muted');
      } catch (error) {
        note(error.message, 'error');
        row.querySelectorAll('button').forEach((node) => (node.disabled = false));
      }
    };
    row.append(button('Antworten', 'primary', () => finish(false)));
    row.append(button('Ablehnen', '', () => finish(true)));
    card.append(row);
    view.cards.set(request.requestId, card);
    log.append(card);
    scrollDown(true);
  }

  // ------------------------------------------------------------ live events

  function onEvent({ event, payload }) {
    if (!view.session || !payload || payload.sessionId !== view.session.id) return;
    switch (event) {
      case 'session:output':
        if (typeof payload.content === 'string' && payload.content) streamDelta(payload.content);
        setBusy(true);
        break;
      case 'session:message':
        if (payload.role === 'assistant') finishAssistant(payload.content);
        else if (payload.role === 'user') {
          const mine = payload.clientMessageId && view.pending.get(payload.clientMessageId);
          if (mine) {
            mine.wrap.classList.remove('pending');
            mine.confirmed = true;
            view.pending.delete(payload.clientMessageId);
          } else if (payload.content && !view.sentTexts.delete(payload.content)) {
            // Sent elsewhere (WebUI, phone): show it here too.
            bubble('user', payload.content);
          }
        }
        break;
      case 'session:thinking':
        view.thinking = !!payload.isThinking;
        if (view.thinking) view.busy = true;
        renderActivity();
        break;
      case 'session:tool_use':
        toolEvent(payload);
        setBusy(true);
        break;
      case 'session:lifecycle':
        view.activity = payload.activitySummary || '';
        setBusy(payload.busy);
        if (!payload.busy && view.streaming) finishAssistant('');
        break;
      case 'session:queue':
        if (typeof payload.busy === 'boolean') setBusy(payload.busy);
        break;
      case 'session:status':
        if (payload.status !== 'running') setBusy(false);
        break;
      case 'session:permission_request':
        permissionCard(payload);
        break;
      case 'session:question_request':
        questionCard(payload);
        break;
      case 'session:error':
        note(payload.error || 'Fehler', 'error');
        break;
      default:
        break;
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.plumEvent) onEvent(message.plumEvent);
  });

  // ------------------------------------------------------------ actions

  async function submit() {
    const typed = input.value.trim();
    if (!typed || !view.session) return;
    input.value = '';
    autosize();
    const clientMessageId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Guide mode tells the agent which tab the user is looking at.
    const message = decorate ? await decorate(typed) : typed;
    view.sentTexts.add(message);
    const mine = bubble('user', typed);
    mine.wrap.classList.add('pending');
    view.pending.set(clientMessageId, mine);
    setBusy(true);
    try {
      const ack = await rpc('chat.send', {
        sessionId: view.session.id,
        message,
        clientMessageId,
      });
      if (ack && ack.status === 'rejected') throw new Error(ack.error || 'Abgelehnt');
      mine.wrap.classList.remove('pending');
      if (ack && ack.disposition === 'queued') note('In die Warteschlange gestellt.', 'muted');
    } catch (error) {
      mine.wrap.classList.remove('pending');
      // Plum already echoed the message: it arrived, only the reply was slow.
      if (mine.confirmed) return;
      mine.wrap.classList.add('failed');
      note(`Nicht gesendet: ${error.message}`, 'error');
      setBusy(false);
    }
  }

  async function interrupt() {
    if (!view.session) return;
    try {
      await rpc('chat.interrupt', { sessionId: view.session.id });
    } catch (error) {
      note(error.message, 'error');
    }
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  // ------------------------------------------------------------ open / close

  async function open(session, labels = {}) {
    if (view.session && view.session.id !== session.id) {
      void browser.runtime
        .sendMessage({ plumChatClose: view.session.id, pageId: CHAT_PAGE_ID })
        .catch(() => {});
    }
    view.session = { ...session, ...labels };
    view.streaming = null;
    view.tools.clear();
    view.pending.clear();
    view.cards.clear();
    view.activity = '';
    view.thinking = false;
    renderHead();
    log.replaceChildren(el('p', 'chat-note muted', 'Lade Verlauf …'));
    try {
      const data = await call({
        plumChatOpen: session.id,
        pageId: CHAT_PAGE_ID,
        limit: 60,
      });
      if (!view.session || view.session.id !== session.id) return;
      log.replaceChildren();
      Object.assign(view.session, data.session || {});
      renderHead();
      const messages = (data.messages || []).filter(
        (message) => (message.role === 'user' || message.role === 'assistant') && message.content
      );
      if (!messages.length) note('Noch keine Nachrichten. Schreib unten los.', 'muted');
      for (const message of messages) bubble(message.role, message.content);
      for (const request of data.pendingPermissions || []) permissionCard(request);
      setBusy(data.session && data.session.busy);
      scrollDown(true);
      input.focus();
    } catch (error) {
      log.replaceChildren();
      note(`Chat nicht geladen: ${error.message}`, 'error');
    }
  }

  window.addEventListener('pagehide', () => {
    if (view.session) {
      void browser.runtime
        .sendMessage({ plumChatClose: view.session.id, pageId: CHAT_PAGE_ID })
        .catch(() => {});
    }
  });

  renderHead();
  renderActivity();

  /**
   * Mode state from the background: `recording` is its summary (or null),
   * `guide` whether this window is in guide mode for the open session.
   */
  function setModes({ recording, guide }) {
    const mine = recording && view.session && recording.sessionId === view.session.id;
    const recordingHere = mine && recording.active;
    recordButton.textContent = recordingHere ? '■ Aufnahme stoppen' : '● Vorführen';
    recordButton.setAttribute('aria-pressed', String(!!recordingHere));
    recordButton.classList.toggle('on', !!recordingHere);
    recordButton.disabled = !!recording && !mine;
    guideButton.setAttribute('aria-pressed', String(!!guide));
    guideButton.classList.toggle('on', !!guide);

    modeBanner.replaceChildren();
    modeBanner.className = 'mode-banner';
    if (mine && recording.active) {
      modeBanner.classList.add('recording');
      modeBanner.append(
        el('strong', null, `● Aufnahme läuft · ${recording.steps} Schritte`),
        el(
          'p',
          null,
          'Führ es einfach vor: klicken, tippen, Seiten wechseln. Passwörter werden nicht aufgezeichnet.'
        )
      );
    } else if (mine && !recording.active) {
      modeBanner.classList.add('review');
      modeBanner.append(
        el(
          'strong',
          null,
          `Vorführung: ${recording.steps} Schritte, ${recording.shots} Screenshots`
        )
      );
      const list = el('ol', 'mode-steps');
      for (const line of recording.preview) list.append(el('li', null, line));
      const hint = el('textarea');
      hint.rows = 2;
      hint.placeholder = 'Was soll der Agent daraus lernen? (optional)';
      const row = el('div', 'row');
      const sendIt = button('An Session senden', 'primary', async () => {
        sendIt.disabled = true;
        try {
          await onRecord('send', hint.value);
          note('Vorführung gesendet.', 'muted');
        } catch (error) {
          note(error.message, 'error');
          sendIt.disabled = false;
        }
      });
      row.append(
        sendIt,
        button('Verwerfen', '', () => onRecord('discard'))
      );
      // Keep it as a macro the agent can replay later.
      const macroRow = el('div', 'row');
      const macroName = el('input');
      macroName.type = 'text';
      macroName.placeholder = 'Makro-Name, z. B. Rechnung herunterladen';
      macroName.setAttribute('aria-label', 'Makro-Name');
      const saveMacro = button('Als Makro speichern', '', async () => {
        if (!macroName.value.trim()) {
          macroName.focus();
          return;
        }
        saveMacro.disabled = true;
        try {
          await onRecord('macro', macroName.value.trim());
          saveMacro.textContent = 'Gespeichert ✓';
        } catch (error) {
          note(error.message, 'error');
          saveMacro.disabled = false;
        }
      });
      macroRow.append(macroName, saveMacro);
      modeBanner.append(list, hint, row, macroRow);
    } else if (guide) {
      modeBanner.classList.add('guide');
      modeBanner.append(
        el('strong', null, '✎ Anleitungsmodus'),
        el(
          'p',
          null,
          'Plum sieht deinen aktiven Tab und zeigt dir mit Cursor, Markierungen und Stift, was zu tun ist. Klicken und tippen musst du selbst. Frag einfach im Chat.'
        )
      );
    }
    modeBanner.hidden = !modeBanner.childElementCount;
  }

  return {
    open,
    setModes,
    current: () => view.session,
    /** Plum reconnected: the server-side feed is new, so reload. */
    reopen: () => view.session && open(view.session),
    relabel(labels) {
      if (!view.session) return;
      Object.assign(view.session, labels);
      renderHead();
    },
  };
}
