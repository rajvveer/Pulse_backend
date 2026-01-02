const Redis = require('ioredis');
const config = require('./index'); // Importing your Config class

// Get settings from your Config class
const redisConfig = config.get('redis');

const redisClient = new Redis({
  host: redisConfig.host,
  port: redisConfig.port,
  password: redisConfig.password,
  // If you use a full URL in production (like Render/Heroku):
  // url: redisConfig.url 
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redisClient.on('connect', () => {
  console.log('✅ Redis Connected');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis Error:', err);
});

module.exports = redisClient;