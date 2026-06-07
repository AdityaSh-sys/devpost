export type ConnectivityMode = 'online' | 'sms' | 'offline';

export interface ConnectivityState {
  mode: ConnectivityMode;
  isOnline: boolean;
  hasCellular: boolean;
  latency: number | null;
  effectiveType: string | null;
  lastChecked: number;
  degraded: boolean;
  captivePortal: boolean;
}

const PING_URL = '/api/ping';
const CAPTIVE_PORTAL_URL = 'http://detectportal.firefox.com/success.txt';
const DEGRADED_THRESHOLD = 2000;
const OFFLINE_THRESHOLD = 5000;
const HYSTERESIS_COUNT = 2;

class ConnectivityEngine {
  private state: ConnectivityState = {
    mode: 'online',
    isOnline: true,
    hasCellular: false,
    latency: null,
    effectiveType: null,
    lastChecked: Date.now(),
    degraded: false,
    captivePortal: false,
  };

  private listeners: Set<(state: ConnectivityState) => void> = new Set();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    window.addEventListener('online', () => {
      this.consecutiveFailures = 0;
      this.checkConnectivity();
    });
    window.addEventListener('offline', () => {
      this.consecutiveFailures = HYSTERESIS_COUNT;
      this.updateState({
        isOnline: false,
        mode: this.detectCellular() ? 'sms' : 'offline',
        latency: null,
        degraded: false,
        captivePortal: false,
      });
    });

    this.checkConnectivity();
    this.checkInterval = setInterval(() => this.checkConnectivity(), 30000);
  }

  private detectCellular(): boolean {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      const conn = (navigator as Navigator & { connection?: { type?: string; effectiveType?: string } }).connection;
      if (conn) {
        const type = conn.type;
        return type === 'cellular' || type === '4g' || type === '3g' || type === '2g';
      }
    }
    return false;
  }

  private async checkCaptivePortal(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(CAPTIVE_PORTAL_URL, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
      const text = await resp.text();
      return resp.ok && text.trim() === 'success';
    } catch {
      return false;
    }
  }

  async checkConnectivity(): Promise<ConnectivityState> {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    if (!isOnline) {
      this.consecutiveFailures = HYSTERESIS_COUNT;
      const hasCellular = this.detectCellular();
      this.updateState({
        isOnline: false,
        hasCellular,
        mode: hasCellular ? 'sms' : 'offline',
        latency: null,
        lastChecked: Date.now(),
        degraded: false,
        captivePortal: false,
      });
      return this.state;
    }

    let latency: number | null = null;
    let pingOk = false;
    try {
      const start = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), OFFLINE_THRESHOLD);

      await fetch(PING_URL, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      latency = Math.round(performance.now() - start);
      pingOk = true;
    } catch {
      latency = null;
      pingOk = false;
    }

    if (pingOk && latency! < OFFLINE_THRESHOLD) {
      this.consecutiveFailures = 0;
      this.consecutiveSuccesses = Math.min(this.consecutiveSuccesses + 1, HYSTERESIS_COUNT);
    } else {
      this.consecutiveFailures += 1;
      this.consecutiveSuccesses = 0;
    }

    const effectiveType =
      'connection' in navigator
        ? (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType || null
        : null;

    let captivePortal = false;
    let hasCellular = this.detectCellular();
    let degraded = false;
    let mode: ConnectivityMode;

    if (pingOk && latency! < OFFLINE_THRESHOLD) {
      if (this.consecutiveSuccesses >= 1) {
        mode = 'online';
        degraded = latency! >= DEGRADED_THRESHOLD;
      } else {
        mode = this.state.mode;
        degraded = this.state.degraded;
      }
    } else {
      if (this.consecutiveFailures >= HYSTERESIS_COUNT) {
        captivePortal = !hasCellular && await this.checkCaptivePortal();
        if (!captivePortal) {
          mode = hasCellular ? 'sms' : 'offline';
        } else {
          mode = 'offline';
        }
      } else {
        mode = this.state.mode;
        degraded = this.state.degraded;
        captivePortal = this.state.captivePortal;
      }
    }

    this.updateState({
      isOnline: mode === 'online',
      hasCellular,
      mode,
      latency,
      effectiveType,
      lastChecked: Date.now(),
      degraded,
      captivePortal,
    });

    return this.state;
  }

  private updateState(partial: Partial<ConnectivityState>) {
    const prevMode = this.state.mode;
    this.state = { ...this.state, ...partial };
    if (prevMode !== this.state.mode || partial.latency !== undefined) {
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
    this.updateState({ mode });
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
      return '#10b981';
    case 'sms':
      return '#f59e0b';
    case 'offline':
      return '#ef4444';
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
