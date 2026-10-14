export type PersonalizationLevel = 'less' | 'default' | 'more';
export type ReferencePhotoSlot = 'portrait' | 'fullBody';
export interface AssistantPersonalization {
  revision: number;
  memoryEnabled: boolean;
  memoryLearning: boolean;
  agentMemorySharing: boolean;
  chatHistory: boolean;
  writingStyleLearning: boolean;
  memoryProviderId: string;
  memoryModel: string;
  writingStyleEnabled: boolean;
  writingSample: string;
  nickname: string;
  occupation: string;
  aboutYou: string;
  baseStyle: 'default' | 'friendly' | 'professional' | 'direct' | 'creative';
  warmth: PersonalizationLevel;
  enthusiasm: PersonalizationLevel;
  emoji: PersonalizationLevel;
  visualLayout: PersonalizationLevel;
  headings: PersonalizationLevel;
  chatInstructions: string;
  taskInstructions: string;
  codeInstructions: string;
  conciseAnswers: boolean;
  suggestedPrompts: boolean;
  voiceHistory: boolean;
  webSearch: boolean;
  voiceChat: boolean;
  /** Chosen read-aloud voice: an OmniVoice name or `mistral:<voice_id>`; empty keeps the profile's voice. */
  voiceName: string;
  projectSearch: boolean;
  connectorSearch: boolean;
  /** Writing-style preset (style-library baseName) for new Chat and Task conversations; empty = none. */
  defaultWritingStyle: string;
  /** Design preset (style-library baseName) for new Code and Task sessions; empty = none. */
  defaultDesignStyle: string;
  referencePhotos: Record<
    ReferencePhotoSlot,
    null | {
      id: string;
      filename: string;
      mimeType: string;
      byteLength: number;
    }
  >;
}
export const DEFAULT_PERSONALIZATION: AssistantPersonalization = {
  revision: 0,
  memoryEnabled: false,
  memoryLearning: false,
  agentMemorySharing: false,
  chatHistory: false,
  writingStyleLearning: false,
  memoryProviderId: '',
  memoryModel: '',
  writingStyleEnabled: false,
  writingSample: '',
  nickname: '',
  occupation: '',
  aboutYou: '',
  baseStyle: 'default',
  warmth: 'default',
  enthusiasm: 'default',
  emoji: 'default',
  visualLayout: 'default',
  headings: 'default',
  chatInstructions: '',
  taskInstructions: '',
  codeInstructions: '',
  conciseAnswers: false,
  suggestedPrompts: true,
  voiceHistory: false,
  webSearch: true,
  voiceChat: true,
  voiceName: '',
  projectSearch: false,
  connectorSearch: false,
  defaultWritingStyle: '',
  defaultDesignStyle: '',
  referencePhotos: { portrait: null, fullBody: null },
};
