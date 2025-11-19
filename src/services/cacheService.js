const Redis = require('ioredis');

class CacheService {
  constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      showFriendlyErrorStack: true,
    };

    if (process.env.REDIS_PASSWORD) {
      redisConfig.password = process.env.REDIS_PASSWORD;
    }

    this.redis = new Redis(redisConfig);
    this.isConnected = false;

    // Connection event handlers
    this.redis.on('connect', () => {
      console.log('🔗 Connecting to Redis server...');
    });

    this.redis.on('ready', () => {
      console.log('✅ Redis is ready to use!');
      this.isConnected = true;
    });

    this.redis.on('error', (error) => {
      console.error('❌ Redis connection error:', error.message);
      this.isConnected = false;
    });

    this.redis.on('close', () => {
      console.log('🔌 Redis connection closed');
      this.isConnected = false;
    });

    this.redis.on('reconnecting', () => {
      console.log('🔄 Reconnecting to Redis...');
    });
  }

  // FIXED: Ensure ping method exists
  async ping() {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis ping failed:', error.message);
      return false;
    }
  }

  // Basic cache operations
  async set(key, value, ttl = 600) {
    try {
      if (ttl) {
        return await this.redis.setex(key, ttl, JSON.stringify(value));
      }
      return await this.redis.set(key, JSON.stringify(value));
    } catch (error) {
      console.error('Redis SET error:', error.message);
      return false;
    }
  }

  async get(key) {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Redis GET error:', error.message);
      return null;
    }
  }

  async del(key) {
    try {
      return await this.redis.del(key);
    } catch (error) {
      console.error('Redis DEL error:', error.message);
      return 0;
    }
  }

  async exists(key) {
    try {
      return await this.redis.exists(key);
    } catch (error) {
      console.error('Redis EXISTS error:', error.message);
      return false;
    }
  }

  // Cache with automatic refresh
  async getOrSet(key, fetchFunction, ttl = 600) {
    let value = await this.get(key);
    
    if (value === null) {
      try {
        console.log(`🔍 Cache miss for key: ${key}, fetching data...`);
        value = await fetchFunction();
        await this.set(key, value, ttl);
        console.log(`💾 Cached data for key: ${key}`);
      } catch (error) {
        console.error(`Cache fetch error for key ${key}:`, error.message);
        return null;
      }
    } else {
      console.log(`⚡ Cache hit for key: ${key}`);
    }
    
    return value;
  }

  // Feed caching
  async cacheFeed(userId, location, data, ttl = 300) {
    const key = `feed:${userId}:${Math.round(location.lat * 1000)}:${Math.round(location.lng * 1000)}`;
    return await this.set(key, data, ttl);
  }

  async getCachedFeed(userId, location) {
    const key = `feed:${userId}:${Math.round(location.lat * 1000)}:${Math.round(location.lng * 1000)}`;
    return await this.get(key);
  }

  // OTP caching
  async cacheOTP(identifier, otpData, ttl = 300) {
    const key = `otp:${identifier}`;
    return await this.set(key, otpData, ttl);
  }

  async getCachedOTP(identifier) {
    const key = `otp:${identifier}`;
    return await this.get(key);
  }

  async deleteCachedOTP(identifier) {
    const key = `otp:${identifier}`;
    return await this.del(key);
  }

  // User session caching
  async cacheUserSession(userId, sessionData, ttl = 3600) {
    const key = `session:${userId}`;
    return await this.set(key, sessionData, ttl);
  }

  async getCachedUserSession(userId) {
    const key = `session:${userId}`;
    return await this.get(key);
  }

  // Rate limiting
  async incrementRateLimit(key, ttl = 60) {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, ttl);
      }
      return count;
    } catch (error) {
      console.error('Rate limit error:', error.message);
      return 1;
    }
  }

  // Statistics
  async getStats() {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      
      return {
        connected: this.isConnected,
        used_memory_human: info.match(/used_memory_human:(.*)/)?.[1]?.trim() || 'Unknown',
        total_keys: keyspace.match(/keys=(\d+)/)?.[1] || '0',
        expired_keys: keyspace.match(/expires=(\d+)/)?.[1] || '0'
      };
    } catch (error) {
      console.error('Stats error:', error.message);
      return { connected: false, error: error.message };
    }
  }

  // Clear all cache
  async flushAll() {
    try {
      return await this.redis.flushall();
    } catch (error) {
      console.error('Flush all error:', error.message);
      return false;
    }
  }

  // Graceful shutdown
  async disconnect() {
    try {
      await this.redis.quit();
      console.log('👋 Redis connection closed gracefully');
    } catch (error) {
      console.error('Redis disconnect error:', error.message);
    }
  }
}

// Export singleton instance
module.exports = new CacheService();
