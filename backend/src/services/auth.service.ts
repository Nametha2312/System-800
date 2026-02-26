import * as crypto from 'crypto';
import { User, UserRole } from '../types/index.js';
import { getUserRepository, UserRepository } from '../persistence/repositories/user.repository.js';
import { getDatabase } from '../persistence/database.js';
import { getLogger, Logger } from '../observability/logger.js';
import { getConfig } from '../config/index.js';
import type { ApiError } from '../api/middleware/error.middleware.js';

function httpError(statusCode: number, message: string, code: string): ApiError {
  const err = new Error(message) as ApiError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Parse JWT duration strings ("15m", "1h", "24h", "7d") to seconds.
 * Falls back to `defaultSeconds` for unrecognized formats.
 */
function parseDurationToSeconds(value: string, defaultSeconds: number): number {
  if (!value) return defaultSeconds;
  const match = value.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return defaultSeconds;
  const amount = parseInt(match[1]!, 10);
  switch (match[2]) {
    case 's': return amount;
    case 'm': return amount * 60;
    case 'h': return amount * 3600;
    case 'd': return amount * 86400;
    default:  return defaultSeconds;
  }
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: Omit<User, 'passwordHash'>;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  validateToken(token: string): Promise<TokenPayload | null>;
  refreshToken(refreshToken: string): Promise<AuthResult>;
  logout(userId: string): Promise<void>;
  changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void>;
  getUserById(userId: string): Promise<User | null>;
  updateUser(userId: string, updates: Partial<Pick<User, 'name' | 'email'>>): Promise<User>;
  deactivateUser(userId: string): Promise<void>;
  activateUser(userId: string): Promise<void>;
}

class AuthServiceImpl implements AuthService {
  private readonly repository: UserRepository;
  private readonly logger: Logger;
  private readonly jwtSecret: string;
  private readonly accessTokenExpiry: number;
  private readonly refreshTokenExpiry: number;
  private readonly refreshTokens: Map<string, { userId: string; expiresAt: number }>;

  constructor(repository?: UserRepository) {
    this.repository = repository ?? getUserRepository();
    this.logger = getLogger().child({ service: 'AuthService' });

    const config = getConfig();
    this.jwtSecret = config.jwt.secret;
    // Parse duration strings like "15m", "1h", "7d" → seconds
    this.accessTokenExpiry = parseDurationToSeconds(config.jwt.expiresIn, 900);
    this.refreshTokenExpiry = parseDurationToSeconds(config.jwt.refreshExpiresIn, 604800);
    this.refreshTokens = new Map();
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    this.logger.info('Registering new user', { email: input.email });

    const existing = await this.repository.findByEmail(input.email);
    if (existing !== null) {
      throw new Error('User with this email already exists');
    }

    const passwordHash = await this.hashPassword(input.password);

    const user = await this.repository.create({
      email: input.email,
      name: input.name,
      passwordHash,
      role: UserRole.USER,
      isActive: true,
      lastLoginAt: new Date(),
    });

    const tokens = this.generateTokens(user);

    this.logger.info('User registered successfully', { userId: user.id });

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    this.logger.info('User login attempt', { email: input.email });

    const user = await this.repository.findByEmail(input.email);
    if (user === null) {
      throw httpError(401, 'Invalid email or password', 'UNAUTHORIZED');
    }

    if (!user.isActive) {
      throw httpError(401, 'User account is deactivated', 'UNAUTHORIZED');
    }

    const isValid = await this.verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      throw httpError(401, 'Invalid email or password', 'UNAUTHORIZED');
    }

    await this.repository.updateLastLogin(user.id);

    const tokens = this.generateTokens(user);

    this.logger.info('User logged in successfully', { userId: user.id });

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async validateToken(token: string): Promise<TokenPayload | null> {
    try {
      const payload = this.decodeToken(token);

      if (payload === null) {
        return null;
      }

      if (payload.exp < Date.now() / 1000) {
        return null;
      }

      const user = await this.repository.findById(payload.userId);
      if (user === null || !user.isActive) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  async refreshToken(refreshToken: string): Promise<AuthResult> {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Try DB first
    try {
      const db = getDatabase();
      const result = await db.query<{
        user_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT user_id, expires_at, revoked_at FROM refresh_tokens
         WHERE token_hash = $1`,
        [tokenHash],
      );

      if (result.rows.length > 0) {
        const row = result.rows[0]!;

        if (row.revoked_at !== null) {
          throw new Error('Refresh token has been revoked');
        }

        if (row.expires_at < new Date()) {
          // Clean up expired token
          await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
          throw new Error('Refresh token expired');
        }

        const user = await this.repository.findById(row.user_id);
        if (user === null || !user.isActive) {
          await db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
          throw new Error('User not found or inactive');
        }

        // Rotate: revoke old token, issue new one
        await db.query(
          'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
          [tokenHash],
        );
        // Remove from in-memory store as well
        this.refreshTokens.delete(refreshToken);

        const tokens = this.generateTokens(user);
        this.logger.info('Token refreshed (DB)', { userId: user.id });
        return { user: this.sanitizeUser(user), ...tokens };
      }
    } catch (dbErr) {
      if (dbErr instanceof Error && (dbErr.message.includes('revoked') || dbErr.message.includes('expired') || dbErr.message.includes('inactive') || dbErr.message.includes('not found'))) {
        throw dbErr;
      }
      // DB unavailable or token not in DB - fall through to in-memory
      this.logger.debug('DB refresh token lookup failed, trying in-memory', {
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    // Fallback: in-memory refresh tokens
    const stored = this.refreshTokens.get(refreshToken);

    if (stored === undefined) {
      throw new Error('Invalid refresh token');
    }

    if (stored.expiresAt < Date.now()) {
      this.refreshTokens.delete(refreshToken);
      throw new Error('Refresh token expired');
    }

    const user = await this.repository.findById(stored.userId);
    if (user === null || !user.isActive) {
      this.refreshTokens.delete(refreshToken);
      throw new Error('User not found or inactive');
    }

    this.refreshTokens.delete(refreshToken);
    const tokens = this.generateTokens(user);
    this.logger.info('Token refreshed (in-memory)', { userId: user.id });
    return { user: this.sanitizeUser(user), ...tokens };
  }

  async logout(userId: string): Promise<void> {
    this.logger.info('User logout', { userId });

    // Revoke all DB-backed refresh tokens for this user
    try {
      const db = getDatabase();
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId],
      );
    } catch (err) {
      this.logger.warn('Failed to revoke DB refresh tokens on logout', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Also clear in-memory tokens
    for (const [token, data] of this.refreshTokens.entries()) {
      if (data.userId === userId) {
        this.refreshTokens.delete(token);
      }
    }
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    this.logger.info('Password change request', { userId });

    const user = await this.repository.findById(userId);
    if (user === null) {
      throw new Error('User not found');
    }

    const isValid = await this.verifyPassword(oldPassword, user.passwordHash);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    const newHash = await this.hashPassword(newPassword);
    await this.repository.updatePassword(userId, newHash);

    await this.logout(userId);

    this.logger.info('Password changed successfully', { userId });
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.repository.findById(userId);
  }

  async updateUser(
    userId: string,
    updates: Partial<Pick<User, 'name' | 'email'>>,
  ): Promise<User> {
    this.logger.info('Updating user', { userId, updates: Object.keys(updates) });

    if (updates.email !== undefined) {
      const existing = await this.repository.findByEmail(updates.email);
      if (existing !== null && existing.id !== userId) {
        throw new Error('Email already in use');
      }
    }

    const user = await this.repository.update(userId, updates);
    if (user === null) {
      throw new Error('User not found');
    }

    return user;
  }

  async deactivateUser(userId: string): Promise<void> {
    this.logger.info('Deactivating user', { userId });

    const user = await this.repository.update(userId, { isActive: false });
    if (user === null) {
      throw new Error('User not found');
    }

    await this.logout(userId);
  }

  async activateUser(userId: string): Promise<void> {
    this.logger.info('Activating user', { userId });

    const user = await this.repository.update(userId, { isActive: true });
    if (user === null) {
      throw new Error('User not found');
    }
  }

  private async hashPassword(password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
        if (err !== null) {
          reject(err);
          return;
        }
        resolve(`${salt}:${derivedKey.toString('hex')}`);
      });
    });
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const [salt, key] = hash.split(':');
      if (salt === undefined || key === undefined) {
        resolve(false);
        return;
      }
      crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
        if (err !== null) {
          reject(err);
          return;
        }
        resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
      });
    });
  }

  private generateTokens(user: User): {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  } {
    const now = Math.floor(Date.now() / 1000);

    const payload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      iat: now,
      exp: now + this.accessTokenExpiry,
    };

    const accessToken = this.encodeToken(payload);

    const refreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.refreshTokenExpiry * 1000);

    // Store in DB (non-blocking fire-and-forget with fallback to in-memory)
    const db = getDatabase();
    db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (token_hash) DO NOTHING`,
      [user.id, tokenHash, expiresAt],
    ).catch((err: unknown) => {
      // If DB fails (e.g., table not yet created), fall back to in-memory
      this.logger.warn('Failed to persist refresh token to DB, using in-memory fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.refreshTokens.set(refreshToken, {
        userId: user.id,
        expiresAt: expiresAt.getTime(),
      });
    });

    // Also keep in memory for immediate use (before DB write completes)
    this.refreshTokens.set(refreshToken, {
      userId: user.id,
      expiresAt: expiresAt.getTime(),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenExpiry,
    };
  }

  private encodeToken(payload: TokenPayload): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  private decodeToken(token: string): TokenPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, body, signature] = parts;
    if (header === undefined || body === undefined || signature === undefined) {
      return null;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
      return payload;
    } catch {
      return null;
    }
  }

  private sanitizeUser(user: User): Omit<User, 'passwordHash'> {
    const { passwordHash: _, ...sanitized } = user;
    return sanitized;
  }
}

let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (authServiceInstance === null) {
    authServiceInstance = new AuthServiceImpl();
  }
  return authServiceInstance;
}

export { AuthServiceImpl };
