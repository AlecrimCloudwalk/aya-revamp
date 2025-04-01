/**
 * Shared utilities for Slack message formatting
 * Used by postMessage, createButtonMessage, updateMessage, and updateButtonMessage tools
 */
const { parseMessage, cleanForSlackApi, processUserMentions } = require('./blockBuilder');
const { formatSlackMessage } = require('../slackFormat.js');

/**
 * Convert named colors to proper hex values
 * @param {string} color - The color name or hex value
 * @returns {string} - A properly formatted color value
 */
function normalizeColor(color) {
  // Default to blue if no color specified
  if (!color) return '#0078D7';
  
  // If it's already a hex code with #, return as is
  if (color.startsWith('#')) return color;
  
  // If it's a hex code without #, add it
  if (color.match(/^[0-9A-Fa-f]{6}$/)) {
    return `#${color}`;
  }
  
  // Map of named colors to hex values
  const colorMap = {
    // Slack's standard colors
    'good': '#2EB67D',     // Green
    'warning': '#ECB22E',  // Yellow
    'danger': '#E01E5A',   // Red
    
    // Additional standard colors
    'blue': '#0078D7',
    'green': '#2EB67D',
    'red': '#E01E5A',
    'orange': '#F2952F', 
    'purple': '#6B46C1',
    'cyan': '#00BCD4',
    'teal': '#008080',
    'magenta': '#E91E63',
    'yellow': '#FFEB3B',
    'pink': '#FF69B4',
    'brown': '#795548',
    'black': '#000000',
    'white': '#FFFFFF',
    'gray': '#9E9E9E',
    'grey': '#9E9E9E'
  };
  
  // Return the mapped color or default to blue
  return colorMap[color.toLowerCase()] || '#0078D7';
}

/**
 * Properly unescape newlines in text content
 * This fixes the issue where newlines are showing as "\n" in messages
 * @param {string} text - The text to process
 * @returns {string} - Text with properly unescaped newlines
 */
function unescapeNewlines(text) {
  if (!text) return text;
  
  // Replace escaped newlines with actual newlines
  // This handles the double-escaped case: "\\n" → "\n" → actual newline
  return text.replace(/\\n/g, '\n');
}

/**
 * Process blocks for Slack API, including user mentions and header cleaning
 * @param {Array} blocks - Array of blocks to process
 * @returns {Array} - Processed blocks
 */
function processBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) return blocks;
  
  return blocks.map(block => {
    // Process text fields
    if (block.text && typeof block.text.text === 'string') {
      // Process user mentions and emoji
      block.text.text = processUserMentions(block.text.text);
      
      // Properly unescape newlines in all text fields
      block.text.text = unescapeNewlines(block.text.text);
      
      // Clean newlines in header blocks (after unescaping)
      if (block.type === 'header') {
        block.text.text = block.text.text.replace(/\n/g, ' ').trim();
      }
    }
    
    // Process fields in section blocks
    if (block.type === 'section' && block.fields && Array.isArray(block.fields)) {
      block.fields = block.fields.map(field => {
        if (field && typeof field.text === 'string') {
          field.text = processUserMentions(field.text);
          field.text = unescapeNewlines(field.text);
        }
        return field;
      });
    }
    
    // Process elements in context blocks
    if (block.type === 'context' && block.elements && Array.isArray(block.elements)) {
      block.elements = block.elements.map(element => {
        if (element && element.type === 'mrkdwn' && typeof element.text === 'string') {
          element.text = processUserMentions(element.text);
          element.text = unescapeNewlines(element.text);
        }
        return element;
      });
    }
    
    return block;
  });
}

/**
 * Process text with BlockBuilder or standard formatting based on content
 * @param {string} text - Message text to format
 * @returns {Promise<Object>} - Formatted message with blocks/attachments
 */
async function formatMessageText(text) {
  if (!text) {
    return { blocks: [] };
  }
  
  // Check if message has block syntax markers
  const hasBlockSyntax = text.includes('#') || text.includes('(usercontext)');
  
  if (hasBlockSyntax) {
    console.log('✅ Using BlockBuilder format for message');
    return await parseMessage(text);
  } else {
    // Use standard message formatting
    const formatted = formatSlackMessage(text);
    console.log('✅ Using standard message format');
    return formatted;
  }
}

/**
 * Clean and process an entire message for Slack API
 * @param {Object} messageParams - Message parameters to process
 * @returns {Object} - Processed message parameters
 */
function cleanAndProcessMessage(messageParams) {
  const result = { ...messageParams };
  
  // Always set text to a space to prevent duplication issues
  result.text = " ";
  
  // Clean and process blocks if they exist
  if (result.blocks) {
    result.blocks = cleanForSlackApi(result.blocks);
    result.blocks = processBlocks(result.blocks);
  }
  
  // Clean and process attachments if they exist
  if (result.attachments) {
    result.attachments = cleanForSlackApi(result.attachments);
    
    // Process blocks inside attachments
    result.attachments.forEach(attachment => {
      if (attachment.blocks) {
        attachment.blocks = processBlocks(attachment.blocks);
      }
    });
  }
  
  return result;
}

/**
 * Get a valid channel ID from args and thread state
 * @param {Object} args - Arguments object that may contain channel
 * @param {Object} threadState - Thread state with context
 * @returns {string|null} - Valid channel ID or null
 */
function getChannelId(args, threadState) {
  const context = threadState.getMetadata('context');
  
  // CRITICAL FIX: Ignore any hardcoded channel that doesn't match current context
  if (args.channel && context?.channelId && args.channel !== context.channelId) {
    // Channel mismatch - log warning and use context channel instead
    console.log(`⚠️ WARNING: Ignoring mismatched channel ID "${args.channel}" - using context channel "${context.channelId}" instead`);
    return context.channelId;
  } else {
    // Use channel from args, or fall back to context
    return args.channel || context?.channelId;
  }
}

/**
 * Get a valid thread timestamp from args and thread state
 * @param {Object} args - Arguments object that may contain threadTs
 * @param {Object} threadState - Thread state with context
 * @returns {string|undefined} - Valid thread timestamp or undefined
 */
function getThreadTs(args, threadState) {
  const context = threadState.getMetadata('context');
  
  // CRITICAL FIX: Ignore any hardcoded threadTs that doesn't match current context
  if (args.threadTs && context?.threadTs && args.threadTs !== context.threadTs) {
    // Thread timestamp mismatch - log warning and use context threadTs instead
    console.log(`⚠️ WARNING: Ignoring mismatched thread timestamp "${args.threadTs}" - using context timestamp "${context.threadTs}" instead`);
    return context.threadTs;
  } else {
    // Use threadTs from args, or fall back to context
    return args.threadTs || context?.threadTs;
  }
}

/**
 * Log a message structure for debugging
 * @param {Object} messageParams - Message parameters to log
 * @param {string} label - Label for the log message
 */
function logMessageStructure(messageParams, label = 'MESSAGE') {
  console.log(`📋 FINAL ${label} STRUCTURE:`);
  console.log(`  - Channel: ${messageParams.channel || 'Not specified'}`);
  
  if (messageParams.thread_ts) {
    console.log(`  - Thread: ${messageParams.thread_ts}`);
  }
  
  if (messageParams.ts) {
    console.log(`  - Message TS: ${messageParams.ts}`);
  }
  
  console.log(`  - Direct blocks: ${messageParams.blocks ? messageParams.blocks.length : 0}`);
  console.log(`  - Attachments: ${messageParams.attachments ? messageParams.attachments.length : 0}`);
  
  if (messageParams.attachments && messageParams.attachments.length > 0) {
    console.log(`  - Blocks in first attachment: ${
      messageParams.attachments[0].blocks ? 
      messageParams.attachments[0].blocks.length : 0
    }`);
  }
}

module.exports = {
  normalizeColor,
  processBlocks,
  formatMessageText,
  cleanAndProcessMessage,
  getChannelId,
  getThreadTs,
  logMessageStructure,
  unescapeNewlines
}; 