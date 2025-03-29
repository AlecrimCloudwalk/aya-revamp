// Posts messages to Slack
// 
// MANDATORY RULES:
// 1. The text field outside of blocks and attachments MUST ALWAYS be empty ("") to prevent duplicate text
// 2. All message content MUST be placed inside an attachments block to ensure proper vertical colored bar display
// 3. Never place content directly in blocks at the top level, always use attachments with blocks inside
//
const { formatSlackMessage } = require('../slackFormat.js');
const { logError } = require('../errors.js');
const { getSlackClient } = require('../slackClient.js');
const { parseMessage, cleanForSlackApi } = require('./blockBuilder');

/**
 * Conditionally log messages based on environment variables
 * @param {string} message - The message to log
 * @param {Object} [data] - Optional data to log
 */
function debugLog(message, data) {
  if (process.env.DEBUG === 'true' || process.env.DEBUG_SLACK === 'true') {
    if (data) {
      console.log(message, data);
    } else {
      console.log(message);
    }
  }
}

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
 * Process text to handle user mentions in the format <@USER_ID>
 * @param {string} text - The text to process
 * @returns {string} - Text with proper Slack user mentions
 */
function processUserMentions(text) {
  if (!text) return text;
  
  // The only correction we'll make is fixing doubled mentions which can occur from 
  // LLM confusion or message processing errors
  text = text.replace(/<<@([UW][A-Z0-9]{6,})>>/g, '<@$1>');
  text = text.replace(/<@<@([UW][A-Z0-9]{6,})>>/g, '<@$1>');
  
  // LLM will be responsible for properly formatting user mentions,
  // so we don't need to add <@> around user IDs - that should be done by the LLM
  
  return text;
}

/**
 * Strip markdown formatting from text for notification purposes
 * @param {string} text - Text with markdown formatting
 * @returns {string} - Plain text without markdown formatting
 */
function stripMarkdownForNotification(text) {
  if (!text) return '';
  
  // Simple regex to strip basic markdown formatting
  return text
    .replace(/\*\*?(.*?)\*\*?/g, '$1') // Remove bold formatting
    .replace(/_{1,2}(.*?)_{1,2}/g, '$1') // Remove italic formatting
    .replace(/~{1,2}(.*?)~{1,2}/g, '$1') // Remove strikethrough
    .replace(/`{1,3}([\s\S]*?)`{1,3}/g, '$1') // Remove code blocks and inline code
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Convert links to just text
    .replace(/^#+\s*(.*?)$/gm, '$1') // Remove headers
    .replace(/^\s*>\s*(.*?)$/gm, '$1') // Remove blockquotes
    .replace(/^\s*[-*+]\s+(.*?)$/gm, '$1') // Remove list markers
    .replace(/^\s*\d+\.\s+(.*?)$/gm, '$1') // Remove numbered list markers
    .replace(/\n{2,}/g, ' ') // Replace multiple newlines with single space
    .replace(/\n/g, ' ') // Replace single newlines with space
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();
}

/**
 * Process raw user IDs from text to extract valid Slack user IDs
 * @param {string} rawUserIds - Raw text containing user IDs/mentions
 * @returns {Array} - Array of validated user IDs
 */
function extractUserIds(rawUserIds) {
  if (!rawUserIds) return [];
  
  // First check if this looks like a formatted Slack user ID already
  if (rawUserIds.startsWith('U') && /^U[A-Z0-9]{6,}$/.test(rawUserIds)) {
    return [rawUserIds];
  }
  
  // Check for Slack format mentions
  const slackMentionRegex = /<@([A-Z0-9]+)>/g;
  const slackMatches = Array.from(rawUserIds.matchAll(slackMentionRegex), m => m[1]);
  if (slackMatches.length > 0) {
    return slackMatches;
  }
  
  // Split by commas if multiple users might be present
  return rawUserIds.split(',')
    .map(part => {
      let id = part.trim();
      
      // Remove @ prefix if present
      if (id.startsWith('@')) {
        id = id.substring(1);
      }
      
      // Handle Slack's special mention format
      if (id.startsWith('<@') && id.endsWith('>')) {
        id = id.substring(2, id.length - 1);
      }
      
      // Try to extract a user ID if it looks like one is embedded in the text
      const userIdMatch = id.match(/\b(U[A-Z0-9]{6,})\b/);
      if (userIdMatch) {
        return userIdMatch[1];
      }
      
      // If we can't find a user ID, try to normalize the text
      // to remove special characters and spaces, in case it's a username format
      const normalized = id.replace(/[\s\u0080-\uFFFF]/g, '');
      
      // Check if, after normalization, it looks like a user ID
      if (/^U[A-Z0-9]{6,}$/.test(normalized)) {
        return normalized;
      }
      
      // If it's not empty, pass through the normalized version as best effort
      if (normalized) {
        return normalized;
      }
      
      return ''; // Return empty if we can't extract anything useful
    })
    .filter(id => id); // Filter out empty strings
}

/**
 * Get the current Slack workspace ID
 * @returns {string} The workspace ID or a default value
 */
function getWorkspaceId() {
  try {
    // Default to T02RAEMPK if we can't determine it
    let workspaceId = 'T02RAEMPK';
    
    // Try to get the Slack client
    const slack = getSlackClient();
    
    // If we have access to team info, use that
    if (slack && slack.team && slack.team.id) {
      workspaceId = slack.team.id;
    }
    
    return workspaceId;
  } catch (error) {
    console.warn('⚠️ Could not determine workspace ID, using default:', error.message);
    return 'T02RAEMPK';
  }
}

/**
 * Ensures text is safely formatted for display in Slack
 * @param {string} text - Raw text to format
 * @returns {string} Safely formatted text
 */
function safeSlackText(text) {
  if (!text) return '';
  
  // Replace characters that might cause issues in Slack formatting
  return text
    .replace(/&/g, '&amp;')  // Ampersands -> HTML entity
    .replace(/</g, '&lt;')   // Less than -> HTML entity
    .replace(/>/g, '&gt;')   // Greater than -> HTML entity
    .replace(/"/g, '&quot;') // Double quotes -> HTML entity
    .replace(/'/g, '&#39;'); // Single quotes -> HTML entity
}

/**
 * Extract channel ID from ThreadState using various fallback approaches
 * @param {Object} threadState - The thread state object
 * @returns {string|null} - The channel ID or null if not found
 */
function extractChannelFromThreadState(threadState) {
  if (!threadState) return null;
  
  // Try multiple methods to get the channel, in order of preference
  if (typeof threadState.getChannel === 'function') {
    try {
      const channel = threadState.getChannel();
      if (channel) return channel;
    } catch (e) {
      console.log('Error getting channel from threadState.getChannel()', e.message);
    }
  }
  
  // Direct properties
  if (threadState.channel) return threadState.channel;
  if (threadState.channelId) return threadState.channelId;
  
  // Check metadata
  if (threadState.metadata && threadState.metadata.channelId) {
    return threadState.metadata.channelId;
  }
  
  // Extract from threadId (format: channelId:timestamp)
  if (threadState.threadId && threadState.threadId.includes(':')) {
    const parts = threadState.threadId.split(':');
    if (parts.length > 0) return parts[0];
  }
  
  // Check event data
  if (threadState.event && threadState.event.channel) {
    return threadState.event.channel;
  }
  
  // Check conversation context (for DMs)
  if (threadState._conversationContext && typeof threadState._conversationContext === 'string') {
    const contextMatch = threadState._conversationContext.match(/Channel:([CD][0-9A-Z]+)/);
    if (contextMatch && contextMatch[1]) return contextMatch[1];
  }
  
  // Check in first message if available
  if (threadState.messages && threadState.messages.length > 0) {
    const firstMessage = threadState.messages[0];
    if (firstMessage.channel) return firstMessage.channel;
    
    // Check for channel ID pattern in message text
    if (firstMessage.text && typeof firstMessage.text === 'string') {
      const channelMatch = firstMessage.text.match(/([CD][0-9A-Z]+)/);
      if (channelMatch) return channelMatch[1];
    }
  }
  
  // Check for direct channel pattern in threadId
  if (threadState.threadId) {
    const directChannelMatch = threadState.threadId.match(/([CD][0-9A-Z]+)/);
    if (directChannelMatch) return directChannelMatch[1];
  }
  
  return null;
}

/**
 * Extract thread timestamp from ThreadState using various fallback approaches
 * @param {Object} threadState - The thread state object
 * @returns {string|null} - The thread timestamp or null if not found
 */
function extractThreadTsFromThreadState(threadState) {
  if (!threadState) return null;
  
  // Try thread timestamp getter function
  if (typeof threadState.getThreadTs === 'function') {
    try {
      const threadTs = threadState.getThreadTs();
      if (threadTs) return threadTs;
    } catch (e) {
      console.log('Error getting thread_ts from threadState.getThreadTs()', e.message);
    }
  }
  
  // Direct threadTs property
  if (threadState.threadTs) return threadState.threadTs;
  
  // Extract from threadId (format: channelId:timestamp)
  if (threadState.threadId && threadState.threadId.includes(':')) {
    const parts = threadState.threadId.split(':');
    if (parts.length > 1) return parts[1];
  }
  
  // Check metadata
  if (threadState.metadata && threadState.metadata.threadTs) {
    return threadState.metadata.threadTs;
  }
  
  // Check direct message property
  if (threadState.message && threadState.message.ts) {
    return threadState.message.ts;
  }
  
  // Check first message if available
  if (threadState.messages && threadState.messages.length > 0) {
    const firstMessage = threadState.messages[0];
    if (firstMessage.threadTs) return firstMessage.threadTs;
    if (firstMessage.ts) return firstMessage.ts;
  }
  
  return null;
}

/**
 * Posts a message to Slack
 * @param {Object} args - The arguments for the message
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of the post operation
 */
async function postMessage(args, threadState) {
  try {
    // Log the tool call
    console.log('📣 postMessage tool called with args:', JSON.stringify(args, null, 2));
    
    // Handle potential nested parameters structure 
    if (args.parameters && !args.text) {
      console.log('Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Format the message using the BlockBuilder if text has block syntax
    let formattedMessage;
    
    // Check if message has block syntax markers
    const hasBlockSyntax = args.text && (args.text.includes('#') || args.text.includes('(usercontext)'));
    
    if (hasBlockSyntax) {
      console.log('✅ Using BlockBuilder format for message');
      formattedMessage = await parseMessage(args.text);
    } else {
      // Use standard message formatting
      formattedMessage = formatSlackMessage(args.text);
      console.log('✅ Using standard message format');
    }
    
    // Get required context info
    const context = threadState.getMetadata('context');
    const { channelId, threadTs } = context || {};
    
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    // Prepare the message parameters
    const messageParams = {
      channel: channelId,
      thread_ts: threadTs, // Will be ignored if no thread_ts exists
      ...formattedMessage // Spread in the blocks and attachments
    };
    
    // Add text fallback to prevent Slack API errors
    // Slack requires either a text field or attachment fallbacks
    if (!messageParams.text) {
      // Check if the message contains userContext syntax
      if (args.text && (args.text.includes('(usercontext)') || 
          (args.text.includes('#userContext:') || args.text.includes('#usercontext:')))) {
        // For userContext, just use a space to avoid duplicating the content visibly
        messageParams.text = " ";
      } else {
        messageParams.text = stripMarkdownForNotification(args.text || '');
      }
    }
    
    // Ensure all message blocks are clean without _metadata properties
    // This step is critical to prevent Slack API from rejecting the message
    if (messageParams.blocks) {
      messageParams.blocks = cleanForSlackApi(messageParams.blocks);
      
      // Validate each block has a type field
      messageParams.blocks.forEach((block, index) => {
        if (!block.type) {
          console.error(`⚠️ Block at index ${index} missing type field:`, JSON.stringify(block));
          // Set a default type to prevent API errors
          block.type = 'section';
          if (!block.text) {
            block.text = { type: 'mrkdwn', text: 'Error: Invalid block' };
          }
        }
      });
    }
    
    if (messageParams.attachments) {
      messageParams.attachments = cleanForSlackApi(messageParams.attachments);
      
      // Validate each attachment has properly formed blocks
      messageParams.attachments.forEach((attachment, attachIndex) => {
        if (attachment.blocks) {
          attachment.blocks.forEach((block, blockIndex) => {
            if (!block.type) {
              console.error(`⚠️ Block at attachment ${attachIndex}, block ${blockIndex} missing type field:`, JSON.stringify(block));
              // Set a default type to prevent API errors
              block.type = 'section';
              if (!block.text) {
                block.text = { type: 'mrkdwn', text: 'Error: Invalid block' };
              }
            }
          });
        }
      });
    }
    
    // Log the final message structure
    console.log('📋 FINAL MESSAGE STRUCTURE:');
    console.log(`  - Channel: ${messageParams.channel}`);
    console.log(`  - Thread: ${messageParams.thread_ts || 'New thread'}`);
    console.log(`  - Direct blocks: ${messageParams.blocks ? messageParams.blocks.length : 0}`);
    console.log(`  - Attachments: ${messageParams.attachments ? messageParams.attachments.length : 0}`);
    
    // Post the message
    const slack = getSlackClient();
    
    console.log('📋 POSTING MESSAGE WITH STRUCTURE:');
    console.log(JSON.stringify(messageParams, null, 2));
    
    const result = await slack.chat.postMessage(messageParams);
    
    // Debug log the full message result structure
    console.log('📄 FULL MESSAGE RESULT STRUCTURE FROM SLACK:');
    console.log(JSON.stringify(result, null, 2));
    
    // Add the message to thread history for future reference
    try {
      if (threadState && typeof threadState.addToHistory === 'function') {
        threadState.addToHistory('message', result);
        console.log('Added postMessage result to thread history for future context');
      } else {
        console.log('Unable to add to thread history: threadState.addToHistory not available');
      }
    } catch (historyError) {
      console.error('Error adding message to thread history:', historyError);
    }
    
    return result;
  } catch (error) {
    console.error('Error in postMessage tool:', error);
    
    // Additional debug info for API errors
    if (error.code === 'slack_webapi_platform_error') {
      console.error('Slack API Error Details:');
      console.error(JSON.stringify(error.data, null, 2));
      
      // Log the actual message that failed
      console.error('Failed message structure:');
      console.error(JSON.stringify(messageParams, null, 2));
    }
    
    const errorResponse = {
      error: true,
      message: error.message,
      details: error.stack
    };
    
    // Safely add error to history if possible
    try {
      if (threadState && typeof threadState.addToHistory === 'function') {
        threadState.addToHistory('error', errorResponse);
      } else {
        console.log('Unable to add error to thread history: threadState.addToHistory not available');
      }
    } catch (historyError) {
      console.error('Error adding error to thread history:', historyError);
    }
    
    return errorResponse;
  }
}

/**
 * Get a user's profile picture URL from Slack API
 * @param {string} userId - The Slack user ID 
 * @returns {Promise<string>} - The profile picture URL
 */
async function getUserProfilePicture(userId) {
  try {
    // Get Slack client
    const slack = getSlackClient();
    
    // Call users.info API to get user profile
    const result = await slack.users.info({ user: userId });
    
    if (result.ok && result.user && result.user.profile) {
      // Get the image_48 field from profile or fall back to image_24
      const imageUrl = result.user.profile.image_48 || result.user.profile.image_24;
      return imageUrl;
    } else {
      // Return default URL format 
      const workspaceId = getWorkspaceId();
      return `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-48`;
    }
  } catch (error) {
    // Return default URL format
    const workspaceId = getWorkspaceId();
    return `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-48`;
  }
}

// Export the postMessage function
module.exports = {
  postMessage,
  getUserProfilePicture,
  processUserMentions,
  normalizeColor
};
