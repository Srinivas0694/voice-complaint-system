import { NextResponse } from 'next/server';
import { corsOrigins } from '../env';

export type ApiErrorCode =
  | 'VALIDATION_FAILED' | 'AUDIO_TOO_LARGE' | 'AUDIO_FORMAT_UNSUPPORTED'
  | 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'DEVICE_SIGNATURE_INVALID'
  | 'DEVICE_TIMESTAMP_SKEW' | 'DEVICE_NONCE_REPLAY' | 'DEVICE_UNKNOWN'
  | 'INSUFFICIENT_ROLE' | 'DEVICE_REVOKED' | 'NOT_FOUND'
  | 'DEVICE_ID_TAKEN' | 'EMAIL_TAKEN' | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED' | 'INTERNAL';

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400, AUDIO_TOO_LARGE: 400, AUDIO_FORMAT_UNSUPPORTED: 400,
  TOKEN_EXPIRED: 401, TOKEN_INVALID: 401, DEVICE_SIGNATURE_INVALID: 401,
  DEVICE_TIMESTAMP_SKEW: 401, DEVICE_NONCE_REPLAY: 401, DEVICE_UNKNOWN: 401,
  INSUFFICIENT_ROLE: 403, DEVICE_REVOKED: 403, NOT_FOUND: 404,
  DEVICE_ID_TAKEN: 409, EMAIL_TAKEN: 409, PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429, INTERNAL: 500,
};

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowed = origin && corsOrigins.includes(origin) ? origin : corsOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,X-Device-Id,X-Timestamp,X-Nonce,X-Signature',
    'Access-Control-Max-Age': '86400',
  };
}

export function ok<T>(data: T, init: ResponseInit = {}) {
  return NextResponse.json(data, { status: 200, ...init });
}

export function created<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function fail(code: ApiErrorCode, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message, requestId: crypto.randomUUID(), ...extra } },
    { status: STATUS[code] },
  );
}

export function paginated<T>(data: T[], page: number, limit: number, total: number) {
  return NextResponse.json({
    data,
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}
