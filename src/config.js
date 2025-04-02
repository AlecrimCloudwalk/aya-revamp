// Environment variables and configuration

// Slack credentials
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || '';

// LLM API configuration
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_API_URL = process.env.LLM_API_URL || 'https://api.openai.com/v1/chat/completions'; 
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-3.5-turbo';

// Application settings
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const DEV_MODE = process.env.NODE_ENV !== 'production';

// Validation
const requiredEnvVars = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'LLM_API_KEY'
];

// Check for missing required environment variables
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please set these variables in your .env file or environment');
  
  // Only exit in production; allow development to continue with warnings
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

module.exports = {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  SLACK_APP_TOKEN,
  LLM_API_KEY,
  LLM_API_URL,
  LLM_MODEL,
  DEBUG_MODE,
  DEV_MODE
}; 