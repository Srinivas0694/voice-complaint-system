'use client';

/**
 * Thin client for the v1 API. Access tokens live in memory + localStorage;
 * a 401 triggers one silent refresh before giving up, so a 15-minute access
 * token never interrupts someone mid-triage.
 */

const BASE = '/api/v1';

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Status =
  | 'PROCESSING' | 'STT_FAILED' | 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface Complaint {
  id: string;
  uuid: string;
  device: { id: string; deviceId: string; name: string; siteName: string | null };
  applianceType: string | null;
  transcript: string | null;
  summary: string | null;
  faultCategory: string | null;
  severity: Severity | null;
  status: Status;
  assignedTo: { id: string; fullName: string } | null;
  audioDurationMs: number | null;
  recordedAt: string;
  receivedAt: string;
  audioUrl?: string | null;
  sttProvider?: string | null;
  firmwareVersion?: string | null;
  hardwareRev?: string | null;
  rssi?: number | null;
  batteryPct?: number | null;
  events?: { id: string; type: string; message: string | null; createdAt: string }[];
}

export interface Stats {
  totalDevices: number;
  onlineDevices: number;
  offlineDevices: number;
  complaintsToday: number;
  complaintsThisWeek: number;
  criticalOpen: number;
  avgResolutionHours: number | null;
  lastComplaint: {
    id: string; transcript: string | null; summary: string | null;
    severity: Severity | null; receivedAt: string;
    device: { deviceId: string; name: string };
  } | null;
  severityBreakdown: Record<string, number>;
}

export interface Device {
  id: string;
  deviceId: string;
  name: string;
  applianceType: string;
  status: string;
  online: boolean;
  siteName: string | null;
  siteAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lastSeenAt: string | null;
  lastRssi: number | null;
  firmwareVersion: string | null;
  complaintCount?: number;
  openComplaintCount?: number;
}

let accessToken: string | null = null;

export function setTokens(access: string, refresh: string) {
  accessToken = access;
  localStorage.setItem('access', access);
  localStorage.setItem('refresh', refresh);
}
export function clearTokens() {
  accessToken = null;
  localStorage.removeItem('access');
  localStorage.removeItem('refresh');
}
function token() {
  if (accessToken) return accessToken;
  accessToken = localStorage.getItem('access');
  return accessToken;
}

async function refresh(): Promise<boolean> {
  const r = localStorage.getItem('refresh');
  if (!r) return false;
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: r }),
  });
  if (!res.ok) return false;
  const body = await res.json();
  setTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const call = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  let res = await call();
  if (res.status === 401 && (await refresh())) res = await call();

  if (res.status === 401) {
    clearTokens();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Email or password is incorrect');
  }
  const body = await res.json();
  setTokens(body.accessToken, body.refreshToken);
  return body.user as { id: string; email: string; fullName: string; role: string };
}
