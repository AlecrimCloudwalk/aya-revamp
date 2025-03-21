// Error handling and logging utilities
const { DEBUG_MODE } = require('./config.js');

/**
 * Custom error class for bot-specific errors
 */
class BotError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BotError';
    this.details = details;
    Error.captureStackTrace(this, BotError);
  }
}

/**
 * Logs an error with optional context and returns the error object
 * @param {string} message - Error message
 * @param {Error|object} error - Original error or error details
 * @param {object} context - Additional context for debugging
 * @returns {BotError} - The wrapped error
 */
function logError(message, error = {}, context = {}) {
  // Create a standardized error object
  const errorObj = error instanceof Error 
    ? { 
        message: error.message, 
        name: error.name, 
        stack: DEBUG_MODE ? error.stack : undefined 
      }
    : error;

  // Combine all information
  const fullError = {
    message,
    error: errorObj,
    context,
    timestamp: new Date().toISOString()
  };

  // Log the error
  console.error('ERROR:', JSON.stringify(fullError, null, 2));

  // Return as a BotError for consistent handling
  return new BotError(message, { originalError: error, context });
}

/**
 * Handles an error by returning it in a format the LLM can understand
 * @param {Error} error - The error to format
 * @returns {object} - Error info for the LLM
 */
function formatErrorForLLM(error) {
  return {
    error: true,
    message: error.message || 'An unknown error occurred',
    type: error.name || 'Error',
    details: error.details || {}
  };
}

module.exports = {
  BotError,
  logError,
  formatErrorForLLM
}; 