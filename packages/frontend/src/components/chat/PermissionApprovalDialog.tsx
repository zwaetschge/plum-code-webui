import { useState, useCallback, useId } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Shield,
  ShieldCheck,
  ShieldX,
  ChevronDown,
  ChevronRight,
  FileText,
  Terminal,
  Globe,
  FolderSearch,
  Search,
  Edit3,
  Wrench,
} from 'lucide-react';
import type { PendingPermission, PermissionAction } from '@plum-code-webui/shared';
import { useProviderStore } from '@/stores/providerStore';
import { UI_PROVIDER_META } from '@/lib/providers';

interface PermissionApprovalDialogProps {
  permission: PendingPermission;
  onRespond: (action: PermissionAction, pattern?: string) => void;
  providerLabel?: string;
}

// Get icon for tool name
function getToolIcon(toolName: string) {
  const iconMap: Record<string, typeof Wrench> = {
    Bash: Terminal,
    Read: Search,
    Write: FileText,
    Edit: Edit3,
    Glob: FolderSearch,
    Grep: Search,
    WebFetch: Globe,
    WebSearch: Globe,
  };
  return iconMap[toolName] || Wrench;
}

// Extract command or file path for display
function getToolPreview(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const inputObj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return String(inputObj.command || '');
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(inputObj.file_path || '');
    case 'Glob':
    case 'Grep':
      return String(inputObj.pattern || '');
    case 'WebFetch':
      return String(inputObj.url || '');
    case 'WebSearch':
      return String(inputObj.query || '');
    default:
      return JSON.stringify(input).substring(0, 100);
  }
}

// Test if a pattern matches a given test string
function testPattern(pattern: string, testString: string): boolean {
  // Claude patterns use prefix matching with :* wildcard
  // e.g., "Bash(git checkout:*)" matches "git checkout main"

  // Extract the pattern content (between parentheses)
  const match = pattern.match(/^(\w+)\((.*)\)$/);
  if (!match) return false;

  const [, , patternContent] = match;
  if (!patternContent) return false;

  // Handle :* wildcard (prefix match)
  if (patternContent.endsWith(':*')) {
    const prefix = patternContent.slice(0, -2);
    return testString.startsWith(prefix);
  }

  // Exact match
  return testString === patternContent;
}

export function PermissionApprovalDialog({
  permission,
  onRespond,
  providerLabel: explicitProviderLabel,
}: PermissionApprovalDialogProps) {
  const { uiProvider } = useProviderStore();
  const providerLabel = explicitProviderLabel ?? UI_PROVIDER_META[uiProvider].label;
  const [showPatternEditor, setShowPatternEditor] = useState(false);
  const [pattern, setPattern] = useState(permission.suggestedPattern);
  const [testValue, setTestValue] = useState(
    getToolPreview(permission.toolName, permission.toolInput)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const patternId = useId();
  const testValueId = useId();

  const Icon = getToolIcon(permission.toolName);
  const preview = getToolPreview(permission.toolName, permission.toolInput);
  const testResult = testPattern(pattern, testValue);

  const handleRespond = useCallback(
    async (action: PermissionAction) => {
      setIsSubmitting(true);
      try {
        // For allow_project and allow_global, include the pattern
        if (action === 'allow_project' || action === 'allow_global') {
          await onRespond(action, pattern);
        } else {
          await onRespond(action);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [onRespond, pattern]
  );

  return (
    // A real dialog rather than a styled overlay: this is the most consequential
    // control on the page, and as a plain div it announced nothing to a screen
    // reader and left the focus behind it, so Tab walked off into the chat.
    // Radix supplies the role, aria-modal, the focus trap and focus restore.
    // Neither Escape nor a click outside dismisses it — there is no "later" for
    // a permission request, only allow or deny.
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed left-[50%] top-[50%] z-50 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] overflow-y-auto rounded-lg border border-border bg-background p-0 shadow-xl max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 border-b border-border flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Shield className="h-6 w-6 text-amber-500" />
            </div>
            <div>
              <DialogPrimitive.Title className="font-semibold text-lg">
                Permission Required
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                {providerLabel} wants to use the {permission.toolName} tool
              </DialogPrimitive.Description>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Tool info */}
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{permission.toolName}</span>
              </div>
              {preview && (
                <code className="block text-sm bg-muted/50 p-2 rounded font-mono break-all">
                  {preview.length > 200 ? preview.substring(0, 200) + '...' : preview}
                </code>
              )}
              {permission.description &&
                permission.description !== `${permission.toolName} tool` && (
                  <p className="text-sm text-muted-foreground mt-2">{permission.description}</p>
                )}
            </div>

            {/* Pattern editor (collapsible) */}
            <div className="border border-border rounded-lg">
              <button
                type="button"
                aria-expanded={showPatternEditor}
                className="w-full p-3 flex items-center gap-2 text-sm font-medium hover:bg-muted/30 transition-colors"
                onClick={() => setShowPatternEditor(!showPatternEditor)}
              >
                {showPatternEditor ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Edit Permission Pattern
              </button>

              {showPatternEditor && (
                <div className="p-3 pt-0 space-y-3 border-t border-border">
                  <div>
                    <label htmlFor={patternId} className="text-xs text-muted-foreground block mb-1">
                      Pattern
                    </label>
                    <input
                      id={patternId}
                      type="text"
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      className="w-full p-2 bg-muted/30 border border-border rounded text-sm font-mono"
                      placeholder="e.g., Bash(git checkout:*)"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use <code>:*</code> suffix for prefix matching (e.g., <code>git:*</code>{' '}
                      matches all git commands)
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor={testValueId}
                      className="text-xs text-muted-foreground block mb-1"
                    >
                      Test Pattern
                    </label>
                    <input
                      id={testValueId}
                      type="text"
                      value={testValue}
                      onChange={(e) => setTestValue(e.target.value)}
                      className="w-full p-2 bg-muted/30 border border-border rounded text-sm font-mono"
                      placeholder="Enter a value to test"
                    />
                    <div
                      className={`mt-1 text-xs flex items-center gap-1 ${testResult ? 'text-green-500' : 'text-red-500'}`}
                    >
                      {testResult ? (
                        <>
                          <ShieldCheck className="h-3 w-3" />
                          Pattern matches
                        </>
                      ) : (
                        <>
                          <ShieldX className="h-3 w-3" />
                          Pattern does not match
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-border space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => handleRespond('allow_once')}
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
              >
                <ShieldCheck className="h-4 w-4" />
                Allow Once
              </button>
              <button
                onClick={() => handleRespond('deny')}
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
              >
                <ShieldX className="h-4 w-4" />
                Deny
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => handleRespond('allow_project')}
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors text-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                Allow for Project
              </button>
              <button
                onClick={() => handleRespond('allow_global')}
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors text-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                Allow Globally
              </button>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              Project saves to <code>.claude/settings.local.json</code>, Global saves to{' '}
              <code>~/.claude/settings.json</code>
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
