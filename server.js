// server.js
const express = require('express');
const { URL } = require('url');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet()); // Sets various HTTP headers for security
app.disable('x-powered-by'); // Remove X-Powered-By header
app.use(express.json({ limit: '1kb' })); // Limit JSON body size

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// List of allowed sites to ping
const ALLOWED_SITES = new Set([
  'https://events-deals-api.onrender.com' // No trailing slash
  // Add more sites here as needed
]);

// Input validation for URLs
function isValidUrl(url) {
  try {
    const parsedUrl = new URL(url);
    // Only allow HTTP/HTTPS protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }
    // Check if the URL is in our allowed list
    return ALLOWED_SITES.has(`${parsedUrl.protocol}//${parsedUrl.hostname}`);
  } catch (e) {
    return false;
  }
}

// Ping interval in milliseconds (4 minutes = 240000 ms)
const PING_INTERVAL = 4 * 60 * 1000;

// Function to ping a site with timeout
async function pingSite(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const start = Date.now();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MonitoringBot/1.0'
      },
      redirect: 'follow',
      follow: 2,
      timeout: 10000
    });
    clearTimeout(timeout);
    
    const end = Date.now();
    const responseTime = end - start;
    
    console.log(`[${new Date().toISOString()}] Pinged ${url} - Status: ${response.status} - Response Time: ${responseTime}ms`);
    return {
      url,
      status: response.status,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString(),
      success: response.ok
    };
  } catch (error) {
    clearTimeout(timeout);
    const errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message;
    console.error(`[${new Date().toISOString()}] Error pinging ${url}:`, errorMsg);
    return {
      url,
      status: 'error',
      error: errorMsg,
      timestamp: new Date().toISOString(),
      success: false
    };
  }
}

// Set up interval to ping all sites
let isRunning = false;
const pingInterval = setInterval(async () => {
  if (isRunning) {
    console.log(`[${new Date().toISOString()}] Previous ping cycle still running, skipping...`);
    return;
  }
  
  try {
    isRunning = true;
    console.log(`\n--- Starting ping cycle at ${new Date().toISOString()} ---`);
    
    for (const site of ALLOWED_SITES) {
      try {
        await pingSite(site);
        // Add a small delay between pings to avoid overwhelming servers
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error in ping cycle for ${site}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in ping cycle:', error);
  } finally {
    isRunning = false;
  }
}, PING_INTERVAL);

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  clearInterval(pingInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  clearInterval(pingInterval);
  process.exit(0);
});

// Basic route to check if server is running
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Ping server is running',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Not Found',
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// Start the server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ping server running on port ${PORT}`);
  console.log(`Monitoring ${ALLOWED_SITES.size} sites every ${PING_INTERVAL/1000/60} minutes`);
  
  // Initial ping when server starts
  ALLOWED_SITES.forEach(site => {
    console.log(`Initial ping to ${site}`);
    pingSite(site).catch(console.error);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In production, you might want to gracefully shut down
  // process.exit(1);
});