export interface SystemMetrics {
  /** Calendar month (UTC) the usage figures refer to, e.g. "2026-09". */
  period: string;
  usage: {
    messages: { completed: number; failed: number; inProgress: number };
    bySource: { free: number; bundle: number };
    tokens: { prompt: number; completion: number; total: number };
    activeUsers: number;
  };
  subscriptions: {
    byStatus: { ACTIVE: number; INACTIVE: number; CANCELLED: number };
    activeByTier: { BASIC: number; PRO: number; ENTERPRISE: number };
    autoRenewEnabled: number;
  };
}

/** Read-only view over data owned by the chat and subscription modules. */
export interface MetricsReader {
  read(periodStart: Date, periodEnd: Date): Promise<Omit<SystemMetrics, 'period'>>;
}
