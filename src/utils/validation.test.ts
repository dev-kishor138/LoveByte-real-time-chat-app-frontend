import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateEmail,
  validatePassword,
  validateConfirmPassword,
  validateRegisterForm,
  validateLoginForm,
  validatePartnerEmail,
  normalizeEmail,
} from './validation.ts';

describe('Validation Utilities (Stage 2A)', () => {
  describe('normalizeEmail', () => {
    it('trims leading and trailing whitespace', () => {
      assert.strictEqual(normalizeEmail('  user@gmail.com  '), 'user@gmail.com');
    });

    it('lowercases uppercase email characters', () => {
      assert.strictEqual(normalizeEmail('Alice.Smith@GMAIL.COM'), 'alice.smith@gmail.com');
    });

    it('preserves dots, plus tags, and special characters in local part', () => {
      assert.strictEqual(normalizeEmail('alice.smith+love_byte@gmail.com'), 'alice.smith+love_byte@gmail.com');
    });
  });

  describe('validateEmail', () => {
    it('returns error when email is empty or whitespace', () => {
      assert.strictEqual(validateEmail(''), 'Email is required');
      assert.strictEqual(validateEmail('   '), 'Email is required');
    });

    it('returns error when email format is invalid', () => {
      assert.strictEqual(validateEmail('notanemail'), 'Invalid email format');
      assert.strictEqual(validateEmail('user@'), 'Invalid email format');
      assert.strictEqual(validateEmail('@gmail.com'), 'Invalid email format');
      assert.strictEqual(validateEmail('user @gmail.com'), 'Invalid email format');
    });

    it('rejects non-Gmail domains in register mode with exact backend error message', () => {
      const expected = 'Registration is restricted to valid @gmail.com addresses';
      assert.strictEqual(validateEmail('user@yahoo.com', 'register'), expected);
      assert.strictEqual(validateEmail('user@outlook.com', 'register'), expected);
      assert.strictEqual(validateEmail('user@lovebyte.io', 'register'), expected);
      assert.strictEqual(validateEmail('user@gmail.co', 'register'), expected);
    });

    it('rejects non-Gmail domains in login mode with exact backend error message', () => {
      const expected = 'Login is restricted to valid @gmail.com addresses';
      assert.strictEqual(validateEmail('user@yahoo.com', 'login'), expected);
      assert.strictEqual(validateEmail('user@outlook.com', 'login'), expected);
    });

    it('accepts valid Gmail addresses in both register and login modes', () => {
      assert.strictEqual(validateEmail('sweetheart@gmail.com', 'register'), null);
      assert.strictEqual(validateEmail('sweetheart.love@gmail.com', 'register'), null);
      assert.strictEqual(validateEmail('sweetheart+tag@gmail.com', 'register'), null);
      assert.strictEqual(validateEmail('SWEETHEART@GMAIL.COM', 'login'), null);
    });
  });

  describe('validatePassword (Registration)', () => {
    it('returns error when password is empty', () => {
      assert.strictEqual(validatePassword(''), 'Password is required');
    });

    it('rejects passwords shorter than 8 characters', () => {
      assert.strictEqual(validatePassword('Pass1!'), 'Password must be at least 8 characters');
    });

    it('rejects passwords longer than 128 characters', () => {
      const longPassword = 'P1!' + 'a'.repeat(126);
      assert.strictEqual(validatePassword(longPassword), 'Password must be at most 128 characters');
    });

    it('rejects passwords missing an uppercase letter', () => {
      assert.strictEqual(
        validatePassword('password123!'),
        'Password must contain at least one uppercase letter'
      );
    });

    it('rejects passwords missing a lowercase letter', () => {
      assert.strictEqual(
        validatePassword('PASSWORD123!'),
        'Password must contain at least one lowercase letter'
      );
    });

    it('rejects passwords missing a digit', () => {
      assert.strictEqual(
        validatePassword('Password!@#$'),
        'Password must contain at least one digit'
      );
    });

    it('rejects passwords missing a special character', () => {
      assert.strictEqual(
        validatePassword('Password123'),
        'Password must contain at least one special character'
      );
    });

    it('accepts strong passwords meeting all OWASP/backend complexity criteria', () => {
      assert.strictEqual(validatePassword('SecretPass123!'), null);
      assert.strictEqual(validatePassword('LoveByte#2026'), null);
      assert.strictEqual(validatePassword('P@ssw0rd$Value'), null);
    });
  });

  describe('validateConfirmPassword', () => {
    it('returns error when confirmPassword is empty', () => {
      assert.strictEqual(
        validateConfirmPassword('SecretPass123!', ''),
        'Please confirm your password'
      );
    });

    it('returns error when passwords do not match', () => {
      assert.strictEqual(
        validateConfirmPassword('SecretPass123!', 'SecretPass123?'),
        'Passwords do not match'
      );
    });

    it('returns null when passwords match identically', () => {
      assert.strictEqual(
        validateConfirmPassword('SecretPass123!', 'SecretPass123!'),
        null
      );
    });
  });

  describe('validateRegisterForm', () => {
    it('returns isValid: true and empty errors object on valid inputs', () => {
      const result = validateRegisterForm({
        email: 'alice@gmail.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });
      assert.strictEqual(result.isValid, true);
      assert.deepStrictEqual(result.errors, {});
    });

    it('returns all validation errors when multiple fields are invalid', () => {
      const result = validateRegisterForm({
        email: 'not-gmail@yahoo.com',
        password: 'weak',
        confirmPassword: 'other',
      });
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.email, 'Registration is restricted to valid @gmail.com addresses');
      assert.strictEqual(result.errors.password, 'Password must be at least 8 characters');
      assert.strictEqual(result.errors.confirmPassword, 'Passwords do not match');
    });
  });

  describe('validateLoginForm', () => {
    it('returns isValid: true on valid Gmail and non-empty password', () => {
      const result = validateLoginForm({
        email: 'alice@gmail.com',
        password: 'AnyPasswordValue',
      });
      assert.strictEqual(result.isValid, true);
      assert.deepStrictEqual(result.errors, {});
    });

    it('returns error when email is non-Gmail and password is empty', () => {
      const result = validateLoginForm({
        email: 'invalid@example.com',
        password: '',
      });
      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.errors.email, 'Login is restricted to valid @gmail.com addresses');
      assert.strictEqual(result.errors.password, 'Password is required');
    });
  });

  describe('validatePartnerEmail', () => {
    it('returns error when email is empty or whitespace', () => {
      assert.strictEqual(validatePartnerEmail(''), 'Partner email is required');
      assert.strictEqual(validatePartnerEmail('   '), 'Partner email is required');
    });

    it('returns error when email syntax is invalid', () => {
      assert.strictEqual(validatePartnerEmail('notanemail'), 'Invalid email format');
      assert.strictEqual(validatePartnerEmail('missingdomain@'), 'Invalid email format');
    });

    it('rejects non-Gmail domains with exact error message', () => {
      assert.strictEqual(
        validatePartnerEmail('partner@yahoo.com'),
        'Recipient must be a valid @gmail.com address'
      );
      assert.strictEqual(
        validatePartnerEmail('partner@outlook.com'),
        'Recipient must be a valid @gmail.com address'
      );
    });

    it('rejects starting a conversation with own email address', () => {
      assert.strictEqual(
        validatePartnerEmail('me@gmail.com', 'me@gmail.com'),
        'You cannot start a conversation with yourself'
      );
      assert.strictEqual(
        validatePartnerEmail('  Me@Gmail.com  ', 'me@gmail.com'),
        'You cannot start a conversation with yourself'
      );
    });

    it('accepts valid partner Gmail addresses', () => {
      assert.strictEqual(validatePartnerEmail('sweetheart@gmail.com', 'me@gmail.com'), null);
      assert.strictEqual(validatePartnerEmail('  darling.2026@gmail.com  ', 'me@gmail.com'), null);
    });
  });
});
