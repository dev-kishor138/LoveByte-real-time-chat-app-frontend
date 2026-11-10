/**
 * LoveByte Client-Side Validation Utilities
 *
 * Strictly matches backend validation schemas defined in:
 * backend/src/modules/auth/auth.validation.ts
 */

/**
 * Canonical Gmail regular expression matching backend Zod schema.
 */
export const GMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@gmail\.com$/;

/**
 * Standard basic email syntax regex for pre-filtering malformed email strings.
 */
const BASIC_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalizes email input by trimming whitespace and lowercasing.
 * Passwords must never be normalized or altered.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validates an email address against backend constraints.
 *
 * @param email Raw email input string
 * @param mode 'register' | 'login' (determines domain error message)
 * @returns Error message string, or null if valid
 */
export function validateEmail(
  email: string,
  mode: 'register' | 'login' = 'register'
): string | null {
  if (!email || !email.trim()) {
    return 'Email is required';
  }

  const normalized = normalizeEmail(email);

  if (!BASIC_EMAIL_REGEX.test(normalized)) {
    return 'Invalid email format';
  }

  if (!GMAIL_REGEX.test(normalized)) {
    return mode === 'register'
      ? 'Registration is restricted to valid @gmail.com addresses'
      : 'Login is restricted to valid @gmail.com addresses';
  }

  return null;
}

/**
 * Validates a partner email address when initiating a 1-to-1 conversation.
 */
export function validatePartnerEmail(
  email: string,
  currentUserEmail?: string | null
): string | null {
  if (!email || !email.trim()) {
    return 'Partner email is required';
  }

  const normalized = normalizeEmail(email);

  if (!BASIC_EMAIL_REGEX.test(normalized)) {
    return 'Invalid email format';
  }

  if (!GMAIL_REGEX.test(normalized)) {
    return 'Recipient must be a valid @gmail.com address';
  }

  if (currentUserEmail && normalized === normalizeEmail(currentUserEmail)) {
    return 'You cannot start a conversation with yourself';
  }

  return null;
}

/**
 * Validates a registration password against backend constraints:
 * - Length: 8 to 128 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special character (non-alphanumeric)
 *
 * @param password Raw plaintext password
 * @returns Error message string, or null if valid
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Password is required';
  }

  if (password.length < 8) {
    return 'Password must be at least 8 characters';
  }

  if (password.length > 128) {
    return 'Password must be at most 128 characters';
  }

  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }

  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }

  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one digit';
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return 'Password must contain at least one special character';
  }

  return null;
}

/**
 * Validates that confirmPassword matches password.
 *
 * @param password The original password
 * @param confirmPassword The re-entered confirmation password
 * @returns Error message string, or null if valid
 */
export function validateConfirmPassword(
  password: string,
  confirmPassword: string
): string | null {
  if (!confirmPassword) {
    return 'Please confirm your password';
  }

  if (password !== confirmPassword) {
    return 'Passwords do not match';
  }

  return null;
}

/**
 * Validates the full registration form.
 */
export function validateRegisterForm(values: {
  email: string;
  password: string;
  confirmPassword: string;
}): {
  isValid: boolean;
  errors: {
    email?: string;
    password?: string;
    confirmPassword?: string;
  };
} {
  const errors: {
    email?: string;
    password?: string;
    confirmPassword?: string;
  } = {};

  const emailError = validateEmail(values.email, 'register');
  if (emailError) {
    errors.email = emailError;
  }

  const passwordError = validatePassword(values.password);
  if (passwordError) {
    errors.password = passwordError;
  }

  const confirmError = validateConfirmPassword(
    values.password,
    values.confirmPassword
  );
  if (confirmError) {
    errors.confirmPassword = confirmError;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validates the full login form.
 */
export function validateLoginForm(values: {
  email: string;
  password: string;
}): {
  isValid: boolean;
  errors: {
    email?: string;
    password?: string;
  };
} {
  const errors: {
    email?: string;
    password?: string;
  } = {};

  const emailError = validateEmail(values.email, 'login');
  if (emailError) {
    errors.email = emailError;
  }

  if (!values.password) {
    errors.password = 'Password is required';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

