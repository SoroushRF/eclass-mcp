import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const SECURE_SESSION_FORMAT = 'eclass-mcp.secure-session.v1';
const CIPHER = 'aes-256-gcm';
const KDF = 'scrypt';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const MIN_SECRET_LENGTH = 32;

export type SecureSessionStorageReason =
  | 'missing_secret'
  | 'weak_secret'
  | 'legacy_plaintext'
  | 'malformed_envelope'
  | 'unsupported_envelope'
  | 'decrypt_failed'
  | 'write_failed'
  | 'read_failed';

export class SecureSessionStorageError extends Error {
  readonly code = 'SESSION_STORAGE_UNAVAILABLE' as const;
  readonly reason: SecureSessionStorageReason;
  readonly filePath?: string;

  constructor(
    reason: SecureSessionStorageReason,
    message: string,
    options?: { filePath?: string; cause?: unknown }
  ) {
    super(message);
    this.name = 'SecureSessionStorageError';
    this.reason = reason;
    this.filePath = options?.filePath;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

interface SecureSessionEnvelope {
  format: typeof SECURE_SESSION_FORMAT;
  created_at: string;
  cipher: typeof CIPHER;
  kdf: typeof KDF;
  kdf_params: {
    salt: string;
    key_length: number;
  };
  iv: string;
  tag: string;
  payload: string;
}

export function isSecureSessionStorageError(
  value: unknown
): value is SecureSessionStorageError {
  return value instanceof SecureSessionStorageError;
}

export function getSecureSessionSecret(): string | null {
  const secret = process.env.ECLASS_MCP_SESSION_SECRET;
  if (!secret) return null;
  return secret;
}

export function assertSecureSessionConfigured(): void {
  const secret = getSecureSessionSecret();
  if (!secret) {
    throw new SecureSessionStorageError(
      'missing_secret',
      'Secure session storage is not configured. Set ECLASS_MCP_SESSION_SECRET to a long local secret, clear old plaintext sessions if present, then authenticate again.'
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new SecureSessionStorageError(
      'weak_secret',
      `Secure session storage secret is too short. ECLASS_MCP_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`
    );
  }
}

export function isSecureSessionConfigured(): boolean {
  try {
    assertSecureSessionConfigured();
    return true;
  } catch {
    return false;
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, KEY_LENGTH);
}

function ensureSecureDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort. chmod is limited on Windows and some synced folders.
  }
}

export function encryptJsonPayload(value: unknown): SecureSessionEnvelope {
  assertSecureSessionConfigured();
  const secret = getSecureSessionSecret() as string;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(secret, salt);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    format: SECURE_SESSION_FORMAT,
    created_at: new Date().toISOString(),
    cipher: CIPHER,
    kdf: KDF,
    kdf_params: {
      salt: salt.toString('base64'),
      key_length: KEY_LENGTH,
    },
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    payload: encrypted.toString('base64'),
  };
}

function assertEnvelopeShape(
  parsed: unknown,
  filePath?: string
): asserts parsed is SecureSessionEnvelope {
  if (!parsed || typeof parsed !== 'object') {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Secure session file is malformed.',
      { filePath }
    );
  }

  const envelope = parsed as Partial<SecureSessionEnvelope>;
  if (!('format' in envelope)) {
    throw new SecureSessionStorageError(
      'legacy_plaintext',
      'Legacy plaintext session files are no longer accepted. Clear local auth sessions and authenticate again.',
      { filePath }
    );
  }

  if (envelope.format !== SECURE_SESSION_FORMAT) {
    throw new SecureSessionStorageError(
      'unsupported_envelope',
      'Secure session file uses an unsupported format.',
      { filePath }
    );
  }

  if (
    envelope.cipher !== CIPHER ||
    envelope.kdf !== KDF ||
    !envelope.kdf_params ||
    typeof envelope.kdf_params.salt !== 'string' ||
    envelope.kdf_params.key_length !== KEY_LENGTH ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.payload !== 'string'
  ) {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Secure session file is malformed.',
      { filePath }
    );
  }
}

export function decryptJsonPayload<T>(envelope: unknown, filePath?: string): T {
  assertSecureSessionConfigured();
  assertEnvelopeShape(envelope, filePath);
  const secret = getSecureSessionSecret() as string;

  try {
    const salt = Buffer.from(envelope.kdf_params.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const payload = Buffer.from(envelope.payload, 'base64');
    const key = deriveKey(secret, salt);
    const decipher = crypto.createDecipheriv(CIPHER, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(payload),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf-8')) as T;
  } catch (cause) {
    if (cause instanceof SecureSessionStorageError) throw cause;
    throw new SecureSessionStorageError(
      'decrypt_failed',
      'Secure session file could not be decrypted. Check ECLASS_MCP_SESSION_SECRET, clear local auth sessions, then authenticate again.',
      { filePath, cause }
    );
  }
}

export function writeSecureJsonFile(filePath: string, value: unknown): void {
  const envelope = encryptJsonPayload(value);
  ensureSecureDirectory(filePath);
  const tmpPath = `${filePath}.tmp-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      // Best effort on Windows.
    }
    fs.renameSync(tmpPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Best effort on Windows.
    }
  } catch (cause) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failures after a failed write.
    }
    throw new SecureSessionStorageError(
      'write_failed',
      'Secure session file could not be written.',
      { filePath, cause }
    );
  }
}

export function readSecureJsonFile<T>(filePath: string): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (cause) {
    throw new SecureSessionStorageError(
      'read_failed',
      'Secure session file could not be read.',
      { filePath, cause }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new SecureSessionStorageError(
      'malformed_envelope',
      'Secure session file is not valid JSON.',
      { filePath, cause }
    );
  }

  return decryptJsonPayload<T>(parsed, filePath);
}

export function secureDeleteFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const size = fs.statSync(filePath).size;
    if (size > 0) {
      fs.writeFileSync(filePath, crypto.randomBytes(size));
    }
  } catch {
    // Overwrite is best effort only.
  }

  fs.unlinkSync(filePath);
  return true;
}
