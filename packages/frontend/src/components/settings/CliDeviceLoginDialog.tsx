import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  KeyRound,
  Loader2,
  Terminal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { api } from '@/services/api';

type CliLoginProvider = 'claude' | 'codex' | 'kimi' | 'pi' | 'vibe';
type CliLoginStatus = 'starting' | 'awaiting_code' | 'completed' | 'error';

interface CliLoginData {
  id: string;
  provider: CliLoginProvider;
  status: CliLoginStatus;
  loginUrl: string | null;
  verificationCode: string | null;
  output: string;
  error: string | null;
}

interface CliLoginResponse {
  success: boolean;
  data: CliLoginData;
}

interface CliDeviceLoginDialogProps {
  provider: CliLoginProvider;
  authenticated?: boolean;
  disabled?: boolean;
  onCompleted?: () => void | Promise<unknown>;
  triggerClassName?: string;
}

const PROVIDER_COPY = {
  codex: {
    name: 'Codex',
    account: 'ChatGPT',
    description:
      'Start device authorization in Plum, then enter the one-time code in the OpenAI page.',
  },
  claude: {
    name: 'Claude Code',
    account: 'Claude subscription',
    description:
      'Start Anthropic authorization in Plum, finish it in your browser, and paste a returned code if requested.',
  },
  pi: {
    name: 'Antigravity',
    account: 'Google',
    description:
      'Plum drives Pi’s login for you. Sign in with Google; the browser then lands on a localhost page that does not load. Copy that page’s full address and paste it below.',
  },
  kimi: {
    name: 'Kimi Code',
    account: 'Kimi account',
    description:
      'Start Kimi device authorization in Plum, open the verification URL in your browser, and approve it. Kimi polls automatically — no code entry needed.',
  },
  vibe: {
    name: 'Mistral Vibe',
    account: 'Mistral account',
    description:
      'Start the Mistral sign-in in Plum, open the URL in your browser, and approve it. Vibe keeps the key itself — no code entry needed.',
  },
} satisfies Record<CliLoginProvider, { name: string; account: string; description: string }>;

function isTerminal(status: CliLoginStatus | 'idle') {
  return status === 'completed' || status === 'error';
}

export function CliDeviceLoginDialog({
  provider,
  authenticated = false,
  disabled = false,
  onCompleted,
  triggerClassName,
}: CliDeviceLoginDialogProps) {
  const copy = PROVIDER_COPY[provider];
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState<CliLoginData | null>(null);
  const [status, setStatus] = useState<CliLoginStatus | 'idle'>('idle');
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const completedRef = useRef(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && login?.id) {
      void api.delete(`/api/cli-login/${login.id}`).catch(() => undefined);
    }
    setOpen(nextOpen);
  };

  useEffect(() => {
    if (open) return;
    setLogin(null);
    setStatus('idle');
    setCode('');
    setWorking(false);
    completedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || !login?.id || isTerminal(status)) return;

    const timer = window.setInterval(async () => {
      try {
        const response = await api.get<CliLoginResponse>(`/api/cli-login/${login.id}`);
        setLogin(response.data.data);
        setStatus(response.data.data.status);
      } catch (error) {
        setLogin((current) =>
          current
            ? {
                ...current,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unable to check login status.',
              }
            : current
        );
        setStatus('error');
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [login?.id, open, status]);

  useEffect(() => {
    if (status !== 'completed' || completedRef.current) return;
    completedRef.current = true;
    void onCompleted?.();
  }, [onCompleted, status]);

  const startLogin = async () => {
    setWorking(true);
    setStatus('starting');
    setLogin(null);
    setCode('');
    completedRef.current = false;

    try {
      const response = await api.post<CliLoginResponse>(`/api/cli-login/${provider}/start`);
      setLogin(response.data.data);
      setStatus(response.data.data.status);
    } catch (error) {
      setStatus('error');
      setLogin({
        id: '',
        provider,
        status: 'error',
        loginUrl: null,
        verificationCode: null,
        output: '',
        error: error instanceof Error ? error.message : 'Unable to start device login.',
      });
    } finally {
      setWorking(false);
    }
  };

  const submitCode = async () => {
    if (!login?.id || !code.trim()) return;
    setWorking(true);
    try {
      const response = await api.post<CliLoginResponse>(`/api/cli-login/${login.id}/code`, {
        code: code.trim(),
      });
      setLogin(response.data.data);
      setStatus(response.data.data.status);
    } catch (error) {
      setLogin((current) =>
        current
          ? {
              ...current,
              status: 'error',
              error: error instanceof Error ? error.message : 'Unable to submit the code.',
            }
          : current
      );
      setStatus('error');
    } finally {
      setWorking(false);
    }
  };

  const copyVerificationCode = async () => {
    if (!login?.verificationCode) return;
    try {
      await navigator.clipboard.writeText(login.verificationCode);
      toast({ title: 'Device code copied' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Select the device code and copy it manually.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={authenticated ? 'outline' : 'default'}
          size="sm"
          disabled={disabled}
          className={triggerClassName}
        >
          <KeyRound className="h-3.5 w-3.5" />
          {authenticated ? `Reconnect ${copy.name}` : `Connect ${copy.name}`}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.name} device login</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {login?.error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{login.error}</p>
            </div>
          )}

          {status === 'completed' && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">{copy.account} connected</p>
                <p className="mt-0.5 text-xs opacity-80">
                  New {copy.name} sessions can use the saved credentials immediately.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Step 1
                </p>
                <p className="mt-1 text-sm font-medium">Start a secure login session</p>
              </div>
              <Button
                type="button"
                onClick={startLogin}
                disabled={working || status === 'starting' || status === 'awaiting_code'}
                className="shrink-0 gap-2"
              >
                {working || status === 'starting' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : status === 'completed' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {status === 'completed'
                  ? 'Connected'
                  : status === 'awaiting_code'
                    ? 'Waiting for approval'
                    : 'Start login'}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Step 2
            </p>
            <p className="mt-1 text-sm font-medium">Authorize in your browser</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                value={login?.loginUrl || ''}
                readOnly
                aria-label={`${copy.name} authorization URL`}
                placeholder="The authorization URL will appear here."
                className="min-w-0 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!login?.loginUrl}
                onClick={() =>
                  login?.loginUrl && window.open(login.loginUrl, '_blank', 'noopener,noreferrer')
                }
                className="shrink-0 gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </Button>
            </div>

            {login?.verificationCode && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">One-time device code</p>
                  <code className="mt-1 block select-all text-lg font-semibold tracking-[0.18em]">
                    {login.verificationCode}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyVerificationCode}
                  className="shrink-0 gap-2"
                >
                  <Clipboard className="h-3.5 w-3.5" />
                  Copy code
                </Button>
              </div>
            )}
          </div>

          {(provider === 'claude' || provider === 'pi') &&
            status !== 'idle' &&
            status !== 'completed' && (
              <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Step 3
                </p>
                <p className="mt-1 text-sm font-medium">
                  {provider === 'pi'
                    ? 'Paste the address of the page Google redirected you to'
                    : 'Return the authorization code if prompted'}
                </p>
                {provider === 'pi' && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    It starts with <code>http://localhost:51121/oauth-callback?</code> — the page
                    itself shows an error, that is expected.
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  <Label htmlFor={`${provider}-device-login-code`}>
                    {provider === 'pi' ? 'Redirect URL' : 'Authorization code'}
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id={`${provider}-device-login-code`}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && code.trim()) void submitCode();
                      }}
                      placeholder={
                        provider === 'pi'
                          ? 'http://localhost:51121/oauth-callback?state=…&code=…'
                          : 'Paste the code shown by Anthropic'
                      }
                      disabled={!login?.id || working}
                    />
                    <Button
                      type="button"
                      onClick={submitCode}
                      disabled={!login?.id || !code.trim() || working}
                      className="shrink-0"
                    >
                      Submit
                    </Button>
                  </div>
                </div>
              </div>
            )}

          {login?.output && status !== 'completed' && (
            <details className="rounded-lg border border-border/70 bg-muted/20">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                Login details
              </summary>
              <pre className="max-h-40 overflow-auto border-t border-border/70 px-4 py-3 text-xs whitespace-pre-wrap">
                {login.output}
              </pre>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
