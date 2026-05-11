// packages/aoc-embed/src/widget/types.ts
export type Role = 'user' | 'agent';

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  timestamp: number;
  redactionCount?: number;
}

export interface QuickReply {
  label: string;
  prompt: string;
}

export interface EmbedConfig {
  embedId: string;
  brandName: string;
  brandColor: string;
  brandColorText: string;
  avatarSource: 'agent' | 'custom';
  avatarUrl: string | null;
  welcomeTitle: string;
  welcomeSubtitle: string | null;
  quickReplies: QuickReply[];
  waitingText: string;
  offlineMessage: string;
  hidePoweredBy: boolean;
  consentText: string | null;
  languageDefault: string;
  typingPhrases?: string[] | null;
  mode: 'private' | 'public';
  enabled: boolean;
  disableMode: 'maintenance' | 'emergency' | null;
}

export interface InitMessage {
  type: 'aoc:init';
  embedId: string;
  token: string;
  jwt: string | null;
  base: string;
  parentOrigin: string;
  config: EmbedConfig;
  ownerJwt?: string;   // owner's dashboard JWT, only present when launched from designer playground
  playground?: boolean;// only true when launched from designer playground iframe
}

export interface SendCommand { type: 'aoc:send'; text: string; }
export interface ClearCommand { type: 'aoc:clear'; }
