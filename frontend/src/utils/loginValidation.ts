// Pure client-side login validation + error mapping (AC2-AC4, AC6, AC7, AC10).
// No database access here — authentication always goes through POST /api/auth/login.

export function normalizeEmail(email: string): string {
  return (email ?? '').trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LoginFieldErrors {
  email?: string;
  password?: string;
}

export function validateLoginInputs(rawEmail: string, password: string): LoginFieldErrors {
  const errors: LoginFieldErrors = {};
  const email = normalizeEmail(rawEmail);
  if (!email) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!password) {
    errors.password = 'Password is required.';
  }
  return errors;
}

// Check whether an error or response represents an active session conflict (HTTP 409 / ACTIVE_SESSION_EXISTS)
export function isActiveSessionError(err: any): boolean {
  if (!err) return false;

  // 1. Check HTTP status 409 Conflict
  if (err.status === 409 || err.statusCode === 409) {
    return true;
  }

  // 2. Check code property across various backend wrapping structures
  const code = (
    err.code ||
    err.data?.code ||
    err.data?.error?.code ||
    err.data?.errorCode ||
    err.data?.error_code ||
    err.errorCode ||
    err.error_code ||
    err.response?.data?.code ||
    ''
  ).toString().toUpperCase();

  if (code === 'ACTIVE_SESSION_EXISTS' || code.includes('ACTIVE_SESSION')) {
    return true;
  }

  // 3. Tolerant check on message / error payload string
  const rawMsg = (
    err.message ||
    err.data?.message ||
    err.data?.error ||
    err.error ||
    ''
  ).toString();

  if (rawMsg.includes('ACTIVE_SESSION_EXISTS')) {
    return true;
  }

  return false;
}

// Never reveal whether the email exists (AC6); never leak technical errors (AC10).
// Accurately distinguishes 401 (invalid credentials), 403 (disabled/suspended), 5xx (server error).
export function mapLoginError(err: any): string {
  // Extract status if available
  const status = typeof err === 'object' && err !== null ? (err.status || err.statusCode) : undefined;

  // Extract error code if available
  const code = (
    typeof err === 'object' && err !== null
      ? (err.code || err.data?.code || err.errorCode || err.error_code || '')
      : ''
  ).toString().toUpperCase();

  // Extract message string
  const rawMsg = typeof err === 'string' ? err : (err?.message || err?.data?.message || err?.error || '');
  const msg = (rawMsg || '').toLowerCase();

  // 403: User Disabled / Suspended / Account locked
  if (
    status === 403 ||
    code === 'USER_DISABLED' ||
    code === 'USER_SUSPENDED' ||
    code === 'ACCOUNT_DISABLED' ||
    code === 'ACCOUNT_LOCKED' ||
    msg.includes('deactivat') ||
    msg.includes('suspend') ||
    msg.includes('disabled') ||
    msg.includes('not active') ||
    msg.includes('access denied')
  ) {
    return 'Your account has been disabled. Please contact your administrator.';
  }

  // 401: Invalid Credentials (never reveal whether user exists)
  if (
    status === 401 ||
    code === 'INVALID_CREDENTIALS' ||
    msg.includes('credential') ||
    msg.includes('invalid email or password') ||
    msg.includes('invalid email address or format') ||
    msg.includes('incorrect email or password') ||
    msg.includes('login failed')
  ) {
    return 'Invalid email or password.';
  }

  // 5xx Server/System Error or generic technical error: Safe generic message
  return 'Something went wrong. Please try again later.';
}
