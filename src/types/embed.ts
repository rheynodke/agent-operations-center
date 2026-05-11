export type EmbedMode = 'private' | 'public';
export type DisableMode = 'maintenance' | 'emergency' | null;
export type DlpPreset = 'internal-tool-default' | 'customer-service-default';
export type TrafficType = 'production' | 'dev' | 'playground';

export interface QuickReply {
  label: string;
  prompt: string;
}

export interface Embed {
  id: string;
  agentId: string;
  ownerId: number;
  mode: EmbedMode;
  embedToken: string;
  signingSecret?: string;  // only included in detail GET for owner
  productionOrigin: string;
  devOrigins: string[];
  brandName: string;
  brandColor: string;
  brandColorText: string;
  avatarSource: 'agent' | 'custom';
  avatarUrl: string | null;
  /** Absolute URL resolved server-side: 'custom' upload → base + path, 'agent' → looks up bound agent's preset. */
  resolvedAvatarUrl?: string | null;
  /** Public AOC widget base URL (EMBED_WIDGET_BASE_URL env or request origin). Used in snippet docs. */
  widgetBaseUrl?: string;
  welcomeTitle: string;
  welcomeSubtitle: string | null;
  quickReplies: QuickReply[];
  waitingText: string;
  offlineMessage: string;
  hidePoweredBy: boolean;
  consentText: string | null;
  languageDefault: string;
  dlpPreset: DlpPreset;
  dlpAllowlistPatterns: string[];
  enabled: number;
  disableMode: DisableMode;
  dailyTokenQuota: number;
  dailyMessageQuota: number;
  rateLimitPerIp: number;
  retentionDays: number;
  alertThresholdPercent: number;
  turnstileSitekey: string | null;
  widgetVersion: string;
  typingPhrases: string[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateEmbedInput {
  agentId: string;
  mode: EmbedMode;
  productionOrigin: string;
  devOrigins?: string[];
  brandName: string;
  brandColor?: string;
  avatarSource?: 'agent' | 'custom';
  avatarUrl?: string;
  welcomeTitle: string;
  welcomeSubtitle?: string;
  quickReplies?: QuickReply[];
  waitingText?: string;
  offlineMessage?: string;
  dlpPreset: DlpPreset;
  typingPhrases?: string[] | null;
}

export interface AuditEvent {
  id: number;
  embedId: string;
  sessionId: string | null;
  ownerId: number;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  origin: string | null;
  visitorUuid: string | null;
  ipHash: string | null;
  contextData: string;
  createdAt: number;
}
