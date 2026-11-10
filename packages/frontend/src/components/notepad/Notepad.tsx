import { useState, useEffect, useCallback, useRef } from 'react';
import { StickyNote, Plus, Trash2, Pin, PinOff, Send, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';

interface Note {
  id: string;
  user_id: string;
  session_id: string | null;
  title: string;
  content: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface NotepadProps {
  sessionId?: string;
  onSendToChat?: (content: string) => void;
  className?: string;
}

interface ApiNotesResponse {
  success: boolean;
  data?: Note[];
}

interface ApiNoteResponse {
  success: boolean;
  data?: Note;
}

export function Notepad({ sessionId, onSendToChat, className }: NotepadProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const debouncedContent = useDebounce(content, 500);
  const debouncedTitle = useDebounce(title, 500);
  // Note the edits belong to: the debounced values outlive a note switch and
  // used to overwrite the newly selected note with the previous note's text.
  const editedNoteIdRef = useRef<string | null>(null);

  // Fetch notes
  const fetchNotes = useCallback(async () => {
    try {
      const endpoint = sessionId ? `/api/notes/session/${sessionId}` : '/api/notes';
      const response = await api.get<ApiNotesResponse>(endpoint);
      if (response.data.success && response.data.data) {
        setNotes(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch notes:', error);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const saveNote = useCallback(async (id: string, noteTitle: string, noteContent: string) => {
    try {
      await api.patch<ApiNoteResponse>(`/api/notes/${id}`, {
        title: noteTitle,
        content: noteContent,
      });
      setNotes((currentNotes) =>
        currentNotes.map((n) =>
          n.id === id ? { ...n, title: noteTitle, content: noteContent } : n
        )
      );
    } catch (error) {
      console.error('Failed to save note:', error);
    }
  }, []);

  // Auto-save when content changes
  useEffect(() => {
    if (
      selectedNote &&
      isEditing &&
      editedNoteIdRef.current === selectedNote.id &&
      (debouncedContent !== selectedNote.content || debouncedTitle !== selectedNote.title)
    ) {
      saveNote(selectedNote.id, debouncedTitle, debouncedContent);
    }
  }, [debouncedContent, debouncedTitle, isEditing, saveNote, selectedNote]);

  const createNote = async () => {
    setLoading(true);
    try {
      const response = await api.post<ApiNoteResponse>('/api/notes', {
        title: 'New Note',
        content: '',
        sessionId: sessionId || null,
      });
      if (response.data.success && response.data.data) {
        setNotes([response.data.data, ...notes]);
        selectNote(response.data.data);
      }
    } catch (error) {
      console.error('Failed to create note:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteNote = async (id: string) => {
    try {
      await api.delete(`/api/notes/${id}`);
      setNotes(notes.filter((n) => n.id !== id));
      if (selectedNote?.id === id) {
        setSelectedNote(null);
        setIsEditing(false);
      }
    } catch (error) {
      console.error('Failed to delete note:', error);
    }
  };

  const togglePin = async (note: Note) => {
    try {
      const response = await api.patch<ApiNoteResponse>(`/api/notes/${note.id}`, {
        pinned: !note.pinned,
      });
      if (response.data.success && response.data.data) {
        setNotes(notes.map((n) => (n.id === note.id ? response.data.data! : n)));
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
  };

  const selectNote = (note: Note) => {
    editedNoteIdRef.current = null;
    setSelectedNote(note);
    setTitle(note.title);
    setContent(note.content);
    setIsEditing(true);
  };

  const handleSendToChat = () => {
    if (content.trim() && onSendToChat) {
      onSendToChat(content);
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-amber-500" />
          <h3 className="font-medium">Notepad</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={createNote} disabled={loading}>
          <Plus className="h-4 w-4 mr-1" />
          New
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 flex">
        {/* Notes list */}
        <div className="w-48 border-r shrink-0">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-1">
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
              ) : (
                notes.map((note) => (
                  <div
                    key={note.id}
                    className={cn(
                      'group flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors',
                      selectedNote?.id === note.id
                        ? 'bg-primary/10 border border-primary/20'
                        : 'hover:bg-muted'
                    )}
                    onClick={() => selectNote(note)}
                  >
                    <FileText className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        {note.pinned ? <Pin className="h-3 w-3 text-amber-500" /> : null}
                        <p className="text-sm font-medium truncate">{note.title}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {note.content.substring(0, 50) || 'Empty note'}
                      </p>
                    </div>
                    <Button
                      aria-label="Notiz löschen"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        deleteNote(note.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedNote && isEditing ? (
            <>
              <div className="shrink-0 flex items-center gap-2 p-2 border-b">
                <Input
                  value={title}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    editedNoteIdRef.current = selectedNote?.id ?? null;
                    setTitle(e.target.value);
                  }}
                  placeholder="Note title..."
                  className="h-8 font-medium border-0 shadow-none focus-visible:ring-0"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => togglePin(selectedNote)}
                  title={selectedNote.pinned ? 'Unpin' : 'Pin'}
                >
                  {selectedNote.pinned ? (
                    <PinOff className="h-4 w-4" />
                  ) : (
                    <Pin className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Textarea
                value={content}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  editedNoteIdRef.current = selectedNote?.id ?? null;
                  setContent(e.target.value);
                }}
                placeholder="Write your notes here... Use this as a scratchpad for prompts, ideas, or anything else."
                className="flex-1 resize-none border-0 rounded-none focus-visible:ring-0"
              />
              <div className="shrink-0 flex items-center justify-between p-2 border-t bg-muted/30">
                <span className="text-xs text-muted-foreground">{content.length} characters</span>
                {onSendToChat && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSendToChat}
                    disabled={!content.trim()}
                    className="gap-1"
                  >
                    <Send className="h-3 w-3" />
                    Send to Chat
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <StickyNote className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Select a note or create a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact notepad button with dialog for use in toolbars
export function NotepadButton({ sessionId, onSendToChat }: Omit<NotepadProps, 'className'>) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Notepad">
          <StickyNote className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl h-[600px] flex flex-col p-0">
        <Notepad
          sessionId={sessionId}
          onSendToChat={(content) => {
            onSendToChat?.(content);
            setOpen(false);
          }}
          className="flex-1"
        />
      </DialogContent>
    </Dialog>
  );
}

export default Notepad;
