export type Wallpaper = {
  id: string;
  title: string;
  originalName: string;
  type: string;
  status: string;
  mimeType?: string;
  coverUrl?: string;
  sortOrder: number;
  tags: Array<{ tag: { name: string } }>;
  storageLinks: Array<{ id: string; provider: string; url: string; isActive: boolean; isPrimary: boolean }>;
  shortLinks: Array<{ id: string; provider: string; storageLinkId: string; url: string; clickCount: number }>;
  aiAnalysis?: {
    safe: boolean;
    sensitiveFlags: string[];
    summary?: string;
  } | null;
};

export type TaskItem = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  type: string;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  result?: { warnings?: string[]; resumable?: boolean; stage?: string; expired?: boolean; bridgeExpired?: boolean; needsUploadConfirmation?: boolean; legacyConfirmation?: boolean };
};

export type MemberWallpaperRequest = {
  id: string;
  userId: string;
  subject: string;
  description: string;
  referenceImages?: string[];
  wallpaperType: string;
  orientation: string;
  status: string;
  adminNote?: string;
  wallpaperId?: string;
  wallpaper?: { id: string; title: string; coverUrl: string } | null;
  createdAt: string;
};

export type TaskSummary = {
  todayTotal: number;
  active: number;
  successToday: number;
  failedToday: number;
};

export type ImportPreview = {
  coverFileName: string;
  candidateTitle: string;
  confidence: number;
  matched?: { name: string };
};

export type ImportRecord = {
  id: string;
  coverFileName: string;
  candidateTitle: string;
  oldResourceName?: string;
  oldResourceLink?: string;
  confidence: number;
  status: string;
  message?: string;
  updatedAt: string;
};

export type ImportStats = {
  imports: Record<string, number>;
  wallpapers: {
    total: number;
    published: number;
    rejected: number;
    pendingReview: number;
    unclassified: number;
  };
};

export type ChannelAccount = {
  id: string;
  label: string;
  tokenTail: string;
  guildId: string;
  channelId: string;
  guildName?: string;
  channelName?: string;
  isDefault: boolean;
  autoPublish: boolean;
};

export type StorageAccount = {
  id: string;
  provider: "quark" | "baidu";
  label: string;
  accountName?: string;
  isDefault: boolean;
  isActive: boolean;
  lastProbeOk?: boolean;
  lastProbeMessage?: string;
  lastProbeAt?: string;
  createdAt: string;
};

export type TencentGuildOption = {
  id: string;
  name: string;
  role: string;
};

export type TencentChannelOption = {
  id: string;
  name: string;
  type?: string;
};

export type SystemSettings = {
  defaultAutoProcess: boolean;
  defaultAutoPublish: boolean;
  uploadMultiPostMode?: "merge" | "separate";
  separatePostGapMinSeconds: number;
  separatePostGapMaxSeconds: number;
  batchPostGapMinSeconds: number;
  batchPostGapMaxSeconds: number;
  rewardDownloadType: string;
  wallMuseEnabled?: boolean;
  processIdleEnabled?: boolean;
  processIdleWindows?: Array<{ start: string; end: string }>;
  permanentDeliveryResources?: Array<{ name: string; provider: "baidu" | "quark"; url: string; passcode?: string }>;
  virtualPaymentProducts?: Array<{
    key: string;
    productId: string;
    name: string;
    description: string;
    goodsPrice: number;
    buyQuantity: number;
    entitlementType: "single_download" | "unlimited_days" | "unlimited_permanent" | "remove_ads_days";
    entitlementValue: number;
    enabled: boolean;
  }>;
  memberRequestMonthlyLimit?: number;
};

export type StorageSelectionForm = {
  quarkAccountId?: string;
  baiduAccountId?: string;
};

export type DiagnosticItem = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
  command?: string;
};

export type ReadinessReport = {
  ok: boolean;
  diagnostics: Record<"ok" | "warn" | "fail", number>;
  actions: Array<DiagnosticItem & { nextStep: string }>;
  report: string;
};

export type AdminOverview = {
  wallpapers: {
    total: number;
    byStatus: Record<string, number>;
    draft: number;
    processing: number;
    pendingReview: number;
    published: number;
    rejected: number;
    archived: number;
    byType: Array<{ type: string; count: number }>;
  };
  ai: {
    unreviewed: number;
    safe: number;
    blocked: number;
  };
  storage: {
    activeQuark: number;
    activeBaidu: number;
    missingQuark: number;
    missingBaidu: number;
    missingActiveLinks: number;
    missingShortLinks: number;
    unpublishedActiveShortLinks: number;
  };
  channelAccounts: {
    total: number;
    defaultConfigured: boolean;
  };
  storageAccounts: {
    total: number;
    defaultBaidu: boolean;
    defaultQuark: boolean;
  };
  tags: {
    total: number;
  };
  tasks: TaskSummary;
};

export type LibraryPreset = {
  status?: string;
  type?: string;
  aiReview?: string;
  storageFilter?: string;
  nonce?: number;
};

export type PaymentOrderRow = {
  outTradeNo: string;
  openid: string;
  productName: string;
  totalFee: number;
  buyQuantity: number;
  status: string;
  paidAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export type SearchLogItem = {
  id: string;
  keyword: string;
  hasResult: boolean;
  resultCount: number;
  openid?: string | null;
  createdAt: string;
};

export type AnalyticsData = {
  range: { days: number };
  trends: { labels: string[]; published: number[]; views: number[]; downloads: number[]; favorites: number[]; searches: number[] };
  hotWallpapers: { daily: HotWallpaper[]; weekly: HotWallpaper[]; monthly: HotWallpaper[] };
  hotTags: Array<{ name: string; heat: number }>;
  search: { total: number; hitRate: number; topTerms: Array<{ keyword: string; count: number }>; gaps: Array<{ keyword: string; count: number }> };
  publish: {
    boards: Array<{ guildName?: string | null; channelName?: string | null; source: string; enabled: boolean; lastRunAt?: string | null; lastMessage?: string | null }>;
    ai: { analyzed: number; blocked: number; blockRate: number };
    taskFailures: Array<{ type: string; count: number }>;
    publishSuccessRate: number;
  };
};
export type HotWallpaper = { id: string; title: string; coverUrl: string; clicks: number };

export type AutoPublishBoardRow = {
  id: string;
  guildId: string;
  guildName?: string;
  channelId: string;
  channelName?: string;
  source: string;
  sources?: string[];
  sourceConfig?: Record<string, unknown> | null;
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string | null;
  lastMessage?: string | null;
};
