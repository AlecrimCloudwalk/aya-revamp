/**
 * Simple logger utility for Slack bot
 * Provides flexible logging with minimal configuration
 */

// Log levels in order of verbosity
const LOG_LEVELS = {
  QUIET: 0,   // Almost no logs
  NORMAL: 1,  // Standard operational logs
  VERBOSE: 2, // Detailed information
  DEBUG: 3    // Developer debugging
};

// Current log level from environment or default to NORMAL
const LOG_LEVEL = process.env.LOG_LEVEL ? 
  (LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] || LOG_LEVELS.NORMAL) : 
  LOG_LEVELS.NORMAL;

// Single flag to enable verbose object details
const SHOW_DETAILS = process.env.SHOW_DETAILS === 'true';

/**
 * Output colors for console
 */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

/**
 * Log error messages (always shown unless QUIET)
 * @param {string} message - Log message
 * @param {Error|Object} [error] - Optional error object
 */
function error(message, error) {
  if (LOG_LEVEL >= LOG_LEVELS.QUIET) {
    // Remove any leading newline to prevent extra spacing
    if (message.startsWith('\n')) {
      console.error(`${colors.red}[ERROR]${colors.reset} ${message.substring(1)}`);
    } else {
      console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
    }
    
    if (error && SHOW_DETAILS) {
      if (error instanceof Error) {
        console.error(`${colors.red}${error.stack || error.message}${colors.reset}`);
      } else {
        console.error(`${colors.red}${JSON.stringify(error, null, 2)}${colors.reset}`);
      }
    }
  }
}

/**
 * Log warning messages (shown in NORMAL and above)
 * @param {string} message - Log message
 */
function warn(message) {
  if (LOG_LEVEL >= LOG_LEVELS.NORMAL) {
    // Remove any leading newline to prevent extra spacing
    if (message.startsWith('\n')) {
      console.warn(`${colors.yellow}[WARN]${colors.reset} ${message.substring(1)}`);
    } else {
      console.warn(`${colors.yellow}[WARN]${colors.reset} ${message}`);
    }
  }
}

/**
 * Log info messages (shown in NORMAL and above)
 * @param {string} message - Log message
 */
function info(message) {
  if (LOG_LEVEL >= LOG_LEVELS.NORMAL) {
    // If message starts with newline, preserve it, otherwise handle formatting properly
    if (message.startsWith('\n')) {
      // Remove leading newline to prevent extra spacing
      console.log(`${colors.blue}[INFO]${colors.reset} ${message.substring(1)}`);
    } else {
      // Check if this is a section header (specific known patterns)
      const isSectionHeader = 
        message === '' || 
        message.includes('---') ||
        message.startsWith('🔄 Iteration') ||
        message.startsWith('📨 INCOMING') ||
        message.startsWith('🧠 Getting next action') ||
        message.includes('THREAD CONTEXT');
      
      // Add extra space before section headers for readability
      if (isSectionHeader) {
        console.log(); // Add empty line before section headers
      }
      
      console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
    }
  }
}

/**
 * Truncate and summarize large objects for logging
 * @param {Object} obj - Object to summarize
 * @param {number} maxDepth - Maximum depth to traverse
 * @param {number} maxLength - Maximum length for arrays/strings
 * @returns {Object} - Summarized object
 */
function summarizeObject(obj, maxDepth = 2, maxLength = 5) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // If not an object, return as is if it's not a long string
  if (typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.length > 100) {
      return obj.substring(0, 100) + '... [truncated, length: ' + obj.length + ']';
    }
    return obj;
  }
  
  // Don't go deeper than maxDepth
  if (maxDepth <= 0) {
    if (Array.isArray(obj)) {
      return `[Array with ${obj.length} items]`;
    }
    return `{Object with ${Object.keys(obj).length} keys}`;
  }
  
  // Handle arrays - truncate and summarize
  if (Array.isArray(obj)) {
    if (obj.length <= maxLength) {
      return obj.map(item => summarizeObject(item, maxDepth - 1, maxLength));
    }
    // For larger arrays, only show a few items and indicate there are more
    const truncated = obj.slice(0, maxLength).map(item => summarizeObject(item, maxDepth - 1, maxLength));
    truncated.push(`... ${obj.length - maxLength} more items`);
    return truncated;
  }
  
  // Handle objects - summarize each property
  const result = {};
  const keys = Object.keys(obj);
  
  // If there are too many keys, summarize
  if (keys.length > maxLength) {
    // Take the first few keys
    for (let i = 0; i < maxLength; i++) {
      if (i < keys.length) {
        result[keys[i]] = summarizeObject(obj[keys[i]], maxDepth - 1, maxLength);
      }
    }
    result['__summary'] = `...${keys.length - maxLength} more keys`;
  } else {
    // Process all keys if within limit
    for (const key of keys) {
      result[key] = summarizeObject(obj[key], maxDepth - 1, maxLength);
    }
  }
  
  return result;
}

/**
 * Log detailed messages (shown in VERBOSE and above)
 * @param {string} message - Log message
 * @param {Object} [data] - Optional data to log
 */
function detail(message, data) {
  if (LOG_LEVEL >= LOG_LEVELS.VERBOSE) {
    // Remove any leading newline to prevent extra spacing
    if (message.startsWith('\n')) {
      console.log(`${colors.cyan}[DETAIL]${colors.reset} ${message.substring(1)}`);
    } else {
      console.log(`${colors.cyan}[DETAIL]${colors.reset} ${message}`);
    }
    
    if (data !== undefined && SHOW_DETAILS) {
      // Check for large objects that might need summarization
      if (data && typeof data === 'object') {
        // If the stringified data would be very large, summarize it
        const jsonStr = JSON.stringify(data);
        if (jsonStr.length > 1000) {
          console.log("(Large object summarized)");
          console.log(JSON.stringify(summarizeObject(data), null, 2));
          return;
        }
      }
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Log debug messages (only shown in DEBUG level)
 * @param {string} message - Log message
 * @param {Object} [data] - Optional data to log
 */
function debug(message, data) {
  if (LOG_LEVEL >= LOG_LEVELS.DEBUG) {
    // Remove any leading newline to prevent extra spacing
    if (message.startsWith('\n')) {
      console.log(`${colors.gray}[DEBUG]${colors.reset} ${message.substring(1)}`);
    } else {
      console.log(`${colors.gray}[DEBUG]${colors.reset} ${message}`);
    }
    
    if (data !== undefined) {
      // Check for large objects that might need summarization
      if (data && typeof data === 'object') {
        // If the stringified data would be very large, summarize it
        const jsonStr = JSON.stringify(data);
        if (jsonStr.length > 1000) {
          console.log("(Large object summarized)");
          console.log(JSON.stringify(summarizeObject(data), null, 2));
          return;
        }
      }
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Log message structure in a way that respects detail level
 * @param {Object} messageParams - Message parameters
 * @param {string} label - Label for the log entry
 */
function logMessageStructure(messageParams, label = 'MESSAGE') {
  if (!messageParams) {
    info(`${label}: undefined or null`);
    return;
  }

  // Basic info (always shown at NORMAL and above)
  if (LOG_LEVEL >= LOG_LEVELS.NORMAL) {
    const blockCount = messageParams.blocks?.length || 0;
    const attachmentCount = messageParams.attachments?.length || 0;
    info(`${label}: ${blockCount} blocks, ${attachmentCount} attachments`);
  }
  
  // Detailed breakdown (shown in VERBOSE and above)
  if (LOG_LEVEL >= LOG_LEVELS.VERBOSE) {
    // Count action blocks and buttons for helpful logging
    let actionBlockCount = 0;
    let buttonCount = 0;
    
    // Check direct blocks
    if (messageParams.blocks && messageParams.blocks.length > 0) {
      const actionBlocks = messageParams.blocks.filter(b => b.type === 'actions');
      actionBlockCount += actionBlocks.length;
      
      actionBlocks.forEach(block => {
        if (block.elements) {
          buttonCount += block.elements.filter(e => e.type === 'button').length;
        }
      });
    }
    
    // Check attachment blocks
    if (messageParams.attachments && messageParams.attachments.length > 0) {
      messageParams.attachments.forEach(attachment => {
        if (attachment.blocks && attachment.blocks.length > 0) {
          const actionBlocks = attachment.blocks.filter(b => b.type === 'actions');
          actionBlockCount += actionBlocks.length;
          
          actionBlocks.forEach(block => {
            if (block.elements) {
              buttonCount += block.elements.filter(e => e.type === 'button').length;
            }
          });
        }
      });
    }
    
    // Show action block info if found
    if (actionBlockCount > 0) {
      detail(`${label} Actions: ${actionBlockCount} action blocks with ${buttonCount} buttons`);
    }
  }
  
  // Full dump of message structure (only in DEBUG mode)
  if (LOG_LEVEL >= LOG_LEVELS.DEBUG) {
    debug(`${label} FULL STRUCTURE:`, messageParams);
  }
}

/**
 * Log a button click with appropriate detail
 * @param {Object} payload - Button click payload
 */
function logButtonClick(payload) {
  if (!payload || !payload.actions || !payload.actions[0]) {
    warn('Button click: Invalid payload');
    return;
  }
  
  const action = payload.actions[0];
  
  // Basic info (NORMAL level)
  info(`Button click: "${action.value || action.action_id}"`);
  
  // More details (VERBOSE level)
  if (LOG_LEVEL >= LOG_LEVELS.VERBOSE) {
    detail(`Button details:`, {
      action_id: action.action_id,
      value: action.value,
      user: payload.user?.id,
      message_ts: payload.container?.message_ts,
      thread_ts: payload.message?.thread_ts
    });
  }
  
  // Full payload (DEBUG level)
  if (LOG_LEVEL >= LOG_LEVELS.DEBUG) {
    debug('Button click payload:', payload);
  }
}

module.exports = {
  LOG_LEVELS,
  error,
  warn,
  info,
  detail,
  debug,
  logMessageStructure,
  logButtonClick,
  summarizeObject
}; 