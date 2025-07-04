// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();

const { App } = require('@slack/bolt');
const { setupSlackEvents } = require('./slackEvents.js');
const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN } = require('./config.js');
const { logError } = require('./errors.js');
const { setSlackClient } = require('./slackClient.js');
// Add tools import to verify they're loaded properly
const tools = require('./tools/index.js');
const logger = require('./toolUtils/logger.js');
// Initialize context builders
const { getContextBuilder } = require('./contextBuilder.js');
const { getThreadContextBuilder } = require('./threadContextBuilder.js');


// Reduce logging noise
const isVerboseLogging = process.env.VERBOSE_LOGGING === 'true';

// Override console.log with a filtered version
const originalConsoleLog = console.log;
console.log = function() {
  // Skip socket-mode client logs and other noisy messages unless verbose logging is enabled
  const skipPattern = /socket-mode|Going to establish|Now connected|connection|punycode|DEP0040/i;
  
  if (arguments[0] && typeof arguments[0] === 'string' && skipPattern.test(arguments[0]) && !isVerboseLogging) {
    return; // Skip noisy log messages
  }
  
  // Call the original console.log with all arguments
  originalConsoleLog.apply(console, arguments);
};

// Initialize Slack Bolt app
const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
  // Customize logging behavior
  logLevel: isVerboseLogging ? 'debug' : 'info',
});

// Store the Slack client in our singleton
setSlackClient(app.client);

// Function to verify tools are loaded properly
function verifyTools() {
  // Count the number of tools
  const toolsCount = Object.keys(tools).length;
  
  // Log tools count
  logger.info(`Loaded ${toolsCount} tools`);
  
  // Verify context builders are initialized
  try {
    // Initialize both context builders
    const contextBuilder = getContextBuilder();
    const threadContextBuilder = getThreadContextBuilder();
    
    // Log success
    logger.info('Context builders initialized successfully');
  } catch (error) {
    logError('Failed to initialize context builders', error);
    throw error;
  }
  
  // Success - return true
  return true;
}

// Set up Slack event listeners
setupSlackEvents(app);

// Start the app
(async () => {
  try {
    // Verify tools before starting
    verifyTools();
    
    await app.start();
    logger.info('⚡️ Slack bot is running!');
  } catch (error) {
    logError('Failed to start Slack bot', error);
    process.exit(1);
  }
})(); 