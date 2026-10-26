/** A receipt of context actually supplied, rather than a model-authored citation. */
export interface ChatContextReference {
  kind: 'memory' | 'history' | 'project-chat' | 'chat-reference' | 'writing-style';
  id: string;
  revision?: number;
  turnId?: string;
  sourceId?: string;
  sourceType?: string;
  excerptStart?: number;
  excerptLength?: number;
}

export interface ChatContextReceipt {
  version: 1;
  memoryRead: boolean;
  memoryLearn: boolean;
  personalizationRevision: number;
  profileId: string | null;
  profileRevision: number | null;
  projectId: string | null;
  projectRevision: number | null;
  legacyNotes: boolean;
  voiceHistory: boolean;
  references: Array<
    ChatContextReference & {
      title: string;
      available: boolean;
      text?: string;
    }
  >;
  learning: {
    status:
      | 'disabled'
      | 'pending'
      | 'queued'
      | 'running'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'skipped';
    memories: Array<{ id: string; title: string; revision: number; proposed: boolean }>;
    historySaved: boolean;
    writingStyleSaved: boolean;
  };
}
