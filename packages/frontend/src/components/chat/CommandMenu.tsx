import { useEffect, useRef } from 'react';
import { Command } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Terminal, User, FolderGit } from 'lucide-react';

interface CommandMenuProps {
  commands: Command[];
  filter: string;
  selectedIndex: number;
  onSelect: (command: Command) => void;
  onClose: () => void;
}

export function CommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
  onClose,
}: CommandMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Filter commands based on input
  const filteredCommands = commands.filter((cmd) =>
    cmd.name.toLowerCase().includes(filter.toLowerCase())
  );

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  if (filteredCommands.length === 0) {
    return null;
  }

  const getScopeIcon = (scope: string) => {
    switch (scope) {
      case 'builtin':
        return <Terminal className="h-3.5 w-3.5 text-blue-500" />;
      case 'user':
        return <User className="h-3.5 w-3.5 text-green-500" />;
      case 'project':
        return <FolderGit className="h-3.5 w-3.5 text-purple-500" />;
      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      className="plum-popup absolute bottom-full mb-2 left-0 right-0 border rounded-lg shadow-lg overflow-hidden z-50"
    >
      <div className="px-3 py-2 border-b bg-muted/50">
        <span className="text-xs text-muted-foreground">Commands</span>
      </div>
      <ScrollArea className="max-h-[240px]">
        <div className="p-1">
          {filteredCommands.map((cmd, index) => (
            <button
              key={`${cmd.scope}-${cmd.name}`}
              ref={index === selectedIndex ? selectedRef : undefined}
              onClick={() => onSelect(cmd)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-left rounded-md transition-colors',
                index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
              )}
            >
              {getScopeIcon(cmd.scope)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">/{cmd.name}</span>
                  {cmd.arguments && cmd.arguments.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {cmd.arguments.map((a) => `<${a}>`).join(' ')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
