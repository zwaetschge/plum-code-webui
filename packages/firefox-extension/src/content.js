/* Plum Browser — content script (top frame).
 *
 * Executes DOM tools for the background page: page outline with element refs,
 * search, click/hover/type/keys/scroll, form input, page text, console capture
 * and JS evaluation. Firefox has no debugger protocol for extensions, so input
 * is synthesised with DOM events plus the default actions a real key or click
 * would have triggered (focus moves, text insertion, form submission).
 */
(() => {
  'use strict';
  if (typeof globalThis.browser === 'undefined') globalThis.browser = chrome;
  // Chrome's isolated world has no wrappedJSObject; page console arrives via postMessage.
  const FIREFOX_XRAYS = typeof window.wrappedJSObject !== 'undefined';
  if (window.__plumBrowserContent) return;
  window.__plumBrowserContent = true;

  // Positions in results are reported in screenshot pixels (see background fitScreenshot).
  let outScale = 1;
  const px = (value) => Math.round(value * outScale);

  // ------------------------------------------------------------ element refs

  const refToEl = new Map();
  const elToRef = new WeakMap();
  let nextRef = 1;

  function refFor(el) {
    let ref = elToRef.get(el);
    if (!ref) {
      ref = `ref_${nextRef++}`;
      elToRef.set(el, ref);
      refToEl.set(ref, new WeakRef(el));
    }
    return ref;
  }

  function elementForRef(ref) {
    const el = refToEl.get(String(ref || '').trim())?.deref();
    if (!el || !el.isConnected) {
      throw new Error(`Element ${ref} existiert nicht mehr – rufe read_page oder find erneut auf.`);
    }
    return el;
  }

  // ------------------------------------------------------------ semantics

  const INTERACTIVE_ROLES = new Set([
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'combobox',
    'textbox',
    'searchbox',
    'slider',
    'spinbutton',
    'listbox',
    'treeitem',
    'gridcell',
  ]);

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'a':
        return el.hasAttribute('href') ? 'link' : null;
      case 'button':
      case 'summary':
        return 'button';
      case 'select':
        return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'textarea':
        return 'textbox';
      case 'input': {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'hidden') return null;
        if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'number') return 'spinbutton';
        if (type === 'search') return 'searchbox';
        return 'textbox';
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading';
      case 'img':
        return 'img';
      case 'nav':
        return 'navigation';
      case 'main':
        return 'main';
      case 'form':
        return 'form';
      case 'dialog':
        return 'dialog';
      case 'li':
        return 'listitem';
      case 'table':
        return 'table';
      case 'option':
        return 'option';
      default:
        return null;
    }
  }

  function roleOf(el) {
    const explicit = (el.getAttribute('role') || '').split(/\s+/)[0];
    if (explicit) return explicit;
    const implicit = implicitRole(el);
    if (implicit) return implicit;
    if (el.isContentEditable && (!el.parentElement || !el.parentElement.isContentEditable)) {
      return 'textbox';
    }
    return null;
  }

  function clean(text, max = 100) {
    const value = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  function accessibleName(el) {
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      const text = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
      if (clean(text)) return clean(text);
    }
    const aria = el.getAttribute('aria-label');
    if (clean(aria)) return clean(aria);
    if (el.labels && el.labels.length) {
      const text = [...el.labels].map((label) => label.textContent).join(' ');
      if (clean(text)) return clean(text);
    }
    const tag = el.tagName.toLowerCase();
    if (tag === 'img' || (tag === 'input' && el.type === 'image')) {
      if (clean(el.getAttribute('alt'))) return clean(el.getAttribute('alt'));
    }
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type) && el.value) {
      return clean(el.value);
    }
    if (['input', 'textarea'].includes(tag) && el.placeholder) return clean(el.placeholder);
    if (tag === 'select') {
      const option = el.selectedOptions?.[0];
      if (option) return clean(option.textContent);
    }
    const text = clean(el.innerText || el.textContent);
    if (text) return text;
    if (clean(el.getAttribute('title'))) return clean(el.getAttribute('title'));
    const svgTitle = el.querySelector?.('svg title');
    return clean(svgTitle?.textContent);
  }

  function isInteractive(el, role) {
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    const tag = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tag)) {
      return (
        !(tag === 'input' && el.type === 'hidden') && !(tag === 'a' && !el.hasAttribute('href'))
      );
    }
    if (el.isContentEditable) return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) return true;
    if (el.hasAttribute('onclick')) return true;
    try {
      return getComputedStyle(el).cursor === 'pointer' && !el.parentElement?.closest?.('a,button');
    } catch {
      return false;
    }
  }

  function isVisible(el) {
    if (el === overlayHost) return false;
    const style = getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
    if (Number(style.opacity) === 0 && !['INPUT', 'SELECT'].includes(el.tagName)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || style.display === 'contents';
  }

  function stateHints(el) {
    const hints = [];
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.getAttribute('href')) {
      const href = el.getAttribute('href');
      if (!href.startsWith('javascript:')) hints.push(`href="${clean(href, 80)}"`);
    }
    if (tag === 'input' || tag === 'textarea') {
      const type = (
        el.getAttribute('type') || (tag === 'textarea' ? 'textarea' : 'text')
      ).toLowerCase();
      if (!['text', 'textarea', 'checkbox', 'radio', 'submit', 'button'].includes(type))
        hints.push(`type=${type}`);
      if (type === 'checkbox' || type === 'radio') hints.push(el.checked ? 'checked' : 'unchecked');
      else if (type === 'password') hints.push(el.value ? 'value=•••' : 'empty');
      else if (el.value && !['submit', 'button'].includes(type))
        hints.push(`value="${clean(el.value, 60)}"`);
    }
    if (tag === 'select') hints.push(`options=${el.options.length}`);
    const checked = el.getAttribute('aria-checked');
    if (checked) hints.push(`checked=${checked}`);
    const expanded = el.getAttribute('aria-expanded');
    if (expanded) hints.push(`expanded=${expanded}`);
    if (el.getAttribute('aria-selected') === 'true') hints.push('selected');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') hints.push('disabled');
    if (el.required) hints.push('required');
    if (document.activeElement === el) hints.push('focused');
    return hints;
  }

  function inViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  // ------------------------------------------------------------ read_page

  function readPage({ filter = 'interactive', ref, maxChars = 30000 } = {}) {
    const root = ref ? elementForRef(ref) : document.body || document.documentElement;
    const all = filter === 'all';
    const lines = [];
    let length = 0;
    let truncated = false;

    const push = (depth, line) => {
      if (truncated) return;
      const text = `${'  '.repeat(Math.min(depth, 12))}${line}`;
      if (length + text.length > maxChars) {
        truncated = true;
        return;
      }
      lines.push(text);
      length += text.length + 1;
    };

    const walk = (el, depth) => {
      if (truncated || !(el instanceof Element)) return;
      const tag = el.tagName.toLowerCase();
      if (
        ['script', 'style', 'noscript', 'template', 'svg', 'head', 'meta', 'link'].includes(tag)
      ) {
        if (tag !== 'svg') return;
      }
      if (!isVisible(el)) return;
      const role = roleOf(el);
      const interactive = isInteractive(el, role);
      let shown = false;
      if (interactive) {
        const name = accessibleName(el);
        const hints = stateHints(el);
        const offscreen = inViewport(el) ? '' : ' (offscreen)';
        push(
          depth,
          `${role || tag} "${name}" [${refFor(el)}]${hints.length ? ` ${hints.join(' ')}` : ''}${offscreen}`
        );
        shown = true;
        // Controls rarely contain other meaningful controls; stop to keep the outline short.
        if (
          ['input', 'select', 'textarea', 'button', 'a'].includes(tag) &&
          !el.querySelector('input,select,textarea,button')
        ) {
          return;
        }
      } else if (all) {
        if (role === 'heading') {
          push(depth, `heading${tag.slice(1)} "${clean(el.innerText, 160)}"`);
          return;
        }
        if (role === 'img') {
          const alt = clean(el.getAttribute('alt'));
          if (alt) push(depth, `img "${alt}"`);
          return;
        }
        if (['main', 'navigation', 'form', 'dialog', 'table'].includes(role)) {
          push(
            depth,
            `${role}${accessibleName(el) && role !== 'main' ? ` "${clean(accessibleName(el), 60)}"` : ''}`
          );
          shown = true;
        } else {
          const own = [...el.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(' ');
          const text = clean(own, 200);
          if (text) push(depth, `text "${text}"`);
        }
      }
      if (tag === 'svg') return;
      const children = el.shadowRoot
        ? [...el.shadowRoot.children, ...el.children]
        : [...el.children];
      for (const child of children) walk(child, shown ? depth + 1 : depth);
      if (tag === 'iframe')
        push(depth, `iframe "${clean(el.title || el.src, 80)}" (inhalt nicht lesbar)`);
    };

    walk(root, 0);
    const header = [
      `URL: ${location.href}`,
      `Titel: ${document.title}`,
      `Viewport: ${innerWidth}×${innerHeight}, scroll ${Math.round(scrollX)},${Math.round(scrollY)} von ${document.documentElement.scrollWidth}×${document.documentElement.scrollHeight}`,
      '',
    ];
    if (!lines.length)
      lines.push(
        all ? '(keine sichtbaren Inhalte)' : '(keine interaktiven Elemente – versuche filter "all")'
      );
    if (truncated)
      lines.push(`… gekürzt bei ${maxChars} Zeichen – nutze ref für einen Teilbaum oder find.`);
    return header.concat(lines).join('\n');
  }

  // ------------------------------------------------------------ find

  function find({ query }) {
    const raw = String(query || '').trim();
    if (!raw) throw new Error('query fehlt');
    let candidates;
    if (raw.startsWith('css:')) {
      candidates = [...document.querySelectorAll(raw.slice(4).trim())].filter(isVisible);
    } else {
      const needle = raw.toLowerCase();
      const scored = [];
      const all = document.querySelectorAll('body *');
      for (const el of all) {
        if (el === overlayHost || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
        const role = roleOf(el);
        const interactive = isInteractive(el, role);
        const fields = [
          el.getAttribute('aria-label'),
          el.getAttribute('placeholder'),
          el.getAttribute('title'),
          el.getAttribute('alt'),
          el.getAttribute('name'),
          el.id,
          interactive ? accessibleName(el) : null,
          el.value && typeof el.value === 'string' ? el.value : null,
        ];
        let score = 0;
        for (const field of fields) {
          const value = String(field || '')
            .toLowerCase()
            .trim();
          if (!value) continue;
          if (value === needle) score = Math.max(score, 100);
          else if (value.includes(needle)) score = Math.max(score, 60);
        }
        if (!score && !interactive) {
          // Leaf-ish text elements only, so a match is not reported for every ancestor.
          const own = [...el.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(' ')
            .toLowerCase();
          if (own.includes(needle)) score = own.trim() === needle ? 50 : 30;
        }
        if (!score || !isVisible(el)) continue;
        if (interactive) score += 20;
        if (inViewport(el)) score += 5;
        scored.push({ el, score });
      }
      scored.sort((a, b) => b.score - a.score);
      candidates = scored.map((entry) => entry.el);
    }
    const results = candidates.slice(0, 25).map((el) => {
      const rect = el.getBoundingClientRect();
      const role = roleOf(el) || el.tagName.toLowerCase();
      const hints = stateHints(el);
      return `${role} "${accessibleName(el) || clean(el.textContent, 80)}" [${refFor(el)}]${hints.length ? ` ${hints.join(' ')}` : ''} @ ${px(rect.left + rect.width / 2)},${px(rect.top + rect.height / 2)}${inViewport(el) ? '' : ' (offscreen)'}`;
    });
    if (!results.length) return `Keine Treffer für "${raw}".`;
    return `${results.length}${candidates.length > 25 ? ` von ${candidates.length}` : ''} Treffer:\n${results.join('\n')}`;
  }

  // ------------------------------------------------------------ page text

  function pageText({ maxChars = 40000 } = {}) {
    const root =
      document.querySelector('article') ||
      document.querySelector('main, [role="main"]') ||
      document.body ||
      document.documentElement;
    let text = (root.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    const truncated = text.length > maxChars;
    if (truncated) text = `${text.slice(0, maxChars)}\n… (gekürzt)`;
    return `Titel: ${document.title}\nURL: ${location.href}\n\n${text}`;
  }

  // ------------------------------------------------------------ pointer input

  function modifierInit(modifiers = []) {
    const set = new Set((modifiers || []).map((modifier) => String(modifier).toLowerCase()));
    return {
      altKey: set.has('alt'),
      ctrlKey: set.has('control') || set.has('ctrl'),
      metaKey: set.has('meta') || set.has('cmd'),
      shiftKey: set.has('shift'),
    };
  }

  function pointFor({ ref, x, y }) {
    if (ref) {
      const el = elementForRef(ref);
      if (!inViewport(el))
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const top = document.elementFromPoint(cx, cy);
      // Dispatch on what a real pointer would hit, unless it is unrelated (covered).
      const target = top && (el.contains(top) || top.contains(el)) ? top : el;
      const covered = top && !el.contains(top) && !top.contains(el) ? top : null;
      return { target, x: cx, y: cy, covered };
    }
    if (typeof x !== 'number' || typeof y !== 'number') throw new Error('ref oder x/y angeben');
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error(`Kein Element bei ${x},${y} (außerhalb des Viewports?)`);
    return { target, x, y, covered: null };
  }

  function mouse(target, type, x, y, extra = {}) {
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x + screenX,
      screenY: y + screenY,
      ...extra,
    };
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    if (Ctor === PointerEvent)
      Object.assign(init, { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    return target.dispatchEvent(new Ctor(type, init));
  }

  async function hover(args) {
    const { target, x, y } = pointFor(args);
    await moveCursor(x, y);
    for (const type of [
      'pointerover',
      'pointerenter',
      'mouseover',
      'mouseenter',
      'pointermove',
      'mousemove',
    ]) {
      mouse(target, type, x, y);
    }
    return `Hover über ${describe(target)} @ ${px(x)},${px(y)}`;
  }

  function focusable(el) {
    return el.closest(
      'input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable="true"]'
    );
  }

  async function click(args) {
    const { target, x, y, covered } = pointFor(args);
    await moveCursor(x, y);
    const button = { left: 0, middle: 1, right: 2 }[args.button || 'left'] ?? 0;
    const mods = modifierInit(args.modifiers);
    const base = { button, buttons: 1 << (button === 1 ? 2 : button === 2 ? 1 : 0), ...mods };
    for (const type of ['pointerover', 'mouseover', 'pointermove', 'mousemove'])
      mouse(target, type, x, y, mods);
    const clicks = args.double ? 2 : 1;
    for (let detail = 1; detail <= clicks; detail++) {
      mouse(target, 'pointerdown', x, y, { ...base, detail });
      const downOk = mouse(target, 'mousedown', x, y, { ...base, detail });
      if (downOk && detail === 1) {
        const focusTarget = focusable(target);
        if (focusTarget && typeof focusTarget.focus === 'function')
          focusTarget.focus({ preventScroll: true });
        else if (document.activeElement && document.activeElement !== document.body)
          document.activeElement.blur?.();
      }
      mouse(target, 'pointerup', x, y, { ...base, buttons: 0, detail });
      mouse(target, 'mouseup', x, y, { ...base, buttons: 0, detail });
      if (button === 0) mouse(target, 'click', x, y, { ...base, buttons: 0, detail });
      else if (button === 1) mouse(target, 'auxclick', x, y, { ...base, buttons: 0, detail });
    }
    if (button === 2) mouse(target, 'contextmenu', x, y, { ...base, buttons: 0 });
    if (args.double) mouse(target, 'dblclick', x, y, { ...base, buttons: 0, detail: 2 });
    ripple(x, y);
    const warning = covered ? ` – Achtung: Element wird von ${describe(covered)} überdeckt` : '';
    return `${args.double ? 'Doppelklick' : button === 2 ? 'Rechtsklick' : 'Klick'} auf ${describe(target)} @ ${px(x)},${px(y)}${warning}`;
  }

  function describe(el) {
    const role = roleOf(el) || el.tagName.toLowerCase();
    const name = accessibleName(el);
    return `${role}${name ? ` "${clean(name, 60)}"` : ''} [${refFor(el)}]`;
  }

  // ------------------------------------------------------------ keyboard input

  const KEY_ALIASES = {
    enter: 'Enter',
    return: 'Enter',
    tab: 'Tab',
    esc: 'Escape',
    escape: 'Escape',
    space: ' ',
    backspace: 'Backspace',
    delete: 'Delete',
    del: 'Delete',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    arrowup: 'ArrowUp',
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Meta',
    cmd: 'Meta',
    super: 'Meta',
  };

  function codeFor(key) {
    if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
    if (/^[0-9]$/.test(key)) return `Digit${key}`;
    if (key === ' ') return 'Space';
    return key;
  }

  function editableTarget(el) {
    if (!el) return null;
    if (el.isContentEditable) return el;
    if (el.tagName === 'TEXTAREA') return el;
    if (
      el.tagName === 'INPUT' &&
      ![
        'checkbox',
        'radio',
        'button',
        'submit',
        'reset',
        'file',
        'image',
        'range',
        'color',
      ].includes(el.type)
    ) {
      return el;
    }
    return null;
  }

  function activeElementDeep() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function insertText(el, text) {
    if (!text) return;
    if (document.execCommand('insertText', false, text)) return;
    // Fallback for editors that refuse execCommand: native setter keeps React in sync.
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const proto =
        el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
      el.setSelectionRange?.(start + text.length, start + text.length);
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
      );
    } else {
      el.textContent += text;
      el.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
      );
    }
  }

  function selectAll(el) {
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.select();
    } else if (el && el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      document.execCommand('selectAll');
    }
  }

  function focusables() {
    return [
      ...document.querySelectorAll(
        'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]'
      ),
    ].filter(
      (el) =>
        !el.disabled &&
        el.tabIndex >= 0 &&
        isVisible(el) &&
        !(el.tagName === 'INPUT' && el.type === 'hidden')
    );
  }

  function keyEvent(target, type, key, mods) {
    return target.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code: codeFor(key),
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        ...mods,
      })
    );
  }

  function pressChord(chord) {
    const parts = chord.split('+').filter(Boolean);
    const keys = parts.map(
      (part) => KEY_ALIASES[part.toLowerCase()] || (part.length === 1 ? part : part)
    );
    const key = keys[keys.length - 1];
    const modNames = keys.slice(0, -1);
    const mods = modifierInit(modNames);
    const target = activeElementDeep() || document.body;
    const printable = key.length === 1 && !mods.ctrlKey && !mods.metaKey && !mods.altKey;
    const notCancelled = keyEvent(target, 'keydown', key, mods);
    if (notCancelled && (printable || key === 'Enter')) keyEvent(target, 'keypress', key, mods);
    if (notCancelled) defaultKeyAction(target, key, mods, printable);
    keyEvent(activeElementDeep() || document.body, 'keyup', key, mods);
  }

  function defaultKeyAction(target, key, mods, printable) {
    const editable = editableTarget(target);
    const lower = key.toLowerCase();
    if ((mods.ctrlKey || mods.metaKey) && lower === 'a') return selectAll(editable || target);
    if (mods.ctrlKey || mods.metaKey || mods.altKey) return;
    if (printable) {
      if (editable) insertText(editable, mods.shiftKey ? key.toUpperCase() : key);
      else if (key === ' ') window.scrollBy(0, innerHeight * 0.8);
      return;
    }
    switch (key) {
      case 'Enter':
        if (editable && (editable.tagName === 'TEXTAREA' || editable.isContentEditable)) {
          document.execCommand(mods.shiftKey ? 'insertLineBreak' : 'insertParagraph') ||
            insertText(editable, '\n');
        } else if (editable && editable.form) {
          const submitter = editable.form.querySelector(
            'button[type=submit],input[type=submit],button:not([type])'
          );
          if (submitter) submitter.click();
          else editable.form.requestSubmit();
        } else if (target.matches?.('a[href],button,summary,[role=button],[role=link]')) {
          target.click();
        }
        return;
      case ' ':
        return;
      case 'Tab': {
        const list = focusables();
        const index = list.indexOf(target);
        const next = list[(index + (mods.shiftKey ? -1 : 1) + list.length) % list.length];
        next?.focus();
        return;
      }
      case 'Backspace':
        if (editable) document.execCommand('delete');
        return;
      case 'Delete':
        if (editable) document.execCommand('forwardDelete');
        return;
      case 'PageDown':
      case 'PageUp':
        if (!editable) window.scrollBy(0, (key === 'PageDown' ? 1 : -1) * innerHeight * 0.85);
        return;
      case 'Home':
      case 'End':
        if (!editable)
          window.scrollTo(0, key === 'Home' ? 0 : document.documentElement.scrollHeight);
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        if (target.tagName === 'SELECT') {
          const delta = key === 'ArrowDown' ? 1 : -1;
          target.selectedIndex = Math.max(
            0,
            Math.min(target.options.length - 1, target.selectedIndex + delta)
          );
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (!editable) window.scrollBy(0, (key === 'ArrowDown' ? 1 : -1) * 60);
        return;
      default:
        return;
    }
  }

  function pressKey({ keys }) {
    const sequence = String(keys || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!sequence.length) throw new Error('keys fehlt');
    for (const chord of sequence) pressChord(chord);
    return `Gedrückt: ${sequence.join(' ')} (Fokus: ${describe(activeElementDeep() || document.body)})`;
  }

  async function type({ text, ref, clear, submit }) {
    let target;
    if (ref) {
      const el = elementForRef(ref);
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const point = centerOf(el);
      await moveCursor(point.x, point.y);
      ripple(point.x, point.y);
      el.focus({ preventScroll: true });
      target = el;
    } else {
      target = activeElementDeep();
    }
    const editable =
      editableTarget(target) ||
      (target &&
        target.querySelector?.('[contenteditable=""],[contenteditable="true"],input,textarea'));
    if (!editable) {
      throw new Error(
        'Kein Eingabefeld fokussiert – gib ein ref an oder klicke zuerst in das Feld.'
      );
    }
    if (editable !== target) editable.focus();
    if (clear) {
      selectAll(editable);
      document.execCommand('delete');
    } else if (editable.tagName === 'INPUT' || editable.tagName === 'TEXTAREA') {
      const end = editable.value.length;
      try {
        editable.setSelectionRange(end, end);
      } catch {
        /* email/number inputs have no selection API */
      }
    }
    const value = String(text ?? '');
    if (value.length <= 120) {
      for (const char of value) {
        const mods = { shiftKey: char !== char.toLowerCase() };
        const proceed = keyEvent(editable, 'keydown', char === '\n' ? 'Enter' : char, mods);
        if (proceed) {
          if (char === '\n') defaultKeyAction(editable, 'Enter', mods, false);
          else {
            keyEvent(editable, 'keypress', char, mods);
            insertText(editable, char);
          }
        }
        keyEvent(editable, 'keyup', char === '\n' ? 'Enter' : char, mods);
      }
    } else {
      insertText(editable, value);
    }
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    if (submit) pressChord('Enter');
    const current =
      editable.value !== undefined && editable.tagName !== 'DIV'
        ? editable.value
        : editable.innerText;
    const shown = editable.type === 'password' ? '•••' : clean(current, 120);
    return `Getippt in ${describe(editable)} – Inhalt jetzt: "${shown}"${submit ? ' (Enter gedrückt)' : ''}`;
  }

  // ------------------------------------------------------------ scroll

  function scrollableAncestor(el) {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX) &&
        (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
      ) {
        return node;
      }
    }
    return null;
  }

  async function scroll({ direction, amount, ref, x, y }) {
    if (direction === 'to') {
      if (!ref) throw new Error('direction "to" braucht ein ref');
      const el = elementForRef(ref);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return `${describe(el)} in den sichtbaren Bereich gescrollt`;
    }
    let origin = null;
    if (ref) origin = elementForRef(ref);
    else if (typeof x === 'number' && typeof y === 'number')
      origin = document.elementFromPoint(x, y);
    if (typeof x === 'number' && typeof y === 'number') await moveCursor(x, y);
    else if (origin) {
      const point = centerOf(origin);
      await moveCursor(point.x, point.y);
    }
    const container = origin ? scrollableAncestor(origin) : null;
    const scroller = container || document.scrollingElement || document.documentElement;
    const viewportH = container ? container.clientHeight : innerHeight;
    const viewportW = container ? container.clientWidth : innerWidth;
    const factor = typeof amount === 'number' && amount > 0 ? amount : 0.8;
    if (direction === 'top') scroller.scrollTo({ top: 0, behavior: 'instant' });
    else if (direction === 'bottom')
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'instant' });
    else {
      const dy =
        direction === 'down' ? viewportH * factor : direction === 'up' ? -viewportH * factor : 0;
      const dx =
        direction === 'right' ? viewportW * factor : direction === 'left' ? -viewportW * factor : 0;
      scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    }
    const where = container ? describe(container) : 'Seite';
    return `${where} gescrollt: jetzt ${Math.round(scroller.scrollLeft)},${Math.round(scroller.scrollTop)} von ${scroller.scrollWidth}×${scroller.scrollHeight}`;
  }

  // ------------------------------------------------------------ form input

  async function formInput({ ref, value }) {
    const el = elementForRef(ref);
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const point = centerOf(el);
    await moveCursor(point.x, point.y);
    ripple(point.x, point.y);
    const tag = el.tagName;
    const fire = () => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (tag === 'SELECT') {
      const wanted = String(value).toLowerCase().trim();
      const option =
        [...el.options].find((opt) => opt.value.toLowerCase() === wanted) ||
        [...el.options].find((opt) => clean(opt.textContent).toLowerCase() === wanted) ||
        [...el.options].find((opt) => clean(opt.textContent).toLowerCase().includes(wanted));
      if (!option) {
        throw new Error(
          `Option "${value}" nicht gefunden. Verfügbar: ${[...el.options].map((opt) => clean(opt.textContent, 40)).join(', ')}`
        );
      }
      el.value = option.value;
      option.selected = true;
      fire();
      return `${describe(el)} auf "${clean(option.textContent)}" gesetzt`;
    }
    if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      const wanted =
        value === true ||
        String(value).toLowerCase() === 'true' ||
        value === 1 ||
        String(value) === 'on';
      if (el.checked !== wanted) el.click();
      return `${describe(el)} ist jetzt ${el.checked ? 'aktiviert' : 'deaktiviert'}`;
    }
    const role = el.getAttribute('role');
    if (role === 'checkbox' || role === 'switch') {
      const wanted = value === true || String(value).toLowerCase() === 'true';
      if ((el.getAttribute('aria-checked') === 'true') !== wanted) el.click();
      return `${describe(el)} umgeschaltet`;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      el.focus({ preventScroll: true });
      const proto = tag === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
      fire();
      el.blur();
      return `${describe(el)} auf "${el.type === 'password' ? '•••' : clean(el.value, 80)}" gesetzt`;
    }
    if (el.isContentEditable) {
      el.focus();
      selectAll(el);
      insertText(el, String(value));
      return `${describe(el)} befüllt`;
    }
    throw new Error(`${describe(el)} ist kein Formularfeld – nutze click oder type.`);
  }

  // ------------------------------------------------------------ console capture

  const consoleBuffer = [];
  let consoleHooked = false;

  function stringifyArg(arg) {
    try {
      if (arg === undefined) return 'undefined';
      if (arg === null) return 'null';
      if (typeof arg === 'string') return arg;
      if (
        arg instanceof Error ||
        (arg && typeof arg.stack === 'string' && typeof arg.message === 'string')
      ) {
        return `${arg.name || 'Error'}: ${arg.message}`;
      }
      if (typeof arg === 'object')
        return JSON.stringify(arg, null, 0)?.slice(0, 2000) ?? String(arg);
      return String(arg);
    } catch {
      return String(arg);
    }
  }

  function record(level, parts) {
    consoleBuffer.push({ t: Date.now(), level, text: parts.join(' ').slice(0, 4000) });
    if (consoleBuffer.length > 500) consoleBuffer.splice(0, consoleBuffer.length - 500);
  }

  const originalConsole = {};

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!consoleHooked || event.source !== window || !data || data.__plumConsole !== true) return;
    record(String(data.level), [String(data.text)]);
  });

  function hookConsole() {
    if (consoleHooked) return;
    consoleHooked = true;
    if (!FIREFOX_XRAYS) {
      browser.runtime.sendMessage({ plumConsoleHook: true }).catch(() => {});
      return;
    }
    try {
      const pageConsole = window.wrappedJSObject.console;
      for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = pageConsole[level];
        originalConsole[level] = original;
        exportFunction(
          function (...args) {
            record(level, args.map(stringifyArg));
            // Spread, not apply(args): a content-script array is opaque to the page.
            return original.call(pageConsole, ...args);
          },
          pageConsole,
          { defineAs: level }
        );
      }
    } catch (error) {
      record('warn', [`[Plum] Konsole konnte nicht mitgeschnitten werden: ${error.message}`]);
    }
  }

  function unhookConsole() {
    if (!consoleHooked) return;
    consoleHooked = false;
    consoleBuffer.length = 0;
    if (!FIREFOX_XRAYS) return;
    try {
      const pageConsole = window.wrappedJSObject.console;
      for (const [level, original] of Object.entries(originalConsole))
        pageConsole[level] = original;
    } catch {
      /* page replaced its console */
    }
  }

  window.addEventListener('error', (event) => {
    if (consoleHooked)
      record('error', [`Uncaught ${event.message} (${event.filename}:${event.lineno})`]);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (consoleHooked) record('error', [`Unhandled rejection: ${stringifyArg(event.reason)}`]);
  });

  function readConsole({ pattern, onlyErrors, clear: clearBuffer, limit = 100 } = {}) {
    if (!consoleHooked) {
      hookConsole();
      return 'Konsolen-Mitschnitt war für diesen Tab noch nicht aktiv und läuft ab jetzt. Lade die Seite neu (navigate "reload"), um Meldungen ab dem Seitenstart zu sehen.';
    }
    let entries = consoleBuffer.slice();
    if (onlyErrors)
      entries = entries.filter((entry) => entry.level === 'error' || entry.level === 'warn');
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      entries = entries.filter((entry) => regex.test(entry.text));
    }
    entries = entries.slice(-Math.max(1, Math.min(Number(limit) || 100, 500)));
    if (clearBuffer) consoleBuffer.length = 0;
    if (!entries.length) return 'Keine passenden Konsolenmeldungen.';
    return entries
      .map(
        (entry) =>
          `[${new Date(entry.t).toISOString().slice(11, 23)}] ${entry.level.toUpperCase()} ${entry.text}`
      )
      .join('\n');
  }

  // Hook at document_start so the page's first messages are caught, then give
  // the native console back unless this tab belongs to a Plum session.
  hookConsole();
  browser.runtime
    .sendMessage({ plumShouldCapture: true })
    .then((answer) => {
      if (!answer || !answer.capture) unhookConsole();
    })
    .catch(() => unhookConsole());

  // ------------------------------------------------------------ evaluate

  async function evaluateJs({ code }) {
    const source = `(async () => { ${code}\n})().then((value) => { try { return JSON.stringify(value === undefined ? null : value, null, 2); } catch (error) { return String(value); } })`;
    let value;
    try {
      // window.eval runs in the page's own context (its globals, its frameworks).
      value = await window.eval(source);
    } catch (error) {
      if (!/Content Security Policy|CSP|call to eval|EvalError/i.test(String(error))) {
        throw new Error(`${error.name || 'Error'}: ${error.message || error}`);
      }
      // Page CSP forbids eval: fall back to the content-script sandbox (DOM access only).
      // eslint-disable-next-line no-eval
      value = await eval(source);
      return `(Seiten-CSP blockiert eval – im Erweiterungskontext ausgeführt, nur DOM-Zugriff)\n${value}`;
    }
    return String(value).slice(0, 50000);
  }

  // ------------------------------------------------------------ overlay: frame, pill, virtual cursor
  //
  // Plum's pointer is drawn into the page (shadow DOM, pointer-events: none),
  // glides to every target before acting and stays where it last was — also
  // across navigations, because the background page remembers the position.

  let overlayHost = null;
  let overlayTimer = null;
  let labelTimer = null;
  let cursorPos = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // A locked screen or covered window makes the page hidden: no frames are
  // painted, requestAnimationFrame stalls and nobody sees an animation.
  const nextPaint = () =>
    document.hidden
      ? Promise.resolve()
      : Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          wait(120),
        ]);

  function overlay() {
    if (!overlayHost) {
      overlayHost = document.createElement('plum-browser-overlay');
      const shadow = overlayHost.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .frame { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
            box-shadow: inset 0 0 0 3px rgba(122, 76, 255, .85), inset 0 0 28px rgba(122, 76, 255, .35);
            opacity: 0; transition: opacity .25s ease; }
          .frame.on { opacity: 1; }
          .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
            pointer-events: none; font: 600 12px/1.2 system-ui, sans-serif; color: #141414;
            padding: 7px 12px; border-radius: 999px; background: rgba(255,255,255,.78);
            backdrop-filter: blur(12px); border: 1px solid rgba(122,76,255,.45);
            box-shadow: 0 6px 24px rgba(58,52,78,.22); white-space: nowrap; }
          .cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
            display: none; will-change: transform; transition-property: transform;
            transition-timing-function: cubic-bezier(.2,.75,.25,1); }
          .cursor.on { display: block; }
          .cursor svg { display: block; width: 26px; height: 26px; margin: -2px 0 0 -3px;
            filter: drop-shadow(0 2px 4px rgba(20, 10, 60, .45)); }
          .tag { position: absolute; left: 22px; top: 20px; font: 700 11px/1 system-ui, sans-serif;
            color: #fff; white-space: nowrap; padding: 5px 8px; border-radius: 999px;
            background: linear-gradient(135deg, #7a4cff, #1856ff);
            box-shadow: 0 3px 10px rgba(24, 86, 255, .35); }
          .ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px;
            margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid rgba(122, 76, 255, .9);
            animation: ripple .55s ease-out forwards; }
          @keyframes ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
          @media (prefers-reduced-motion: reduce) {
            .frame { transition: none; } .cursor { transition: none !important; } .ripple { animation-duration: .01s; }
          }
        </style>
        <div class="frame"><div class="pill"></div></div>
        <div class="cursor">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#8b5cff"/><stop offset="1" stop-color="#1856ff"/></linearGradient></defs>
            <path d="M4 2.5 L4 19.5 L8.6 15.4 L11.6 22 L14.6 20.6 L11.7 14.2 L18 14.2 Z"
              fill="url(#g)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
          <span class="tag">Plum</span>
        </div>`;
      overlayHost._shadow = shadow;
      overlayHost._frame = shadow.querySelector('.frame');
      overlayHost._pill = shadow.querySelector('.pill');
      overlayHost._cursor = shadow.querySelector('.cursor');
      overlayHost._tag = shadow.querySelector('.tag');
    }
    if (!overlayHost.isConnected)
      (document.body || document.documentElement).appendChild(overlayHost);
    return overlayHost;
  }

  function showActivity(label) {
    try {
      const ui = overlay();
      ui._pill.textContent = `Plum steuert diesen Tab · ${label}`;
      ui._frame.classList.add('on');
      ui._tag.textContent = `Plum · ${label}`;
      clearTimeout(overlayTimer);
      clearTimeout(labelTimer);
      overlayTimer = setTimeout(() => overlayHost?._frame.classList.remove('on'), 2500);
      labelTimer = setTimeout(() => {
        if (overlayHost) overlayHost._tag.textContent = 'Plum';
      }, 3000);
    } catch {
      /* purely cosmetic */
    }
  }

  function placeCursor(x, y, duration) {
    const ui = overlay();
    ui._cursor.classList.add('on');
    ui._cursor.style.transitionDuration = `${duration}ms`;
    ui._cursor.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  /** Glide the virtual cursor to (x, y) and wait until it has arrived. */
  async function moveCursor(x, y) {
    try {
      const from = cursorPos || { x: innerWidth / 2, y: innerHeight * 0.6 };
      if (!cursorPos) {
        placeCursor(from.x, from.y, 0);
        await nextPaint();
      }
      const distance = Math.hypot(x - from.x, y - from.y);
      const duration =
        reducedMotion || document.hidden
          ? 0
          : Math.round(Math.min(650, Math.max(160, distance * 0.6)));
      placeCursor(x, y, duration);
      cursorPos = { x, y };
      browser.runtime.sendMessage({ plumCursor: { x, y } }).catch(() => {});
      if (duration) await wait(duration + 40);
    } catch {
      /* purely cosmetic */
    }
  }

  function ripple(x, y) {
    try {
      const dot = document.createElement('div');
      dot.className = 'ripple';
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      overlay()._shadow.appendChild(dot);
      setTimeout(() => dot.remove(), 700);
    } catch {
      /* purely cosmetic */
    }
  }

  function centerOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + Math.min(rect.width / 2, 40), y: rect.top + rect.height / 2 };
  }

  /** Hidden while the background captures a screenshot, so the model sees the page itself. */
  async function setOverlayVisible({ visible }) {
    if (overlayHost) overlayHost.style.visibility = visible ? '' : 'hidden';
    await nextPaint();
    return true;
  }

  // Redraw the cursor where it was before a navigation, in Plum-managed tabs only.
  const restoreCursor = () =>
    browser.runtime
      .sendMessage({ plumCursorState: true })
      .then((answer) => {
        if (answer && answer.managed && answer.cursor && !cursorPos) {
          cursorPos = { x: answer.cursor.x, y: answer.cursor.y };
          placeCursor(cursorPos.x, cursorPos.y, 0);
        }
      })
      .catch(() => {});
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreCursor, { once: true });
  } else {
    void restoreCursor();
  }

  // ------------------------------------------------------------ dispatcher

  function checkPresence({ text, selector }) {
    if (selector) {
      const el = document.querySelector(selector);
      return !!el && isVisible(el);
    }
    return (document.body?.innerText || '').toLowerCase().includes(String(text).toLowerCase());
  }

  const OPS = {
    viewport: () => ({
      width: innerWidth,
      height: innerHeight,
      scrollX: Math.round(scrollX),
      scrollY: Math.round(scrollY),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      dpr: devicePixelRatio,
    }),
    check: checkPresence,
    overlay: setOverlayVisible,
    history: ({ delta }) => {
      history.go(Number(delta) || -1);
      return true;
    },
    read_page: readPage,
    find,
    get_page_text: pageText,
    click,
    hover,
    type,
    press_key: pressKey,
    scroll,
    form_input: formInput,
    read_console: readConsole,
    evaluate_js: evaluateJs,
  };

  const QUIET_OPS = new Set(['viewport', 'check', 'overlay', 'history']);
  const LABELS = {
    read_page: 'liest',
    find: 'sucht',
    get_page_text: 'liest',
    click: 'klickt',
    hover: 'zeigt',
    type: 'tippt',
    press_key: 'drückt Tasten',
    scroll: 'scrollt',
    form_input: 'füllt Formular',
    read_console: 'liest Konsole',
    evaluate_js: 'führt JS aus',
  };

  // Reply through sendResponse: Chrome ignores a promise returned by the listener.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.plum !== true) return false;
    const handler = OPS[message.op];
    if (!handler) {
      sendResponse({ error: `Unbekannte Operation ${message.op}` });
      return false;
    }
    outScale = Number(message.args && message.args._scale) || 1;
    if (!QUIET_OPS.has(message.op)) {
      hookConsole();
      showActivity(LABELS[message.op] || message.op);
    }
    Promise.resolve()
      .then(() => handler(message.args || {}))
      .then((result) => sendResponse({ result }))
      .catch((error) =>
        sendResponse({ error: String(error && error.message ? error.message : error) })
      );
    return true;
  });
})();
