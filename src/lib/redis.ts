import Redis from 'ioredis';

// Redis connection configuration - handle missing Redis gracefully
let redis: Redis | null = null;
let redisConnectionError: string | null = null;

// Determine if we're running on Render (production) or locally
const isRender = !!process.env.RENDER;
const isProduction = process.env.NODE_ENV === 'production';

// Get the appropriate Redis URL based on environment
function getRedisUrl(): string | undefined {
  if (isRender || isProduction) {
    // Production/Deployed environment - use production Redis
    return process.env.REDIS_URL_PROD || process.env.REDIS_URL;
  } else {
    // Local development environment - use local Redis
    return process.env.REDIS_URL_LOCAL || process.env.REDIS_URL;
  }
}

const redisUrl = getRedisUrl();

if (redisUrl) {
  try {
    console.log(`🔗 Connecting to Redis: ${isRender || isProduction ? 'PRODUCTION' : 'LOCAL'} environment`);
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    
    // Add error event listeners
    redis.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
      redisConnectionError = error.message;
    });
    
    redis.on('connect', () => {
      console.log('✅ Connected to Redis');
      redisConnectionError = null;
    });
    
    redis.on('ready', () => {
      console.log('✅ Redis is ready');
      redisConnectionError = null;
    });
    
    redis.on('close', () => {
      console.log('⚠️ Redis connection closed');
      redisConnectionError = 'Redis connection closed';
    });
    
    console.log('✅ Redis client initialized');
  } catch (error) {
    console.warn('⚠️ Failed to initialize Redis client:', error);
    redis = null;
    redisConnectionError = error instanceof Error ? error.message : 'Failed to initialize Redis client';
  }
} else {
  console.log('ℹ️ No Redis URL provided, running without Redis (daily limits disabled)');
  redisConnectionError = 'No Redis URL provided';
}

/**
 * Get the current date in YYYY-MM-DD format
 */
function getCurrentDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Check Redis connection status
 * @returns Promise<{connected: boolean, error: string | null}>
 */
export async function checkRedisConnection(): Promise<{connected: boolean, error: string | null}> {
  if (!redis) {
    return { connected: false, error: redisConnectionError || 'Redis not initialized' };
  }
  
  try {
    // Try to ping Redis
    await redis.ping();
    return { connected: true, error: null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Redis error';
    console.error('❌ Redis ping failed:', errorMessage);
    return { connected: false, error: errorMessage };
  }
}

/**
 * Check if the daily run limit has been exceeded
 * @param dailyCap - The maximum number of runs allowed per day
 * @returns Promise<{limitExceeded: boolean, error: string | null, currentUsage: number}>
 */
export async function checkDailyRunLimit(dailyCap: number): Promise<{limitExceeded: boolean, error: string | null, currentUsage: number}> {
  if (!redis) {
    console.log('ℹ️ Redis not available, skipping daily limit check');
    return { limitExceeded: false, error: redisConnectionError || 'Redis not available', currentUsage: 0 };
  }
  
  try {
    const today = getCurrentDateString();
    const usageKey = `usage:${today}`;
    
    // Get current usage count
    const currentUsage = await redis.get(usageKey);
    const count = currentUsage ? parseInt(currentUsage, 10) : 0;
    
    console.log(`📊 Daily usage for ${today}: ${count}/${dailyCap}`);
    
    // Check if limit exceeded
    if (count >= dailyCap) {
      console.log(`🚫 Daily run limit exceeded: ${count}/${dailyCap}`);
      return { limitExceeded: true, error: null, currentUsage: count };
    }
    
    return { limitExceeded: false, error: null, currentUsage: count };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Redis error';
    console.error('❌ Error checking daily run limit:', errorMessage);
    return { limitExceeded: false, error: errorMessage, currentUsage: 0 };
  }
}

/**
 * Increment the daily run counter and set TTL if first run of the day
 * @returns Promise<number> - The new count after increment
 */
export async function incrementDailyRunCounter(): Promise<number> {
  if (!redis) {
    console.log('ℹ️ Redis not available, skipping counter increment');
    return 1; // Return a safe default count
  }
  
  try {
    const today = getCurrentDateString();
    const usageKey = `usage:${today}`;
    
    // Increment the counter
    const newCount = await redis.incr(usageKey);
    
    // If this is the first increment of the day, set TTL to 86400 seconds (24 hours)
    if (newCount === 1) {
      await redis.expire(usageKey, 86400);
      console.log(`🆕 First run of the day for ${today}, set TTL to 24 hours`);
    }
    
    console.log(`📈 Incremented daily run counter for ${today}: ${newCount}`);
    return newCount;
  } catch (error) {
    console.error('❌ Error incrementing daily run counter:', error);
    // Return a safe default count
    return 1;
  }
}

/**
 * Get the current daily usage count without incrementing
 * @returns Promise<number> - Current usage count for today
 */
export async function getCurrentDailyUsage(): Promise<number> {
  if (!redis) {
    console.log('ℹ️ Redis not available, returning 0 usage');
    return 0;
  }
  
  try {
    const today = getCurrentDateString();
    const usageKey = `usage:${today}`;
    
    const currentUsage = await redis.get(usageKey);
    return currentUsage ? parseInt(currentUsage, 10) : 0;
  } catch (error) {
    console.error('❌ Error getting current daily usage:', error);
    return 0;
  }
}

/**
 * Close Redis connection (for cleanup)
 */
export async function closeRedisConnection(): Promise<void> {
  if (!redis) {
    console.log('ℹ️ Redis not available, nothing to close');
    return;
  }
  
  try {
    await redis.quit();
  } catch (error) {
    console.error('❌ Error closing Redis connection:', error);
  }
}

export default redis;
