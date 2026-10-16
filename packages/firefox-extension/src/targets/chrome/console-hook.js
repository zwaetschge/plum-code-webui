// Chrome MAIN-world console hook for Plum-managed tabs. Runs only on hosts
// whose console an agent asked for: registered at document_start for those
// (so a reload sees the page's first messages) and injected on demand
// otherwise; forwards to the isolated content script via postMessage.
// Idempotent.
//
// The wrapper is installed through an inline <script>, so it belongs to the
// page: wrapped from this file, Chrome lists every console warning of the
// site as an error of the extension. Pages whose CSP forbids inline scripts
// stay unhooked; an explicit read_console calls window.__plumInstallConsoleHook
// (defined here) to wrap from the extension after all.

function plumInstallConsoleHook() {
  if (window.__plumConsoleHook) return;
  window.__plumConsoleHook = true;
  const toText = (arg) => {
    try {
      if (arg === undefined) return 'undefined';
      if (arg === null) return 'null';
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof arg === 'object') return JSON.stringify(arg).slice(0, 2000);
      return String(arg);
    } catch {
      return String(arg);
    }
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level];
    console[level] = function (...args) {
      window.postMessage(
        { __plumConsole: true, level, text: args.map(toText).join(' ').slice(0, 4000) },
        '*'
      );
      return original.apply(this, args);
    };
  }
}

window.__plumInstallConsoleHook = plumInstallConsoleHook;
(() => {
  if (window.__plumConsoleHook) return;
  try {
    const script = document.createElement('script');
    script.textContent = `(${plumInstallConsoleHook.toString()})();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  } catch {
    /* no document yet */
  }
})();
