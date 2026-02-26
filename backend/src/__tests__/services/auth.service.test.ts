import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockUser } from '../fixtures';

// Mock crypto for password hashing
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return {
    ...actual,
    randomBytes: vi.fn().mockReturnValue(Buffer.from('a'.repeat(32), 'utf-8')),
    pbkdf2: vi.fn((password, salt, iterations, keylen, digest, callback) => {
      setTimeout(() => {
        callback(null, Buffer.from('hashed-password'));
      }, 0);
    }),
    pbkdf2Sync: vi.fn().mockReturnValue(Buffer.from('hashed-password')),
    timingSafeEqual: vi.fn().mockReturnValue(true),
  };
});

const mockUserRepository = {
  create: vi.fn(),
  findById: vi.fn(),
  findByEmail: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  updateLastLogin: vi.fn(),
  updatePassword: vi.fn(),
  findAll: vi.fn(),
};

// Mock the specific repository file
vi.mock('../../persistence/repositories/user.repository.js', () => ({
  getUserRepository: () => mockUserRepository,
}));

// Mock logger
vi.mock('../../observability/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

// Mock config
vi.mock('../../config/index.js', () => ({
  getConfig: () => ({
    jwt: {
      secret: 'test-jwt-secret-key-minimum-32-characters-long',
      accessTokenExpiry: '1h',
      refreshTokenExpiry: '7d',
    },
  }),
}));

// Import service after mocks
import { AuthServiceImpl } from '../../services/auth.service.js';

describe('AuthService', () => {
  let service: InstanceType<typeof AuthServiceImpl>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthServiceImpl();
  });

  describe('register', () => {
    it('should create a new user with hashed password', async () => {
      const input = {
        email: 'test@example.com',
        password: 'securepassword123',
        name: 'Test User',
      };

      const createdUser = createMockUser({
        email: input.email,
      });

      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(createdUser);

      const result = await service.register(input);

      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(input.email);
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: input.email,
        }),
      );
      expect(result.user.email).toBe(input.email);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw error if email already exists', async () => {
      const existingUser = createMockUser();
      mockUserRepository.findByEmail.mockResolvedValue(existingUser);

      await expect(
        service.register({
          email: existingUser.email,
          password: 'password123',
          name: 'Test',
        }),
      ).rejects.toThrow('User with this email already exists');
    });
  });

  describe('login', () => {
    it('should authenticate valid credentials', async () => {
      const user = createMockUser({
        passwordHash: 'salt:hashedvalue',
        isActive: true,
      });

      mockUserRepository.findByEmail.mockResolvedValue(user);
      mockUserRepository.updateLastLogin.mockResolvedValue(undefined);

      // Mock the private verifyPassword method
      vi.spyOn(service as any, 'verifyPassword').mockResolvedValue(true);

      const result = await service.login({
        email: user.email,
        password: 'correct-password',
      });

      expect(result.user.email).toBe(user.email);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(mockUserRepository.updateLastLogin).toHaveBeenCalledWith(user.id);
    });

    it('should reject invalid email', async () => {
      mockUserRepository.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('should reject invalid password', async () => {
      const user = createMockUser({ isActive: true });
      mockUserRepository.findByEmail.mockResolvedValue(user);
      vi.spyOn(service as any, 'verifyPassword').mockResolvedValue(false);

      await expect(
        service.login({
          email: user.email,
          password: 'wrong-password',
        }),
      ).rejects.toThrow('Invalid email or password');
    });

    it('should reject inactive user', async () => {
      const inactiveUser = createMockUser({ isActive: false });
      mockUserRepository.findByEmail.mockResolvedValue(inactiveUser);

      await expect(
        service.login({
          email: inactiveUser.email,
          password: 'password123',
        }),
      ).rejects.toThrow('User account is deactivated');
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens for valid refresh token', async () => {
      const user = createMockUser({ isActive: true });
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(user);
      mockUserRepository.findById.mockResolvedValue(user);

      // First register to get a valid refresh token
      const { refreshToken } = await service.register({
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      });

      const result = await service.refreshToken(refreshToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should reject invalid refresh token', async () => {
      await expect(service.refreshToken('invalid-token')).rejects.toThrow('Invalid refresh token');
    });
  });

  describe('validateToken', () => {
    it('should return payload for valid token', async () => {
      const user = createMockUser({ isActive: true });
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(user);
      mockUserRepository.findById.mockResolvedValue(user);

      const { accessToken } = await service.register({
        email: 'verify@example.com',
        password: 'password123',
        name: 'Test',
      });

      const payload = await service.validateToken(accessToken);

      expect(payload).toBeDefined();
      expect(payload?.userId).toBeDefined();
    });

    it('should return null for invalid token', async () => {
      const payload = await service.validateToken('invalid-token');
      expect(payload).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('should change password with valid current password', async () => {
      const user = createMockUser({ passwordHash: 'salt:hash' });
      mockUserRepository.findById.mockResolvedValue(user);
      mockUserRepository.updatePassword.mockResolvedValue(undefined);
      vi.spyOn(service as any, 'verifyPassword').mockResolvedValue(true);

      await service.changePassword(user.id, 'oldPassword123', 'newPassword456');

      expect(mockUserRepository.updatePassword).toHaveBeenCalledWith(
        user.id,
        expect.any(String),
      );
    });

    it('should reject with wrong current password', async () => {
      const user = createMockUser();
      mockUserRepository.findById.mockResolvedValue(user);
      vi.spyOn(service as any, 'verifyPassword').mockResolvedValue(false);

      await expect(
        service.changePassword(user.id, 'wrongPassword', 'newPassword456'),
      ).rejects.toThrow('Current password is incorrect');
    });

    it('should throw if user not found', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      await expect(
        service.changePassword('non-existent', 'currentPass', 'newPass'),
      ).rejects.toThrow('User not found');
    });
  });

  describe('deactivateUser', () => {
    it('should deactivate user account', async () => {
      const user = createMockUser({ isActive: true });
      const deactivatedUser = { ...user, isActive: false };

      mockUserRepository.update.mockResolvedValue(deactivatedUser);

      await service.deactivateUser(user.id);

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ isActive: false }),
      );
    });

    it('should throw if user not found', async () => {
      mockUserRepository.update.mockResolvedValue(null);

      await expect(service.deactivateUser('non-existent')).rejects.toThrow('User not found');
    });
  });

  describe('activateUser', () => {
    it('should activate user account', async () => {
      const user = createMockUser({ isActive: false });
      const activatedUser = { ...user, isActive: true };

      mockUserRepository.update.mockResolvedValue(activatedUser);

      await service.activateUser(user.id);

      expect(mockUserRepository.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ isActive: true }),
      );
    });

    it('should throw if user not found', async () => {
      mockUserRepository.update.mockResolvedValue(null);

      await expect(service.activateUser('non-existent')).rejects.toThrow('User not found');
    });
  });

  describe('getUserById', () => {
    it('should return user when found', async () => {
      const user = createMockUser();
      mockUserRepository.findById.mockResolvedValue(user);

      const result = await service.getUserById(user.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(user.id);
    });

    it('should return null for non-existent user', async () => {
      mockUserRepository.findById.mockResolvedValue(null);

      const result = await service.getUserById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('logout', () => {
    it('should clear user refresh tokens', async () => {
      const user = createMockUser({ isActive: true });
      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.create.mockResolvedValue(user);

      // Register to create a refresh token
      await service.register({
        email: 'logout@example.com',
        password: 'password123',
        name: 'Test',
      });

      // Logout should not throw
      await expect(service.logout(user.id)).resolves.toBeUndefined();
    });
  });
});
