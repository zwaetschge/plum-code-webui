import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Github,
  AlertCircle,
  ExternalLink,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/authStore';
import { ProviderLogo } from '@/components/branding/ProviderLogo';
import { UI_PROVIDER_META, type UiProvider } from '@/lib/providers';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { LOGIN_WAVE_MOTIONS, startAmbientMotion } from '@/lib/ambientMotion';

const errorMessages: Record<string, string> = {
  github: 'GitHub authentication failed. Please try again.',
  google: 'Google authentication failed. Please try again.',
  claude: 'Claude authentication failed. Please try again.',
  claude_not_logged_in:
    'Claude CLI not logged in. Use the WebUI login below or run "claude /login".',
  codex: 'Codex authentication failed. Please try again.',
  codex_not_logged_in: 'Codex CLI not logged in. Run "codex login" first.',
  opencode: 'OpenCode authentication failed. Please try again.',
  opencode_not_logged_in: 'OpenCode CLI not logged in. Run "opencode auth login" first.',
  pi: 'Pi authentication failed. Please try again.',
  pi_not_available: 'Pi is not available. Configure an OpenCode API connection first.',
  vibe: 'Mistral Vibe authentication failed. Please try again.',
  vibe_not_logged_in:
    'Mistral Vibe is not signed in. Connect it under Settings → Providers → Provider logins.',
  unauthorized: 'You are not authorized. Please sign in.',
  expired: 'Your session has expired. Please sign in again.',
};

interface AuthProviders {
  github: boolean;
  google: boolean;
  claude: boolean;
  codex?: boolean;
  opencode?: boolean;
  pi?: boolean;
  vibe?: boolean;
}

type CliLoginStatus = 'starting' | 'awaiting_code' | 'completed' | 'error';

interface CliLoginResponse {
  success: boolean;
  data: {
    id: string;
    status: CliLoginStatus;
    loginUrl: string | null;
    output: string;
    error: string | null;
  };
}

// Provider brand configurations
type ProviderStyleKey = 'claude' | 'codex' | 'opencode' | 'pi';
const providerStyles: Record<
  ProviderStyleKey,
  {
    bg: string;
    hover: string;
    text: string;
  }
> = {
  claude: {
    bg: 'provider-login-button provider-login-button-claude',
    hover: '',
    text: 'text-white',
  },
  codex: {
    bg: 'provider-login-button provider-login-button-codex',
    hover: '',
    text: 'text-white',
  },
  opencode: {
    bg: 'provider-login-button provider-login-button-opencode',
    hover: '',
    text: 'text-white',
  },
  pi: {
    bg: 'provider-login-button provider-login-button-opencode',
    hover: '',
    text: 'text-white',
  },
};

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isLoading } = useAuthStore();
  const error = searchParams.get('error');
  const [claudeLoginOpen, setClaudeLoginOpen] = useState(false);
  const [claudeLoginId, setClaudeLoginId] = useState<string | null>(null);
  const [claudeLoginUrl, setClaudeLoginUrl] = useState<string | null>(null);
  const [claudeLoginStatus, setClaudeLoginStatus] = useState<CliLoginStatus | 'idle'>('idle');
  const [claudeLoginOutput, setClaudeLoginOutput] = useState('');
  const [claudeLoginError, setClaudeLoginError] = useState<string | null>(null);
  const [claudeLoginCode, setClaudeLoginCode] = useState('');
  const [claudeLoginWorking, setClaudeLoginWorking] = useState(false);
  const [claudeLoginOpened, setClaudeLoginOpened] = useState(false);
  const [hoveredProvider, setHoveredProvider] = useState<string | null>(null);
  const waveRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => startAmbientMotion(waveRefs.current, LOGIN_WAVE_MOTIONS), []);

  // Fetch available auth providers
  const { data: providers } = useQuery({
    queryKey: ['auth-providers'],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: AuthProviders }>('/auth/providers');
      return response.data.data;
    },
  });

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/');
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    if (!claudeLoginOpen) {
      setClaudeLoginId(null);
      setClaudeLoginUrl(null);
      setClaudeLoginStatus('idle');
      setClaudeLoginOutput('');
      setClaudeLoginError(null);
      setClaudeLoginCode('');
      setClaudeLoginWorking(false);
      setClaudeLoginOpened(false);
    }
  }, [claudeLoginOpen]);

  useEffect(() => {
    if (!claudeLoginOpen || !claudeLoginId) return;
    if (claudeLoginStatus === 'completed' || claudeLoginStatus === 'error') return;

    const timer = setInterval(async () => {
      try {
        const response = await api.get<CliLoginResponse>(`/api/cli-login/${claudeLoginId}`);
        const data = response.data.data;
        setClaudeLoginStatus(data.status);
        setClaudeLoginUrl(data.loginUrl);
        setClaudeLoginOutput(data.output || '');
        setClaudeLoginError(data.error);
      } catch (err) {
        setClaudeLoginError(err instanceof Error ? err.message : 'Failed to check login');
        setClaudeLoginStatus('error');
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [claudeLoginOpen, claudeLoginId, claudeLoginStatus]);

  useEffect(() => {
    if (!claudeLoginOpen || !claudeLoginUrl || claudeLoginOpened) return;
    const popup = window.open(claudeLoginUrl, '_blank', 'noopener,noreferrer');
    if (popup) {
      setClaudeLoginOpened(true);
    }
  }, [claudeLoginOpen, claudeLoginUrl, claudeLoginOpened]);

  const handleGitHubLogin = () => {
    window.location.href = '/auth/github';
  };

  const handleGoogleLogin = () => {
    window.location.href = '/auth/google';
  };

  const handleProviderLogin = (provider: UiProvider) => {
    const routes: Record<string, string> = {
      codex: '/auth/codex',
      opencode: '/auth/opencode',
      pi: '/auth/pi',
      claude: '/auth/claude',
    };
    window.location.href = routes[provider] || '/auth/codex';
  };

  const startClaudeLogin = async () => {
    setClaudeLoginWorking(true);
    setClaudeLoginError(null);
    setClaudeLoginOutput('');
    setClaudeLoginOpened(false);
    setClaudeLoginStatus('starting');

    try {
      const response = await api.post<CliLoginResponse>(`/api/cli-login/claude/start`);
      const data = response.data.data;
      setClaudeLoginId(data.id);
      setClaudeLoginStatus(data.status);
      setClaudeLoginUrl(data.loginUrl);
      setClaudeLoginOutput(data.output || '');
      setClaudeLoginError(data.error);
    } catch (err) {
      setClaudeLoginError(err instanceof Error ? err.message : 'Failed to start login');
      setClaudeLoginStatus('error');
    } finally {
      setClaudeLoginWorking(false);
    }
  };

  const submitClaudeLoginCode = async () => {
    if (!claudeLoginId || !claudeLoginCode.trim()) return;
    setClaudeLoginWorking(true);
    setClaudeLoginError(null);

    try {
      const response = await api.post<CliLoginResponse>(`/api/cli-login/${claudeLoginId}/code`, {
        code: claudeLoginCode.trim(),
      });
      const data = response.data.data;
      setClaudeLoginStatus(data.status);
      setClaudeLoginUrl(data.loginUrl);
      setClaudeLoginOutput(data.output || '');
      setClaudeLoginError(data.error);
    } catch (err) {
      setClaudeLoginError(err instanceof Error ? err.message : 'Failed to submit code');
      setClaudeLoginStatus('error');
    } finally {
      setClaudeLoginWorking(false);
    }
  };

  // Count available CLI providers
  const availableProviders = [
    providers?.codex && 'codex',
    providers?.opencode && 'opencode',
    providers?.pi && 'pi',
    providers?.claude && 'claude',
  ].filter(Boolean);
  const loginGalaxyProvider = hoveredProvider || 'plum';

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      <div
        className={cn(
          'fixed inset-0 overflow-hidden pointer-events-none login-galaxy',
          `login-galaxy-${loginGalaxyProvider}`
        )}
      >
        <div
          ref={(element) => {
            waveRefs.current[0] = element;
          }}
          className="login-galaxy-band login-galaxy-band-main"
        />
        <div
          ref={(element) => {
            waveRefs.current[1] = element;
          }}
          className="login-galaxy-band login-galaxy-band-cross"
        />
        <div className="login-galaxy-haze" />
      </div>

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex">
        {/* Left side - Branding */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 xl:p-16">
          <div>
            <div className="mb-16">
              <img
                src="/logos/plum-banner.png"
                alt="Plum Code WebUI"
                className="h-auto w-72 max-w-full object-contain object-left xl:w-80"
              />
            </div>

            <div className="space-y-6 max-w-lg">
              <h1 className="text-5xl xl:text-6xl font-bold tracking-tight leading-[1.1]">
                <span className="block">Code with</span>
                <span className="block bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent bg-[length:200%_auto] animate-[gradient_8s_linear_infinite]">
                  Intelligence
                </span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed">
                A unified interface for AI-powered coding assistants. Connect your favorite CLI
                tools and start building.
              </p>
            </div>
          </div>

          {/* Provider showcase */}
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-widest text-muted-foreground/60">
              Supported Providers
            </p>
            <div className="flex items-center gap-6">
              {['codex', 'opencode', 'pi', 'claude'].map((p, i) => (
                <div
                  key={p}
                  className="opacity-40 hover:opacity-100 transition-opacity duration-300"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <ProviderLogo
                    provider={p as UiProvider}
                    className="h-8 w-8 grayscale hover:grayscale-0 transition-all duration-300"
                    alt={p}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right side - Login form */}
        <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-12 xl:px-20">
          <div className="mx-auto w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden mb-10 text-center">
              <img
                src="/logos/plum-banner.png"
                alt="Plum Code WebUI"
                className="mx-auto mb-4 h-auto w-56 max-w-full object-contain"
              />
              <p className="text-sm text-muted-foreground">Connect your CLI provider to continue</p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-6 flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive animate-in slide-in-from-top-2 duration-300">
                <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <p>{errorMessages[error] || 'An error occurred. Please try again.'}</p>
              </div>
            )}

            {/* Provider buttons */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground mb-4 lg:hidden">
                Connect a CLI provider
              </p>

              {providers?.codex && (
                <button
                  onClick={() => handleProviderLogin('codex')}
                  onMouseEnter={() => setHoveredProvider('codex')}
                  onMouseLeave={() => setHoveredProvider(null)}
                  className={cn(
                    'group relative w-full h-14 rounded-lg font-medium text-base transition-all duration-300',
                    'flex items-center justify-between px-5',
                    providerStyles.codex.bg,
                    providerStyles.codex.hover,
                    providerStyles.codex.text,
                    'hover:scale-[1.02] active:scale-[0.98]'
                  )}
                >
                  <span className="flex items-center gap-3">
                    <ProviderLogo provider="codex" className="h-6 w-6" alt="" />
                    <span>{UI_PROVIDER_META.codex.loginCta}</span>
                  </span>
                  <ArrowRight className="h-5 w-5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                </button>
              )}

              {providers?.opencode && (
                <div className="space-y-2">
                  <button
                    onClick={() => handleProviderLogin('opencode')}
                    onMouseEnter={() => setHoveredProvider('opencode')}
                    onMouseLeave={() => setHoveredProvider(null)}
                    className={cn(
                      'group relative w-full h-14 rounded-lg font-medium text-base transition-all duration-300',
                      'flex items-center justify-between px-5',
                      providerStyles.opencode.bg,
                      providerStyles.opencode.hover,
                      providerStyles.opencode.text,
                      'hover:scale-[1.02] active:scale-[0.98]'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <ProviderLogo provider="opencode" className="h-6 w-6" alt="" />
                      <span>Sign in with OpenCode</span>
                    </span>
                    <ArrowRight className="h-5 w-5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                  </button>
                </div>
              )}

              {providers?.pi && (
                <div className="space-y-2">
                  <button
                    onClick={() => handleProviderLogin('pi')}
                    onMouseEnter={() => setHoveredProvider('pi')}
                    onMouseLeave={() => setHoveredProvider(null)}
                    className={cn(
                      'group relative w-full h-14 rounded-lg font-medium text-base transition-all duration-300',
                      'flex items-center justify-between px-5',
                      providerStyles.pi.bg,
                      providerStyles.pi.hover,
                      providerStyles.pi.text,
                      'hover:scale-[1.02] active:scale-[0.98]'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <ProviderLogo provider="pi" className="h-6 w-6" alt="" />
                      <span>{UI_PROVIDER_META.pi.loginCta}</span>
                    </span>
                    <ArrowRight className="h-5 w-5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                  </button>
                  <p className="px-1 text-xs text-muted-foreground/60">
                    Uses the API connections configured for OpenCode.
                  </p>
                </div>
              )}

              {providers?.claude && (
                <div className="space-y-2 pt-2">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50">
                    Legacy
                  </p>
                  <button
                    onClick={() => handleProviderLogin('claude')}
                    onMouseEnter={() => setHoveredProvider('claude')}
                    onMouseLeave={() => setHoveredProvider(null)}
                    className={cn(
                      'group relative w-full h-14 rounded-lg font-medium text-base transition-all duration-300',
                      'flex items-center justify-between px-5',
                      providerStyles.claude.bg,
                      providerStyles.claude.hover,
                      providerStyles.claude.text,
                      'hover:scale-[1.02] active:scale-[0.98]'
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <ProviderLogo
                        provider="claude"
                        className="h-6 w-6 brightness-0 invert"
                        alt=""
                      />
                      <span>{UI_PROVIDER_META.claude.loginCta}</span>
                    </span>
                    <ArrowRight className="h-5 w-5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                  </button>

                  <Dialog open={claudeLoginOpen} onOpenChange={setClaudeLoginOpen}>
                    <DialogTrigger asChild>
                      <button className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-2 flex items-center justify-center gap-2">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Login via WebUI instead
                      </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-xl">
                      <DialogHeader>
                        <DialogTitle>Claude CLI Login</DialogTitle>
                        <DialogDescription>
                          Start a login session, open the authorization link, then paste the code.
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4">
                        {claudeLoginError && (
                          <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            <p>{claudeLoginError}</p>
                          </div>
                        )}

                        {claudeLoginStatus === 'completed' && (
                          <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600">
                            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                            <p>Claude CLI connected. Refresh usage meters to confirm.</p>
                          </div>
                        )}

                        <div className="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                Step 1
                              </p>
                              <p className="text-sm font-medium">Start login session</p>
                            </div>
                            <Button
                              type="button"
                              onClick={startClaudeLogin}
                              disabled={
                                claudeLoginWorking ||
                                claudeLoginStatus === 'awaiting_code' ||
                                claudeLoginStatus === 'completed'
                              }
                            >
                              {claudeLoginWorking && claudeLoginStatus === 'starting'
                                ? 'Starting...'
                                : 'Start login'}
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Step 2
                            </p>
                            <p className="text-sm font-medium">Open the authorization link</p>
                          </div>
                          <div className="flex gap-2">
                            <Input
                              value={claudeLoginUrl || ''}
                              readOnly
                              placeholder="Waiting for login link..."
                              className="text-xs"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                claudeLoginUrl &&
                                window.open(claudeLoginUrl, '_blank', 'noopener,noreferrer')
                              }
                              disabled={!claudeLoginUrl}
                            >
                              Open
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-3">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              Step 3
                            </p>
                            <p className="text-sm font-medium">Paste the code</p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="claude-login-code">Verification code</Label>
                            <div className="flex gap-2">
                              <Input
                                id="claude-login-code"
                                value={claudeLoginCode}
                                onChange={(event) => setClaudeLoginCode(event.target.value)}
                                placeholder="Paste code from browser"
                                disabled={!claudeLoginId || claudeLoginStatus === 'completed'}
                              />
                              <Button
                                type="button"
                                onClick={submitClaudeLoginCode}
                                disabled={
                                  !claudeLoginId ||
                                  !claudeLoginCode.trim() ||
                                  claudeLoginWorking ||
                                  claudeLoginStatus === 'completed'
                                }
                              >
                                Submit
                              </Button>
                            </div>
                          </div>
                        </div>

                        {claudeLoginOutput && (
                          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap max-h-40 overflow-auto">
                            {claudeLoginOutput}
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </div>

            {/* Divider */}
            {(providers?.github || providers?.google) && availableProviders.length > 0 && (
              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/50" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-3 text-muted-foreground/60 tracking-widest">
                    or continue with
                  </span>
                </div>
              </div>
            )}

            {/* OAuth providers */}
            <div className="grid grid-cols-2 gap-3">
              {providers?.github && (
                <button
                  onClick={handleGitHubLogin}
                  className={cn(
                    'h-12 rounded-xl font-medium text-sm transition-all duration-300',
                    'flex items-center justify-center gap-2 px-4',
                    'bg-card border border-border/60 hover:border-border',
                    'hover:bg-muted/50 active:scale-[0.98]'
                  )}
                >
                  <Github className="h-5 w-5" />
                  <span>GitHub</span>
                </button>
              )}

              {providers?.google && (
                <button
                  onClick={handleGoogleLogin}
                  className={cn(
                    'h-12 rounded-xl font-medium text-sm transition-all duration-300',
                    'flex items-center justify-center gap-2 px-4',
                    'bg-card border border-border/60 hover:border-border',
                    'hover:bg-muted/50 active:scale-[0.98]'
                  )}
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  <span>Google</span>
                </button>
              )}
            </div>

            {/* No providers message */}
            {!providers?.codex &&
              !providers?.opencode &&
              !providers?.pi &&
              !providers?.claude &&
              !providers?.github &&
              !providers?.google && (
                <div className="text-center py-8">
                  <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/40 mb-4" />
                  <p className="text-sm text-muted-foreground">
                    No authentication providers configured.
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Contact your administrator to set up CLI providers.
                  </p>
                </div>
              )}

            {/* Footer note */}
            <p className="mt-8 text-center text-xs text-muted-foreground/60">
              Appearance controls are available after connecting.
            </p>

            <Button
              variant="ghost"
              asChild
              className="mt-4 w-full text-muted-foreground hover:text-foreground"
            >
              <Link to="/">
                <ArrowRight className="h-4 w-4 mr-2 rotate-180" />
                Back to dashboard
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* CSS for gradient animation */}
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% center; }
          50% { background-position: 100% center; }
        }
      `}</style>
    </div>
  );
}
