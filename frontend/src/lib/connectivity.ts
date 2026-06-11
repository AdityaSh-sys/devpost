export type ConnectivityMode = 'online' | 'offline';

export interface ConnectivityState {
  mode: ConnectivityMode;
  isOnline: boolean;
  latency: number | null;
  effectiveType: string | null;
  lastChecked: number;
  backendReachable: boolean;
}

const PING_THRESHOLD = 5000;
const PING_URL = '/api/ping';
const PING_RETRIES = 2;
const POLL_INTERVAL_STABLE = 30000;
const POLL_INTERVAL_RECOVERING = 5000;

class ConnectivityEngine {
  private state: ConnectivityState = {
    mode: 'online',
    isOnline: true,
    latency: null,
    effectiveType: null,
    lastChecked: Date.now(),
    backendReachable: true,
  };

  private forced: boolean = false;
  private listeners: Set<(state: ConnectivityState) => void> = new Set();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private pollingInterval: number = POLL_INTERVAL_STABLE;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    window.addEventListener('online', () => {
      if (!this.forced) this.checkConnectivity();
    });
    window.addEventListener('offline', () => {
      if (!this.forced) {
        this.updateState({
          isOnline: false,
          mode: 'offline',
          latency: null,
          backendReachable: false,
        });
      }
    });

    if ('connection' in navigator) {
      const conn = (navigator as Navigator & { connection?: EventTarget }).connection;
      if (conn) {
        conn.addEventListener('change', () => {
          if (!this.forced) this.checkConnectivity();
        });
      }
    }

    this.checkConnectivity();
    this.scheduleNextCheck();
  }

  private scheduleNextCheck() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkInterval = setInterval(() => {
      if (!this.forced) this.checkConnectivity();
    }, this.pollingInterval);
  }

  async checkConnectivity(): Promise<ConnectivityState> {
    const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (!browserOnline) {
      this.pollingInterval = POLL_INTERVAL_RECOVERING;
      this.scheduleNextCheck();
      this.updateState({
        isOnline: false,
        mode: 'offline',
        latency: null,
        backendReachable: false,
        lastChecked: Date.now(),
      });
      return this.state;
    }

    let latency: number | null = null;
    let backendOk = false;
    let retries = 0;

    while (retries <= PING_RETRIES) {
      try {
        const start = performance.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PING_THRESHOLD);

        const res = await fetch(PING_URL, {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store',
        });

        clearTimeout(timeoutId);
        latency = Math.round(performance.now() - start);
        backendOk = res.ok;

        if (backendOk) break;
      } catch {
        latency = null;
        backendOk = false;
      }
      retries++;
      if (retries <= PING_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const wasOffline = this.state.mode === 'offline';
    const mode: ConnectivityMode = (!backendOk || (latency !== null && latency > PING_THRESHOLD)) ? 'offline' : 'online';

    if (mode === 'online' && wasOffline) {
      this.pollingInterval = POLL_INTERVAL_STABLE;
      this.scheduleNextCheck();
    } else if (mode === 'offline') {
      this.pollingInterval = POLL_INTERVAL_RECOVERING;
      this.scheduleNextCheck();
    }

    let effectiveType: string | null = null;
    if ('connection' in navigator) {
      const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
      effectiveType = conn?.effectiveType || null;
    }

    this.updateState({
      isOnline: mode === 'online',
      mode,
      latency,
      effectiveType,
      backendReachable: backendOk,
      lastChecked: Date.now(),
    });

    return this.state;
  }

  private updateState(partial: Partial<ConnectivityState>) {
    const prevMode = this.state.mode;
    this.state = { ...this.state, ...partial };
    if (prevMode !== this.state.mode || partial.latency !== undefined || partial.backendReachable !== undefined) {
      this.notifyListeners();
    }
  }

  private notifyListeners() {
    this.listeners.forEach((fn) => fn({ ...this.state }));
  }

  subscribe(fn: (state: ConnectivityState) => void): () => void {
    this.listeners.add(fn);
    fn({ ...this.state });
    return () => this.listeners.delete(fn);
  }

  getState(): ConnectivityState {
    return { ...this.state };
  }

  forceMode(mode: ConnectivityMode) {
    this.forced = true;
    this.updateState({ mode });
  }

  clearForce() {
    this.forced = false;
    this.checkConnectivity();
  }

  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.listeners.clear();
  }
}

let engine: ConnectivityEngine | null = null;

export function getConnectivityEngine(): ConnectivityEngine {
  if (!engine) {
    engine = new ConnectivityEngine();
  }
  return engine;
}

export function getModeLabel(mode: ConnectivityMode): string {
  return mode === 'online' ? 'ONLINE' : 'OFFLINE';
}

export function getModeColor(mode: ConnectivityMode): string {
  return mode === 'online' ? '#10b981' : '#ef4444';
}
