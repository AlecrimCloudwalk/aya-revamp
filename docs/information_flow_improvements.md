# Information Flow Improvements

This document outlines focused, practical improvements to enhance the information flow in our LLM-driven Slack bot architecture while maintaining the core principle that **the LLM remains the central decision-maker**.

## 1. Tool Result Deduplication Logic

**Goal**: Simplify tool call deduplication for better efficiency

- [ ] **1.1 Implement tool call hashing mechanism**
  - [ ] Create a `hashToolCall()` function in contextBuilder.js
  - [ ] Ensure hash stability for identical tool calls
  - [ ] Handle nested objects and arrays properly

```javascript
// Implementation in contextBuilder.js

const crypto = require('crypto');

/**
 * Creates a stable hash for a tool call including name and arguments
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments
 * @returns {string} - Hash string representing the tool call
 */
function hashToolCall(toolName, args) {
  // Create a normalized copy of args with keys sorted
  const normalizedArgs = normalizeObject(args || {});
  
  // Create a string representation
  const stringRepresentation = JSON.stringify({
    tool: toolName,
    args: normalizedArgs
  });
  
  // Create a hash
  return crypto.createHash('md5').update(stringRepresentation).digest('hex');
}

/**
 * Recursively normalizes an object for stable hashing
 * - Sorts keys alphabetically
 * - Handles nested objects and arrays
 * - Removes undefined values
 * @param {*} obj - Object to normalize
 * @returns {*} - Normalized object
 */
function normalizeObject(obj) {
  // Handle primitives and null
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(normalizeObject);
  }
  
  // Handle objects
  const normalized = {};
  const sortedKeys = Object.keys(obj).sort();
  
  for (const key of sortedKeys) {
    // Skip undefined values
    if (obj[key] !== undefined) {
      normalized[key] = normalizeObject(obj[key]);
    }
  }
  
  return normalized;
}
```

- [ ] **1.2 Update deduplication logic**
  - [ ] Modify `hasExecuted()` to use the hash-based approach
  - [ ] Update `getToolResult()` to use the new hash lookup
  - [ ] Benchmark performance improvement

```javascript
// Update in existing ContextBuilder class in contextBuilder.js

// Add to constructor
this.toolExecutionCache = new Map(); // Maps threadId -> {hashToExecution, executions}

/**
 * Records a tool execution with hash-based caching
 */
recordToolExecution(threadId, toolName, args, result, error = null, skipped = false) {
  // Get or initialize tool execution cache for thread
  if (!this.toolExecutionCache.has(threadId)) {
    this.toolExecutionCache.set(threadId, {
      hashToExecution: new Map(),
      executions: []
    });
  }
  
  const cache = this.toolExecutionCache.get(threadId);
  
  // Create hash for the tool call
  const hash = hashToolCall(toolName, args);
  
  // Create execution record
  const execution = {
    toolName,
    args,
    result,
    error,
    skipped,
    timestamp: new Date().toISOString(),
    hash
  };
  
  // Add to cache by hash
  cache.hashToExecution.set(hash, execution);
  
  // Add to chronological list
  cache.executions.push(execution);
  
  // Continue with existing implementation (for backward compatibility)
  // ...
}

/**
 * Checks if a tool has already been executed with given arguments
 */
hasExecuted(threadId, toolName, args = {}) {
  // Get cache
  const cache = this.toolExecutionCache.get(threadId);
  if (!cache) return false;
  
  // Create hash for lookup
  const hash = hashToolCall(toolName, args);
  
  // Check cache
  return cache.hashToExecution.has(hash);
}

/**
 * Gets the result of a previous tool execution
 */
getToolResult(threadId, toolName, args = {}) {
  // Get cache
  const cache = this.toolExecutionCache.get(threadId);
  if (!cache) return null;
  
  // Create hash for lookup
  const hash = hashToolCall(toolName, args);
  
  // Check cache
  const execution = cache.hashToExecution.get(hash);
  return execution ? execution.result : null;
}
```

- [ ] **1.3 Add basic cache optimization**
  - [ ] Implement simple time-based expiration for tool call hashes
  - [ ] Add cache size limits to prevent memory growth

```javascript
// Add to contextBuilder.js

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
  MAX_EXECUTIONS_PER_THREAD: 100,
  MAX_AGE_MS: 30 * 60 * 1000, // 30 minutes
  TOOLS_WITHOUT_EXPIRY: ['getThreadHistory', 'postMessage']
};

/**
 * Prunes tool execution cache for a thread
 */
pruneToolExecutionCache(threadId) {
  const cache = this.toolExecutionCache.get(threadId);
  if (!cache) return;
  
  const now = Date.now();
  const cutoffTime = new Date(now - CACHE_CONFIG.MAX_AGE_MS).toISOString();
  
  // Filter executions by age and special tools
  const validExecutions = cache.executions.filter(execution => {
    // Never expire certain tools
    if (CACHE_CONFIG.TOOLS_WITHOUT_EXPIRY.includes(execution.toolName)) {
      return true;
    }
    
    return execution.timestamp >= cutoffTime;
  });
  
  // Limit to max size
  const finalExecutions = validExecutions.slice(
    Math.max(0, validExecutions.length - CACHE_CONFIG.MAX_EXECUTIONS_PER_THREAD)
  );
  
  // Rebuild hash map
  const newHashMap = new Map();
  for (const execution of finalExecutions) {
    newHashMap.set(execution.hash, execution);
  }
  
  // Update cache
  cache.executions = finalExecutions;
  cache.hashToExecution = newHashMap;
}
```

- [ ] **1.4 Test and validate**
  - [ ] Verify identical tool calls are properly detected
  - [ ] Ensure edge cases with complex arguments work correctly
  - [ ] Measure performance difference vs. the old implementation

## 2. Error Handling Information Flow

**Goal**: Centralize and standardize error handling for better LLM feedback

- [ ] **2.1 Create standardized error context builder**
  - [ ] Implement `createStandardizedErrorContext()` in errors.js
  - [ ] Define consistent error object structure
  - [ ] Include context information relevant to the LLM

```javascript
// Implementation in errors.js

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
    code: error.code || 'UNKNOWN_ERROR',
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
    'AUTHENTICATION_ERROR': 'There\'s an issue with my authentication.'
  };
  
  return friendlyExplanations[error.code] || 
    'I encountered an unexpected issue while processing your request.';
}

/**
 * Generates recovery suggestions based on error type
 */
function getRecoverySuggestions(error, context) {
  const suggestions = [];
  
  // Add common suggestions based on error type
  switch (error.code) {
    case 'RATE_LIMIT_ERROR':
      suggestions.push(
        'Wait a moment before trying again',
        'Simplify the request into smaller parts'
      );
      break;
    case 'NETWORK_ERROR':
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
    default:
      suggestions.push('Try again with different parameters');
  }
  
  return suggestions;
}
```

- [ ] **2.2 Update error handlers to use standardized context**
  - [ ] Modify orchestrator.js error handling
  - [ ] Update tool error handling

```javascript
// Update in orchestrator.js

/**
 * Handles an error during thread processing
 */
async function handleProcessingError(error, threadId, context = {}) {
  // Log error
  logError('Error processing thread', error, { threadId, ...context });
  
  // Create standardized error context
  const errorContext = createStandardizedErrorContext(error, 'orchestrator.processThread', {
    threadId,
    channelId: context.channelId,
    userId: context.userId,
    component: 'orchestrator'
  });
  
  // Get context builder
  const contextBuilder = getContextBuilder();
  
  // Add error to thread context
  contextBuilder.setMetadata(threadId, 'lastError', errorContext);
  
  // Add system message about error
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
  
  // Let the LLM handle the error
  return await handleErrorWithLLM(errorContext, threadId);
}

// Update the catch block in processThread
try {
  // Existing processing code
} catch (error) {
  await handleProcessingError(error, threadId, threadContext);
}
```

- [ ] **2.3 Let the LLM handle errors gracefully**
  - [ ] Provide better context to the LLM about the error
  - [ ] Let the LLM decide how to respond to the user

```javascript
// Update handleErrorWithLLM in errors.js

/**
 * Handles an error by asking the LLM for the appropriate response
 */
async function handleErrorWithLLM(errorContext, threadId) {
  try {
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
    logError('Error in LLM error handling', secondaryError, { originalError: errorContext });
    
    // Send a simple fallback message
    try {
      const slackClient = getSlackClient();
      const channelId = contextBuilder.getChannel(threadId);
      
      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadId,
        text: "I'm sorry, I encountered an unexpected error. Please try again or contact support if the issue persists."
      });
    } catch (fallbackError) {
      logError('Failed to send fallback error message', fallbackError);
    }
  }
}
```

- [ ] **2.4 Test and validate**
  - [ ] Verify errors are presented consistently to the LLM
  - [ ] Test error recovery paths
  - [ ] Check log output for improved diagnostics

## 3. Thread History Memory Management

**Goal**: Implement basic memory management for long threads

- [ ] **3.1 Implement thread message pruning**
  - [ ] Add simple pruning to contextBuilder.js
  - [ ] Keep the most important messages when threads get too long

```javascript
// Add to contextBuilder.js

/**
 * Thread pruning configuration
 */
const THREAD_PRUNING = {
  MAX_MESSAGES: 75,        // Maximum messages before pruning
  TARGET_MESSAGES: 50,     // Target number to keep
  MIN_MESSAGES_TO_KEEP: 10, // Minimum to always keep
  ALWAYS_KEEP_TYPES: ['error', 'button_click'],
  ALWAYS_KEEP_FIRST_MESSAGE: true // Always keep thread parent
};

/**
 * Prunes thread history when it gets too long
 * @param {string} threadTs - Thread timestamp
 * @returns {number} - Number of messages removed
 */
function pruneThreadHistory(threadTs) {
  // Get messages for the thread
  const messages = this.getThreadMessages(threadTs);
  if (!messages || messages.length <= THREAD_PRUNING.MIN_MESSAGES_TO_KEEP) {
    return 0; // Nothing to prune
  }
  
  // Only prune if we're over the limit
  if (messages.length <= THREAD_PRUNING.MAX_MESSAGES) {
    return 0;
  }
  
  // Determine which messages to keep
  const messagesToKeep = [];
  
  // Always keep the first message (thread parent)
  if (THREAD_PRUNING.ALWAYS_KEEP_FIRST_MESSAGE && messages.length > 0) {
    messagesToKeep.push(messages[0]);
  }
  
  // First pass - keep critical message types
  for (const msgId of messages) {
    const msg = this.messages.get(msgId);
    if (!msg) continue;
    
    if (THREAD_PRUNING.ALWAYS_KEEP_TYPES.includes(msg.type)) {
      messagesToKeep.push(msgId);
    }
  }
  
  // Second pass - keep most recent messages to reach target
  const remainingToKeep = THREAD_PRUNING.TARGET_MESSAGES - messagesToKeep.length;
  if (remainingToKeep > 0) {
    // Create a set of already kept messages for quick lookup
    const keptSet = new Set(messagesToKeep);
    
    // Add the most recent messages not already kept
    const recentMessages = messages
      .slice(-remainingToKeep)
      .filter(msgId => !keptSet.has(msgId));
    
    messagesToKeep.push(...recentMessages);
  }
  
  // Create a set for efficient lookup
  const keepSet = new Set(messagesToKeep);
  
  // Create new thread messages list
  const newThreadMessages = messages.filter(msgId => keepSet.has(msgId));
  
  // Calculate how many we removed
  const removedCount = messages.length - newThreadMessages.length;
  
  // Update thread messages
  if (removedCount > 0) {
    this.threadMessages.set(threadTs, newThreadMessages);
    
    // Add a system message about pruning
    this.addMessage({
      source: 'system',
      originalContent: { pruned: removedCount },
      id: `prune_${Date.now()}`,
      timestamp: new Date().toISOString(),
      threadTs,
      text: `${removedCount} older messages have been summarized to optimize context.`,
      type: 'system_note',
      metadata: { isPruneNotice: true }
    });
    
    logger.info(`Pruned ${removedCount} messages from thread ${threadTs}`);
  }
  
  return removedCount;
}

/**
 * Update buildFormattedLLMContext to include pruning logic
 */
buildFormattedLLMContext(threadTs, options = {}) {
  // Check if we should prune first
  const messageCount = this.getThreadMessages(threadTs)?.length || 0;
  
  if (messageCount > THREAD_PRUNING.MAX_MESSAGES) {
    this.pruneThreadHistory(threadTs);
  }
  
  // Continue with existing implementation...
}
```

- [ ] **3.2 Test and validate**
  - [ ] Verify memory usage stabilizes for long-running threads
  - [ ] Check LLM context quality after pruning
  - [ ] Test with simulated high-volume threads

## 4. LLM Context Size Management

**Goal**: Implement simple context optimization for token limits

- [ ] **4.1 Implement basic token estimation**
  - [ ] Add simple token counting in llmInterface.js
  - [ ] Track approximate token usage

```javascript
// Add to llmInterface.js

// Simple GPT token estimator
const GPT_TOKENS_PER_CHAR = 0.25; // Rough estimate for English text

/**
 * Estimates token count for a text
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(text.length * GPT_TOKENS_PER_CHAR);
}

/**
 * Token budget constants
 */
const TOKEN_BUDGET = {
  MAX_TOTAL: 4000,  // Target max tokens
  MIN_USER_MESSAGES: 800  // Ensure some space for user messages
};
```

- [ ] **4.2 Implement simple context truncation**
  - [ ] Add logic to truncate context when it gets too large
  - [ ] Prioritize recent messages and important information

```javascript
// Add to llmInterface.js

/**
 * Ensures context stays within token limits
 */
function ensureContextWithinLimits(context) {
  // Clone the context
  const result = JSON.parse(JSON.stringify(context));
  
  // Get total token estimate
  const totalTokens = estimateTokenCount(JSON.stringify(result));
  
  // If we're within limits, just return the context as is
  if (totalTokens <= TOKEN_BUDGET.MAX_TOTAL) {
    return result;
  }
  
  logger.info(`Context size (${totalTokens} tokens) exceeds target (${TOKEN_BUDGET.MAX_TOTAL}). Optimizing...`);
  
  // If we have messages, keep only the most recent ones
  if (result.messages && result.messages.length > 0) {
    // Always keep the first message (system message) 
    const systemMessages = result.messages.filter(m => m.role === 'system');
    
    // Sort user and assistant messages by recency
    const otherMessages = result.messages
      .filter(m => m.role !== 'system')
      .sort((a, b) => {
        // Try to extract timestamps if available
        const timeA = a.timestamp || a.ts || 0;
        const timeB = b.timestamp || b.ts || 0;
        return timeB - timeA; // Sort descending (newest first)
      });
    
    // Keep reducing context until we're under the limit
    while (estimateTokenCount(JSON.stringify(result)) > TOKEN_BUDGET.MAX_TOTAL && otherMessages.length > 0) {
      // Remove the oldest non-system message
      otherMessages.pop();
      
      // Rebuild the messages array
      result.messages = [...systemMessages, ...otherMessages];
    }
    
    // Add a note about truncation
    if (otherMessages.length < context.messages.length - systemMessages.length) {
      result.messages.push({
        role: 'system',
        content: `Note: Some older messages were omitted due to context length limits.`
      });
    }
  }
  
  // Final size after optimization
  const finalTokens = estimateTokenCount(JSON.stringify(result));
  logger.info(`Context optimized to ${finalTokens} tokens`);
  
  return result;
}

// Update the call to the LLM
async function getNextAction(threadId, options = {}) {
  // Build the context
  const context = buildPrompt(threadId);
  
  // Ensure context is within token limits
  const optimizedContext = ensureContextWithinLimits(context);
  
  // Continue with using optimizedContext instead of context
  // ...
}
```

- [ ] **4.3 Test and validate**
  - [ ] Verify token usage stays within reasonable limits
  - [ ] Check LLM response quality with truncated context
  - [ ] Test with various conversation types and lengths

## 5. Redundant Context Collection and Processing

**Goal**: Organize context pipeline without restricting LLM access to information

- [ ] **5.1 Create context structure documentation**
  - [ ] Document all context fields and their purposes
  - [ ] Define expected data types and formats
  - [ ] Create reference documentation for developers

```javascript
// Add to contextBuilder.js or create a separate docs file

/**
 * Standard Context Structure
 * 
 * This documents the standard context structure used throughout the application.
 * It serves as a reference, not a constraint - fields can be added as needed.
 * 
 * @typedef {Object} ThreadContext
 * @property {string} threadId - Thread ID/timestamp
 * @property {string} [channelId] - Channel ID
 * @property {string} [userId] - User ID who initiated the request
 * @property {Object} [user] - User information
 * @property {string} user.id - User ID
 * @property {string} user.name - User name
 * @property {boolean} [isDirectMessage] - Whether this is a direct message
 * @property {Object} [channel] - Channel information
 * @property {Object[]} [messages] - Formatted messages in the thread
 * @property {Object} [metadata] - Additional metadata about the thread
 * @property {Object} [toolExecutions] - Record of tool executions
 */

/**
 * Message Structure
 * 
 * @typedef {Object} Message
 * @property {string} id - Message ID
 * @property {string} source - Source of the message (user, assistant, system, tool)
 * @property {string} text - Message text content
 * @property {string} timestamp - ISO timestamp
 * @property {string} threadTs - Thread timestamp
 * @property {Object} [originalContent] - Original message content from Slack
 * @property {Object} [metadata] - Additional metadata about the message
 */
```

- [ ] **5.2 Add context validation helpers**
  - [ ] Create optional validation for context objects
  - [ ] Log warnings about missing critical fields
  - [ ] Keep validation separate from processing to avoid restricting information

```javascript
// Add to contextBuilder.js

/**
 * Validates a context object and logs warnings for missing fields
 * Note: This is for debugging purposes and does NOT restrict fields
 * @param {Object} context - Context object to validate
 * @param {string} location - Where validation is occurring 
 * @returns {Object} - Same context object (never modified)
 */
function validateContext(context, location = 'unknown') {
  // Critical fields that should always be present
  const criticalFields = ['threadId'];
  
  // Recommended fields
  const recommendedFields = ['channelId', 'userId'];
  
  // Check critical fields
  for (const field of criticalFields) {
    if (!context[field]) {
      logger.warn(`Missing critical field '${field}' in context at ${location}`);
    }
  }
  
  // Check recommended fields
  for (const field of recommendedFields) {
    if (!context[field]) {
      logger.debug(`Missing recommended field '${field}' in context at ${location}`);
    }
  }
  
  // Return the unchanged context
  return context;
}
```

- [ ] **5.3 Create context enhancement utilities**
  - [ ] Add utilities to enrich context without duplicating logic
  - [ ] Keep these as passive enhancements that don't restrict information

```javascript
// Add to contextBuilder.js

/**
 * Enhances a context object with thread information if missing
 * @param {Object} context - Context object to enhance
 * @returns {Object} - Enhanced context (or original if already complete)
 */
function enhanceWithThreadInfo(context) {
  // Create a shallow copy to avoid direct modification
  const enhancedContext = { ...context };
  
  // If we have a threadId but no thread messages, add them
  if (enhancedContext.threadId && !enhancedContext.messages) {
    const threadMessages = this.getFormattedThreadMessages(enhancedContext.threadId);
    if (threadMessages && threadMessages.length > 0) {
      enhancedContext.messages = threadMessages;
    }
  }
  
  // If we have a threadId but no channel, try to find it
  if (enhancedContext.threadId && !enhancedContext.channelId) {
    const channelId = this.getChannel(enhancedContext.threadId);
    if (channelId) {
      enhancedContext.channelId = channelId;
    }
  }
  
  return enhancedContext;
}

/**
 * Enhances a context object with user information if missing
 * @param {Object} context - Context object to enhance
 * @returns {Promise<Object>} - Enhanced context with user information
 */
async function enhanceWithUserInfo(context) {
  // Create a shallow copy to avoid direct modification
  const enhancedContext = { ...context };
  
  // If we have userId but no user object, fetch user info
  if (enhancedContext.userId && !enhancedContext.user) {
    try {
      const userInfo = await getUserInfo(enhancedContext.userId);
      if (userInfo) {
        enhancedContext.user = userInfo;
      }
    } catch (error) {
      // Log but don't fail if user info can't be retrieved
      logger.warn(`Could not fetch user info for ${enhancedContext.userId}`, error);
    }
  }
  
  return enhancedContext;
}
```

- [ ] **5.4 Document common context collection points**
  - [ ] Identify all places where context is collected
  - [ ] Document the expected fields at each point
  - [ ] Create clear guidelines for adding new context collection points

- [ ] **5.5 Test and validate**
  - [ ] Verify context continues to be collected properly
  - [ ] Check that no information is restricted from the LLM
  - [ ] Validate that enhancement utilities work correctly

## 6. Tool Registration Verbosity

**Goal**: Streamline tool registration while maintaining transparency

- [ ] **6.1 Create simplified tool registration helpers**
  - [ ] Add utility functions to reduce boilerplate
  - [ ] Keep all metadata explicit and transparent
  - [ ] Support JSDoc extraction for parameter descriptions

```javascript
// Add to tools/index.js

/**
 * Creates a tool schema from a function and metadata
 * @param {Function} fn - The tool function
 * @param {Object} metadata - Tool metadata
 * @returns {Object} - Tool schema
 */
function createToolSchema(fn, metadata) {
  // Get function parameter names through reflection
  const fnStr = fn.toString();
  const paramMatch = fnStr.match(/\(([^)]*)\)/);
  const paramNames = paramMatch && paramMatch[1] ?
    paramMatch[1].split(',').map(p => p.trim()).filter(Boolean) :
    [];
  
  // Extract JSDoc if available
  const jsDocComment = extractJSDocComment(fnStr);
  const jsDocParams = parseJSDocParams(jsDocComment);
  
  // Create parameters schema
  const parametersSchema = {
    type: 'object',
    properties: {},
    required: []
  };
  
  // Process each parameter
  for (const paramName of paramNames) {
    // Skip the threadState/context parameter (usually last parameter)
    if (['threadState', 'context', 'threadContext'].includes(paramName)) {
      continue;
    }
    
    // Add to required parameters if not explicitly optional
    if (!paramName.startsWith('_') && !jsDocParams[paramName]?.optional) {
      parametersSchema.required.push(paramName);
    }
    
    // Add parameter to properties with documentation if available
    parametersSchema.properties[paramName] = {
      type: jsDocParams[paramName]?.type || 'string',
      description: jsDocParams[paramName]?.description || `Parameter ${paramName}`
    };
  }
  
  // Build final schema
  return {
    name: metadata.name || fn.name,
    description: metadata.description || extractJSDocDescription(jsDocComment) || `Tool ${fn.name}`,
    parameters: parametersSchema
  };
}

/**
 * Extracts JSDoc comment from function string
 * @param {string} fnStr - Function as string
 * @returns {string|null} - JSDoc comment or null
 */
function extractJSDocComment(fnStr) {
  const jsDocMatch = fnStr.match(/\/\*\*([\s\S]*?)\*\//);
  return jsDocMatch ? jsDocMatch[1] : null;
}

/**
 * Extracts description from JSDoc comment
 * @param {string} jsDocComment - JSDoc comment
 * @returns {string|null} - Description or null
 */
function extractJSDocDescription(jsDocComment) {
  if (!jsDocComment) return null;
  
  // Get first paragraph before any @tags
  const descMatch = jsDocComment.match(/^\s*\*\s*([^@]*?)(?:\s*\*\s*@|$)/);
  if (descMatch && descMatch[1]) {
    return descMatch[1].replace(/\s*\*\s*/g, ' ').trim();
  }
  
  return null;
}

/**
 * Parses JSDoc @param tags
 * @param {string} jsDocComment - JSDoc comment
 * @returns {Object} - Map of parameter info
 */
function parseJSDocParams(jsDocComment) {
  if (!jsDocComment) return {};
  
  const result = {};
  const paramMatches = jsDocComment.matchAll(/\*\s*@param\s+(?:{([^}]*)})?\s*(?:\[([^\]]*)\]|(\S+))\s*-?\s*(.*?)(?=\*\s*@|\*\/|$)/g);
  
  for (const match of paramMatches) {
    const type = match[1] || 'string';
    const paramName = match[3] || match[2]?.replace(/[\[\]]/g, '');
    const description = match[4]?.trim();
    const optional = !!match[2]; // Parameter was in brackets
    
    if (paramName) {
      result[paramName] = { type, description, optional };
    }
  }
  
  return result;
}

/**
 * Registers a tool with optional metadata enhancement
 * @param {Function} fn - Tool function to register
 * @param {Object} metadata - Additional metadata
 * @returns {Object} - Registered tool info
 */
function registerTool(fn, metadata = {}) {
  // Create tool schema
  const schema = createToolSchema(fn, metadata);
  
  // Override with explicit metadata where provided
  if (metadata.parameters) {
    schema.parameters = metadata.parameters;
  }
  
  if (metadata.description) {
    schema.description = metadata.description;
  }
  
  // Register the tool as before
  tools[schema.name] = fn;
  toolSchemas[schema.name] = schema;
  
  // Return the registered info
  return {
    name: schema.name,
    schema
  };
}
```

- [ ] **6.2 Update example tool registrations**
  - [ ] Convert a few tools to use the new registration
  - [ ] Validate schemas match previous explicit definitions
  - [ ] Document the process for other developers

```javascript
// Example usage in a tool file

/**
 * Posts a message to Slack
 * @param {string} channelId - Channel to post to
 * @param {string} text - Message text
 * @param {boolean} [isResponse=false] - Whether this is a direct response
 * @param {Object} threadState - Thread state (automatically provided)
 * @returns {Promise<Object>} - Slack API response
 */
async function postMessage(channelId, text, isResponse = false, threadState) {
  // Implementation...
}

// Export the tool with registration
module.exports = registerTool(postMessage, {
  name: 'postMessage',
  description: 'Posts a formatted message to Slack'
});
```

- [ ] **6.3 Update tools documentation**
  - [ ] Generate tool documentation from tool schemas
  - [ ] Include parameter information automatically
  - [ ] Keep documentation in sync with implementations

- [ ] **6.4 Test and validate**
  - [ ] Verify tool operation with new registration
  - [ ] Check schema compatibility with OpenAI format
  - [ ] Validate no loss of information for the LLM

## Implementation Priority Matrix

| Improvement Area | Effort | Impact | Priority |
|------------------|--------|--------|----------|
| Error Handling Information Flow | Medium | High | 1 |
| Tool Result Deduplication | Low | Medium | 2 |
| Thread History Memory Management | Medium | Medium | 3 |
| LLM Context Size Management | Medium | Medium | 4 |
| Redundant Context Collection | Low | Medium | 5 |
| Tool Registration Verbosity | Low | Low | 6 |

## Implementation Approach

1. **Start with highest priority items**:
   - Implement error handling improvements first for immediate impact
   - Add tool result deduplication for better efficiency

2. **Then address memory management**:
   - Implement thread history pruning
   - Add basic context size management

3. **Finally improve developer experience**:
   - Organize context collection
   - Simplify tool registration

4. **Implement incrementally**:
   - Roll out changes in small, testable batches
   - Measure performance and memory before/after each change

## Testing Methodologies

For each improvement area, implement the following testing methodologies:

1. **Unit Tests**:
   - Test individual functions in isolation
   - Verify edge cases and failure modes

2. **Integration Tests**:
   - Test interaction between components
   - Verify information flows correctly end-to-end

3. **Performance Tests**:
   - Measure memory consumption before/after
   - Compare processing time for key operations

## Development Guidelines

1. **Maintain LLM-First Principles**:
   - All improvements must respect the LLM-driven architecture
   - The LLM must remain the central decision-maker
   - No hard-coded routing or pattern matching

2. **Code Organization**:
   - Enhance existing files rather than creating new ones
   - Follow established naming conventions

3. **Documentation**:
   - Update JSDoc comments for all new/modified functions
   - Update function_index.md with new functions

**Start Date**: [To be filled in]
**Target Completion**: [To be filled in]
**Owner**: [To be filled in] 