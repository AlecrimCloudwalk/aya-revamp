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
 * Creates a standardized error context object for the LLM
 * @param {Error} error - Original error object
 * @param {string} origin - Component or function where error occurred
 * @param {Object} context - Additional context about the error
 * @returns {Object} - Standardized error context
 */
function createStandardizedErrorContext(error, origin, context = {}) {
  // Basic error info
  const errorContext = {
    type: error.name || 'Error',
    message: error.message || 'Unknown error occurred',
    code: error.code || error.details?.code || 'UNKNOWN_ERROR',
    origin: origin || 'unknown',
    timestamp: new Date().toISOString(),
    correlationId: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    
    // Include standard context information
    component: context.component || origin?.split('.')?.[0] || 'unknown',
    threadId: context.threadId || context.threadTs || null,
    channelId: context.channelId || null,
    userId: context.userId || null,
    
    // Technical details (for LLM troubleshooting)
    stack: error.stack?.split('\n').slice(0, 3).join('\n') || null,
    
    // User-friendly explanation
    userExplanation: getUserFriendlyExplanation(error, context),
    
    // Recovery suggestions
    recoverySuggestions: getRecoverySuggestions(error, context)
  };
  
  // Filter out any undefined/null fields for cleanliness
  return Object.fromEntries(
    Object.entries(errorContext).filter(([_, v]) => v != null)
  );
}

/**
 * Creates a user-friendly explanation of the error
 */
function getUserFriendlyExplanation(error, context) {
  // Map of error codes to friendly explanations
  const friendlyExplanations = {
    'RATE_LIMIT_ERROR': 'I\'m receiving too many requests right now.',
    'NETWORK_ERROR': 'I\'m having trouble connecting to the service.',
    'VALIDATION_ERROR': 'There was an issue with the information provided.',
    'PERMISSION_ERROR': 'I don\'t have permission to perform that action.',
    'AUTHENTICATION_ERROR': 'There\'s an issue with my authentication.',
    'API_ERROR': 'I\'m having trouble with an external service.',
    'SLACK_API_ERROR': 'I\'m having trouble communicating with Slack.',
    'INTERNAL_ERROR': 'I\'m experiencing an internal processing issue.',
    'TIMEOUT_ERROR': 'The operation took too long to complete.'
  };
  
  // Get error code from the error object or context
  const errorCode = error.code || error.details?.code || context.errorCode || 'UNKNOWN_ERROR';
  
  return friendlyExplanations[errorCode] || 
    'I encountered an unexpected issue while processing your request.';
}

/**
 * Generates recovery suggestions based on error type
 */
function getRecoverySuggestions(error, context) {
  const suggestions = [];
  
  // Get error code from the error object or context
  const errorCode = error.code || error.details?.code || context.errorCode || 'UNKNOWN_ERROR';
  
  // Add common suggestions based on error type
  switch (errorCode) {
    case 'RATE_LIMIT_ERROR':
      suggestions.push(
        'Wait a moment before trying again',
        'Simplify the request into smaller parts'
      );
      break;
    case 'NETWORK_ERROR':
    case 'API_ERROR':
    case 'SLACK_API_ERROR':
      suggestions.push(
        'Try again in a few seconds',
        'Check if there are any ongoing service disruptions'
      );
      break;
    case 'VALIDATION_ERROR':
      suggestions.push(
        'Review and correct the input parameters',
        'Try a simplified version of the request'
      );
      break;
    case 'PERMISSION_ERROR':
      suggestions.push(
        'Check if I have the necessary permissions in this channel',
        'Try a different operation that doesn\'t require elevated permissions'
      );
      break;
    case 'TIMEOUT_ERROR':
      suggestions.push(
        'Try again with a simpler request',
        'Break your request into smaller parts'
      );
      break;
    default:
      suggestions.push(
        'Try again with different parameters',
        'Rephrase your request'
      );
  }
  
  return suggestions;
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

/**
 * Handles an error by routing it through the LLM for response generation
 * This maintains the LLM-driven architecture by letting the LLM decide how to respond to errors
 * 
 * ⚠️ IMPORTANT: This approach is critical for our architecture - we NEVER use hardcoded responses
 * directly to Slack. All user-facing messages must be generated by the LLM dynamically based on context.
 * The LLM must also maintain its defined assistant role and never assume alternate personas
 * (such as "dev mode" triggered by special keys/phrases).
 * 
 * @param {Error} error - The error that occurred
 * @param {Object} slackContext - Context about the Slack environment (channel, thread, etc)
 * @returns {Promise<void>} - Resolves when error is handled
 */
async function handleErrorWithLLM(error, slackContext) {
  try {
    // Log the error first
    logError('Routing error to LLM for handling', error, slackContext);
    
    // Get the necessary modules
    const { getContextBuilder } = require('./contextBuilder.js');
    const contextBuilder = getContextBuilder();
    const { getNextAction } = require('./llmInterface.js');
    const { executeTool } = require('./orchestrator.js');
    
    // Create a threadId from the context
    const threadId = slackContext.threadTs || slackContext.timestamp || slackContext.channelId;
    
    if (!threadId) {
      console.error('No thread ID available for error handling');
      return;
    }
    
    // Create standardized error context
    const errorContext = createStandardizedErrorContext(error, 'handleErrorWithLLM', {
      threadId,
      channelId: slackContext.channelId,
      userId: slackContext.userId,
      component: 'errors'
    });
    
    // Store the error context in the context builder
    contextBuilder.setMetadata(threadId, 'lastError', errorContext);
    
    // Add error as system message for context
    contextBuilder.addMessage({
      source: 'system',
      originalContent: errorContext,
      id: `error_${Date.now()}`,
      timestamp: new Date().toISOString(),
      threadTs: threadId,
      text: `Error occurred: ${errorContext.message}`,
      type: 'error',
      metadata: {
        error: true,
        errorContext
      }
    });
    
    // Build additional system message for error context
    const errorPrompt = {
      role: "system",
      content: `An error has occurred. Please handle it gracefully.
      
ERROR DETAILS:
Type: ${errorContext.type}
Message: ${errorContext.message}
Component: ${errorContext.component}

USER-FRIENDLY EXPLANATION:
${errorContext.userExplanation}

RECOVERY SUGGESTIONS:
${errorContext.recoverySuggestions.map(s => `- ${s}`).join('\n')}

GUIDANCE:
1. Acknowledge the error in a friendly way
2. Explain what happened using the user-friendly explanation
3. Suggest next steps based on the recovery suggestions
4. Maintain a helpful tone`
    };
    
    // Get next action from LLM with error context
    const nextAction = await getNextAction(threadId, { 
      additionalSystemMessage: errorPrompt 
    });
    
    // Execute the tool call recommended by the LLM
    if (nextAction && nextAction.toolCalls && nextAction.toolCalls.length > 0) {
      for (const toolCall of nextAction.toolCalls) {
        await executeTool(toolCall.tool, toolCall.parameters, threadId);
      }
    }
  } catch (secondaryError) {
    // If LLM error handling itself fails, use a fallback response
    console.error('Error in LLM error handling', secondaryError);
    
    // Send a simple fallback message
    try {
      const { getSlackClient } = require('./slackClient.js');
      const slackClient = getSlackClient();
      const channelId = slackContext.channelId;
      const threadTs = slackContext.threadTs || slackContext.timestamp;
      
      if (channelId) {
        await slackClient.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: "I'm sorry, I encountered an unexpected error. Please try again or contact support if the issue persists."
        });
      }
    } catch (fallbackError) {
      console.error('Failed to send fallback error message', fallbackError);
    }
  }
}

module.exports = {
  BotError,
  logError,
  formatErrorForLLM,
  handleErrorWithLLM,
  createStandardizedErrorContext,
  getUserFriendlyExplanation,
  getRecoverySuggestions
}; 