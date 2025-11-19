const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const crypto = require('crypto'); // Required for requestId

const app = express();

// **FIXED**: Configure 'trust proxy' for secure rate limiting in development.
// This resolves the ERR_ERL_PERMISSIVE_TRUST_PROXY error by only trusting
// the loopback address (your local machine). For production, you would
// change 'loopback' to the specific IP of your reverse proxy or load balancer.
app.set('trust proxy', 'loopback');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Be cautious with this in production
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true
}));

app.use(compression());

// Logging middleware
if (process.env.NODE_ENV !== 'test') {
  // Using 'combined' format for detailed logs, similar to Apache standard.
  app.use(morgan('combined'));
}

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request metadata middleware to add a timestamp and unique ID to each request
app.use((req, res, next) => {
  req.timestamp = new Date();
  req.requestId = crypto.randomBytes(8).toString('hex');
  next();
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Pulse Backend API',
    version: '1.0.0' // Consider moving version to a config file or package.json
  });
});

// --- API Routes ---
// All authentication-related routes are handled by the auth router.
app.use('/api/v1/auth', require('./routes/auth'));
// User routes (profiles, follow, etc.)
app.use('/api/v1/users', require('./routes/users'));
// Post routes (create, like, comment)
app.use('/api/v1/posts', require('./routes/posts'));


// 404 handler for any requests that don't match a defined route
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found. The requested endpoint does not exist.',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((error, req, res, next) => {
  // Log the error with the request ID for easier debugging
  console.error(`[${req.requestId || 'unknown'}] Global Error:`, error);
  
  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(e => e.message);
    return res.status(400).json({
      success: false,
      error: 'Validation failed. Please check your input.',
      details: errors,
      code: 'VALIDATION_ERROR'
    });
  }

  // Mongoose duplicate key error (e.g., username already exists)
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      error: `A record with that ${field} already exists.`,
      code: 'DUPLICATE_ERROR'
    });
  }

  // Generic error response
  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'An unexpected internal server error occurred.',
    code: error.code || 'INTERNAL_ERROR',
    requestId: req.requestId,
    // Only include the stack trace in development for security reasons
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

module.exports = app;
