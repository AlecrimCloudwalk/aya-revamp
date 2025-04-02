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
const { parseMessage, cleanForSlackApi } = require('../toolUtils/blockBuilder');
const { 
  normalizeColor, 
  formatMessageText, 
  cleanAndProcessMessage, 
  getChannelId, 
  getThreadTs, 
  logMessageStructure,
  processBlocks 
} = require('../toolUtils/messageFormatUtils');
const { getContextBuilder } = require('../contextBuilder.js');

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

/**
 * Posts a message to Slack
 * @param {Object} args - The arguments for the message
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of the post operation
 */
async function postMessage(args, threadState) {
  let messageParams;
  
  try {
    // Log the tool call
    console.log('📣 postMessage tool called with args:', JSON.stringify(args, null, 2));
    
    // Handle potential nested parameters structure 
    if (args.parameters && !args.text) {
      console.log('Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Check if the text appears to be a JSON string representing a tool call
    if (args.text && typeof args.text === 'string') {
      const trimmedText = args.text.trim();
      
      // Check if it looks like a JSON object that might be a tool call
      if ((trimmedText.startsWith('{') && trimmedText.endsWith('}')) &&
          (trimmedText.includes('"tool"') || trimmedText.includes('"parameters"'))) {
        
        try {
          // Try to parse as JSON
          const parsedText = JSON.parse(trimmedText);
          
          // Check if it has properties that suggest it's meant to be a tool call
          if (parsedText.tool && typeof parsedText.tool === 'string') {
            console.log(`⚠️ Detected what appears to be a tool call in the text parameter: ${parsedText.tool}`);
            
            // Special case: if it's a finishRequest tool call, we can forward it to the proper tool
            if (parsedText.tool === 'finishRequest') {
              console.log('Converting embedded finishRequest to proper tool call');
              
              // Import and call the finishRequest tool directly
              const { finishRequest } = require('./finishRequest.js');
              
              if (finishRequest) {
                const result = await finishRequest(parsedText.parameters || {}, threadState);
                return {
                  forwarded: true,
                  originalTool: 'postMessage',
                  executedTool: 'finishRequest',
                  result
                };
              }
            }
            
            // Provide feedback that this should have been a direct tool call
            console.log('⚠️ The LLM tried to call another tool by embedding JSON in the message text');
            // We'll continue processing as a normal message, but log the issue
          }
        } catch (jsonError) {
          // Not valid JSON or not a tool call, continue as normal
          console.log(`Text parameter contains JSON-like content but isn't valid JSON or a tool call`);
        }
      }
    }
    
    // Format the message text using our shared utility
    let formattedMessage;
    
    // Check if we have text to format
    if (args.text) {
      formattedMessage = await formatMessageText(args.text);
    } else {
      formattedMessage = { blocks: [] };
    }
    
    // Get required context info
    const context = threadState.getMetadata('context');
    const channelId = getChannelId(args, threadState);
    const threadTs = getThreadTs(args, threadState);
    
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    // Prepare the message parameters
    messageParams = {
      channel: channelId,
      thread_ts: threadTs, // Will be ignored if no thread_ts exists
      ...formattedMessage // Spread in the blocks and attachments
    };
    
    // ALWAYS use a single space to avoid duplicating content visibly outside of blocks/attachments
    messageParams.text = " ";
    
    // Clean and process the message using our shared utility
    const cleanedMessage = cleanAndProcessMessage(messageParams);
    
    // Log the final message structure
    logMessageStructure(cleanedMessage);
    
    // Post the message
    const slack = getSlackClient();
    
    logMessageStructure(messageParams, 'POSTING_MESSAGE');
    
    const result = await slack.chat.postMessage(cleanedMessage);
    
    // Debug log the full message result structure
    console.log('📄 FULL MESSAGE RESULT STRUCTURE FROM SLACK:');
    console.log(JSON.stringify(result, null, 2));
    
    // Add to the new context builder with complete info
    try {
      const contextBuilder = getContextBuilder();
      contextBuilder.addMessage({
        source: 'llm',
        llmResponse: args,  // The original LLM tool call
        slackResult: result, // The Slack API result
        id: result.ts,
        timestamp: new Date().toISOString(),
        threadTs: threadTs || result.ts,
        originalContent: result  // Keep the full message
      });
      
      console.log('Added message to context builder');
    } catch (contextError) {
      console.error('Error adding message to context builder:', contextError);
    }
    
    // Legacy: Add the message to thread history for future reference
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

// Export the postMessage function
module.exports = {
  postMessage,
  getUserProfilePicture,
  stripMarkdownForNotification,
  extractUserIds
};
