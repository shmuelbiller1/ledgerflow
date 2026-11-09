import crypto from "crypto";
import { byCodeUnit } from '../lib/codeUnitOrder';
import { maskEmails } from '../lib/textShape';

export class SecurityService {
  private static deterministicStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(this.deterministicStringify.bind(this)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort(byCodeUnit);
    return '{' + keys.map(k => JSON.stringify(k) + ':' + this.deterministicStringify((obj as Record<string, unknown>)[k])).join(',') + '}';
  }

  static canonicalForensicPayload(data: unknown): unknown {
    if (data === null || typeof data !== 'object') return data;
    const { verification: _verification, ...rest } = data as Record<string, unknown>;
    return rest;
  }

  /**
   * Generates a forensic hash for an entity state
   * Used for "Vault" integrity and "Audit Trail" verification
   */
  static generateForensicHash(data: unknown): string {
    const payload = this.canonicalForensicPayload(data);
    const serialized = this.deterministicStringify(payload);
    const salt = process.env.SYSTEM_SALT;
    if (!salt) {
      throw new Error("SYSTEM_SALT environment variable is not set. Refusing to generate a forensic hash with a fallback.");
    }
    return crypto.createHmac('sha256', salt)
      .update(serialized)
      .digest('hex');
  }

  /**
   * Verifies a payload against its recorded hash
   */
  static verifyIntegrity(data: unknown, hash: string): boolean {
    const currentHash = this.generateForensicHash(data);
    const a = Buffer.from(currentHash, 'utf8');
    const b = Buffer.from(hash, 'utf8');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Sanitizes sensitive information for logs
   */
  static scrubPII(text: string): string {
    if (!text) return "";
    const beforeEmails = text
      // Secret API keys (LedgerFlow, Stripe, Google AI/Gemini)
      .replace(/\b(lf_live_[a-zA-Z0-9_-]+|lf_test_[a-zA-Z0-9_-]+|sk_live_[a-zA-Z0-9_-]+|sk_test_[a-zA-Z0-9_-]+|AIza[a-zA-Z0-9_-]{30,45})\b/g, "[SECRET_KEY_REDACTED]")
      // Credit card numbers (formatted or contiguous 13-16 digits)
      .replace(/\b(?:\d{4}[ -]?){3}\d{1,4}\b|\b\d{13,16}\b/g, "[CREDIT_CARD_REDACTED]");
    // Emails, in one pass (Sonar S8786)
    return maskEmails(beforeEmails, "[EMAIL_REDACTED]")
      // Formatted SSNs (e.g. 123-45-6789) or explicitly labeled SSN
      .replace(/\b\d{3}-\d{2}-\d{4}\b|\b(?:ssn|social security)[\s#:]*(\d{9})\b/gi, "[SSN_REDACTED]")
      // Formatted phone numbers (e.g. (123) 456-7890, +1 123-456-7890, 123.456.7890)
      .replace(/\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]([0-9]{3})[-. ]([0-9]{4})\b/g, "[PHONE_REDACTED]")
      // Routing numbers with explicit context
      .replace(/\b(?:routing|aba|rtn)[\s#:]*(\d{9})\b/gi, "[ROUTING_REDACTED]")
      // Bank account numbers with explicit context
      .replace(/\b(?:acct|account|acc)[\s#:]*(\d{6,17})\b/gi, "[ACCOUNT_REDACTED]");
  }

  private static getEncryptionKey(): Buffer {
    const secret = process.env.SYSTEM_SALT || process.env.ENCRYPTION_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'test') {
        return crypto.createHash('sha256').update("test-ledgerflow-secure-key-32b").digest();
      }
      throw new Error("SYSTEM_SALT or ENCRYPTION_SECRET environment variable is not set. Refusing to encrypt/decrypt without a secure secret.");
    }
    return crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Encrypts sensitive fields (such as banking access tokens) using AES-256-GCM
   */
  static encryptSensitiveField(plainText: string): string {
    if (!plainText) return plainText;
    if (plainText.startsWith('enc:')) return plainText; // Prevent double encryption
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypts AES-256-GCM encrypted fields
   */
  static decryptSensitiveField(cipherText: string): string {
    if (!cipherText || !cipherText.startsWith('enc:')) return cipherText;
    const parts = cipherText.split(':');
    if (parts.length !== 4) return cipherText;
    try {
      const iv = Buffer.from(parts[1], 'hex');
      const authTag = Buffer.from(parts[2], 'hex');
      const encrypted = parts[3];
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error("[SecurityService] Decryption failed:", err);
      throw new Error(`Decryption failed: tampered ciphertext or invalid key. ${(err as Error)?.message || ''}`, { cause: err });
    }
  }
}
