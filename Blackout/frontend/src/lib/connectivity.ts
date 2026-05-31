// Connectivity Decision Engine
// Detects network status and determines the operating mode (Online, SMS, Offline)

export type ConnectivityMode = 'online' | 'sms' | 'offline';

export interface ConnectivityState {
  mode: ConnectivityMode;
  isOnline: boolean;
  hasCellular: boolean;
  latency: number | null;
  effectiveType: string | null;
  lastChecked: number;
}

const LATENCY_THRESHOLD = 5000; // 5s max acceptable latency
const PING_URL = '/api/ping';

class ConnectivityEngine {
  private state: ConnectivityState = {
    mode: 'online',
    isOnline: true,
    hasCellular: false,
    latency: null,
    effectiveType: null,
    lastChecked: Date.now(),
  };

  private listeners: Set<(state: ConnectivityState) => void> = new Set();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    // Listen for online/offline events
    window.addEventListener('online', () => this.checkConnectivity());
    window.addEventListener('offline', () => {
      this.updateState({
        isOnline: false,
        mode: this.detectCellular() ? 'sms' : 'offline',
        latency: null,
      });
    });

    // Initial check
    this.checkConnectivity();

    // Periodic check every 30 seconds
    this.checkInterval = setInterval(() => this.checkConnectivity(), 30000);
  }

  private detectCellular(): boolean {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const conn = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
      if (conn) {
        // cellular, wifi, ethernet, etc.
        const type = conn.type;
        return type === 'cellular' || type === '4g' || type === '3g' || type === '2g';
      }
    }
    return false;
  }

  async checkConnectivity(): Promise<ConnectivityState> {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (!isOnline) {
      const hasCellular = this.detectCellular();
      this.updateState({
        isOnline: false,
        hasCellular,
        mode: hasCellular ? 'sms' : 'offline',
        latency: null,
        lastChecked: Date.now(),
      });
      return this.state;
    }

    // Measure latency with a ping
    let latency: number | null = null;
    try {
      const start = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), LATENCY_THRESHOLD);

      await fetch(PING_URL, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      latency = Math.round(performance.now() - start);
    } catch {
      // Ping failed — might still have cellular
      const hasCellular = this.detectCellular();
      this.updateState({
        isOnline: false,
        hasCellular,
        mode: hasCellular ? 'sms' : 'offline',
        latency: null,
        lastChecked: Date.now(),
      });
      return this.state;
    }

    // Get effective connection type
    let effectiveType: string | null = null;
    if ('connection' in navigator) {
      const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      effectiveType = conn?.effectiveType || null;
    }

    // Determine mode based on latency
    let mode: ConnectivityMode = 'online';
    if (latency > LATENCY_THRESHOLD) {
      mode = this.detectCellular() ? 'sms' : 'offline';
    }

    this.updateState({
      isOnline: true,
      hasCellular: this.detectCellular(),
      mode,
      latency,
      effectiveType,
      lastChecked: Date.now(),
    });

    return this.state;
  }

  private updateState(partial: Partial<ConnectivityState>) {
    const prevMode = this.state.mode;
    this.state = { ...this.state, ...partial };

    // Notify listeners if mode changed
    if (prevMode !== this.state.mode || partial.latency !== undefined) {
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => fn({ ...this.state }));
  }

  subscribe(fn: (state: ConnectivityState) => void): () => void {
    this.listeners.add(fn);
    // Immediately call with current state
    fn({ ...this.state });
    return () => this.listeners.delete(fn);
  }

  getState(): ConnectivityState {
    return { ...this.state };
  }

  // Force a specific mode (for testing/demo)
  forceMode(mode: ConnectivityMode) {
    this.updateState({ mode });
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.listeners.clear();
  }
}

// Singleton instance
let engine: ConnectivityEngine | null = null;

export function getConnectivityEngine(): ConnectivityEngine {
  if (!engine) {
    engine = new ConnectivityEngine();
  }
  return engine;
}

export function getModeLabel(mode: ConnectivityMode): string {
  switch (mode) {
    case 'online':
      return 'Full Online';
    case 'sms':
      return 'SMS Fallback';
    case 'offline':
      return 'Offline AI';
  }
}

export function getModeColor(mode: ConnectivityMode): string {
  switch (mode) {
    case 'online':
      return '#10b981'; // emerald
    case 'sms':
      return '#f59e0b'; // amber
    case 'offline':
      return '#ef4444'; // red
  }
}

export function getModeIcon(mode: ConnectivityMode): string {
  switch (mode) {
    case 'online':
      return '🌐';
    case 'sms':
      return '📱';
    case 'offline':
      return '🔌';
  }
}
