import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock environment variables for testing (before importing config)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test-jwt-secret-key-minimum-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-minimum-32-chars';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars!!!!'; // exactly 32 chars
process.env.PORT = '3001';
process.env.LOG_LEVEL = 'error';

// Mock pino to prevent noisy logs in tests
vi.mock('pino', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const pino = () => mockLogger;
  pino.stdTimeFunctions = {
    isoTime: () => `,"time":"${new Date().toISOString()}"`,
    epochTime: () => `,"time":${Date.now()}`,
    unixTime: () => `,"time":${Math.round(Date.now() / 1000)}`,
    nullTime: () => '',
  };
  pino.transport = vi.fn();
  pino.destination = vi.fn(() => ({ write: vi.fn() }));
  return { default: pino };
});

// Mock pg for database tests
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
    on: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
  };

  return {
    Pool: vi.fn(() => mockPool),
    Client: vi.fn(() => mockClient),
  };
});

// Mock ioredis for Redis tests
vi.mock('ioredis', () => {
  const mockRedis = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn(),
    on: vi.fn(),
    status: 'ready',
    duplicate: vi.fn().mockReturnThis(),
  };

  return {
    default: vi.fn(() => mockRedis),
    Redis: vi.fn(() => mockRedis),
  };
});

// Mock BullMQ
vi.mock('bullmq', () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    addBulk: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
    getJob: vi.fn(),
    getJobs: vi.fn().mockResolvedValue([]),
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    }),
    obliterate: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
    removeRepeatable: vi.fn(),
  };

  const mockWorker = {
    close: vi.fn(),
    on: vi.fn(),
  };

  return {
    Queue: vi.fn(() => mockQueue),
    Worker: vi.fn(() => mockWorker),
    QueueEvents: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
  };
});

// Mock puppeteer
vi.mock('puppeteer', () => ({
  default: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(),
        waitForSelector: vi.fn(),
        evaluate: vi.fn(),
        $: vi.fn(),
        $$: vi.fn(),
        click: vi.fn(),
        type: vi.fn(),
        close: vi.fn(),
        setUserAgent: vi.fn(),
        setViewport: vi.fn(),
        setDefaultTimeout: vi.fn(),
        on: vi.fn(),
      }),
      close: vi.fn(),
      pages: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// Cleanup mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Global setup
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Global teardown
afterAll(() => {
  vi.restoreAllMocks();
});
