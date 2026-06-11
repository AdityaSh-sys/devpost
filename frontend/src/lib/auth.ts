'use client';

const API_PREFIX = '/api';

interface AuthTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

export interface User {
  id: string;
  email: string;
  display_name: string;
  created_at?: string;
}

let tokens: AuthTokens = {
  accessToken: null,
  refreshToken: null,
};

let currentUser: User | null = null;
let authListeners: Array<(user: User | null) => void> = [];

export function subscribeToAuth(fn: (user: User | null) => void): () => void {
  authListeners.push(fn);
  fn(currentUser);
  return () => {
    authListeners = authListeners.filter((l) => l !== fn);
  };
}

function notifyAuthListeners() {
  authListeners.forEach((fn) => fn(currentUser));
}

function getRefreshTokenFromStorage(): string | null {
  try {
    return localStorage.getItem('blackout_refresh_token');
  } catch {
    return null;
  }
}

function setRefreshToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem('blackout_refresh_token', token);
    } else {
      localStorage.removeItem('blackout_refresh_token');
    }
  } catch {}
}

export function getAccessToken(): string | null {
  return tokens.accessToken;
}

export function setTokens(accessToken: string, refreshToken: string) {
  tokens.accessToken = accessToken;
  tokens.refreshToken = refreshToken;
  setRefreshToken(refreshToken);
}

export function clearTokens() {
  tokens.accessToken = null;
  tokens.refreshToken = null;
  setRefreshToken(null);
}

async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (tokens.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }
  return fetch(`${API_PREFIX}${path}`, { ...options, headers });
}

async function tryRefreshToken(): Promise<boolean> {
  const rt = tokens.refreshToken || getRefreshTokenFromStorage();
  if (!rt) return false;

  try {
    const res = await fetch(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!res.ok) {
      clearTokens();
      currentUser = null;
      notifyAuthListeners();
      return false;
    }
    const data = await res.json();
    if (data.access_token) {
      tokens.accessToken = data.access_token;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function login(email: string, password: string): Promise<{ user: User }> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Login failed' }));
    throw new Error(err.detail || 'Login failed');
  }
  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  currentUser = data.user;
  notifyAuthListeners();
  return { user: data.user };
}

export async function signup(
  email: string,
  password: string,
  displayName: string
): Promise<{ user: User }> {
  const res = await apiFetch('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Signup failed' }));
    throw new Error(err.detail || 'Signup failed');
  }
  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  currentUser = data.user;
  notifyAuthListeners();
  return { user: data.user };
}

export async function logout(): Promise<void> {
  const rt = tokens.refreshToken || getRefreshTokenFromStorage();
  if (rt) {
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: rt }),
      });
    } catch {}
  }
  clearTokens();
  currentUser = null;
  notifyAuthListeners();
}

export async function refreshToken(): Promise<boolean> {
  return tryRefreshToken();
}

export async function getCurrentUser(): Promise<User | null> {
  if (tokens.accessToken) {
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        const user = await res.json();
        currentUser = user;
        notifyAuthListeners();
        return user;
      }
    } catch {}
  }
  const refreshed = await tryRefreshToken();
  if (refreshed) {
    try {
      const res = await apiFetch('/auth/me');
      if (res.ok) {
        const user = await res.json();
        currentUser = user;
        notifyAuthListeners();
        return user;
      }
    } catch {}
  }
  return null;
}

export function getCurrentCachedUser(): User | null {
  return currentUser;
}

export function getUserId(): string | null {
  return currentUser?.id ?? null;
}

export function guestId(): string {
  try {
    let id = localStorage.getItem('blackout_guest_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('blackout_guest_id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function clearGuestId() {
  try {
    localStorage.removeItem('blackout_guest_id');
  } catch {}
}

export function getGuestId(): string | null {
  try {
    return localStorage.getItem('blackout_guest_id');
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!tokens.accessToken;
}

export { apiFetch };
