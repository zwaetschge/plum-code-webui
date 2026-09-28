// Chrome MAIN-world console hook for Plum-managed tabs. Registered for the
// origins of session tabs at document_start (so a reload sees the page's first
// messages) and injected on demand otherwise; forwards to the isolated content
// script via postMessage. Idempotent.
(() => {
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
})();
