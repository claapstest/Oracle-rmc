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

// Never reveal whether the email exists (AC6); never leak technical errors (AC10).
export function mapLoginError(message: string): string {
  const msg = (message || '').toLowerCase();
  if (msg.includes('deactivat') || msg.includes('suspend') || msg.includes('disabled')) {
    return 'Your account has been disabled. Please contact your administrator.';
  }
  if (
    msg.includes('credential') ||
    msg.includes('invalid email or password') ||
    msg.includes('invalid email address or format') ||
    msg.includes('incorrect email or password') ||
    msg.includes('login failed')
  ) {
    return 'Invalid email or password.';
  }
  return 'Something went wrong. Please try again.';
}
