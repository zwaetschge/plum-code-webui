import type { AssistantResource } from './assistant.js';
export interface MemoryTopic {
  id: string;
  title: string;
  scope: 'personal' | 'project' | 'agent';
  scopeId: string;
  count: number;
  updatedAt: string;
}
export interface MemoryTopicPage {
  topics: MemoryTopic[];
  nextOffset: number | null;
}
export interface MemoryTopicDocument {
  entries: AssistantResource[];
  version: string;
  nextOffset: number | null;
}
