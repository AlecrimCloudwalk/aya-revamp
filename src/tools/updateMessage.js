// Tool for updating existing Slack messages
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

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
 * Updates an existing message in Slack
 * 
 * @param {Object} args - Arguments for updating the message
 * @param {string} args.messageTs - Timestamp of the message to update
 * @param {string} args.title - New title for the message
 * @param {string} args.text - New text content for the message
 * @param {string} args.color - Color for the message (optional)
 * @param {Array} args.fields - Array of field objects (optional)
 * @param {Array} args.actions - New array of button objects (optional)
 * @param {boolean} args.removeButtons - Whether to remove all buttons (optional)
 * @param {string} args.selectedButtonText - Text to show when a button was selected (replaces buttons with this text)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of updating the message
 */
async function updateMessage(args, threadState) {
  try {
    // Handle potential nested parameters structure 
    if (args.parameters && !args.messageTs && !args.text && !args.title) {
      console.log('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Filter out non-standard fields
    const validFields = [
      'messageTs', 'title', 'text', 'color', 'fields', 
      'actions', 'removeButtons', 'selectedButtonText', 'channel'
    ];
    
    const filteredArgs = {};
    for (const key of validFields) {
      if (args[key] !== undefined) {
        filteredArgs[key] = args[key];
      }
    }
    
    // Log any filtered fields for debugging
    const filteredKeys = Object.keys(args).filter(key => !validFields.includes(key));
    if (filteredKeys.length > 0) {
      console.log(`⚠️ Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
    }
    
    // Use filtered args from now on
    args = filteredArgs;
    
    // Extract parameters
    const { 
      messageTs, 
      title, 
      text, 
      color = 'blue', 
      fields, 
      actions, 
      removeButtons, 
      selectedButtonText 
    } = args;
    
    // Normalize the color value
    const formattedColor = normalizeColor(color);
    console.log(`Using color: ${formattedColor}`);
    
    // Get required parameters
    if (!messageTs) {
      throw new Error('Message timestamp (messageTs) is required');
    }
    
    if (!text && !fields && !title) {
      throw new Error('Either text, title, or fields must be provided');
    }
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // CRITICAL FIX: Ignore any hardcoded channel that doesn't match current context
    let channelId;
    if (args.channel && context?.channelId && args.channel !== context.channelId) {
      // Channel mismatch - log warning and use context channel instead
      console.log(`⚠️ WARNING: Ignoring mismatched channel ID "${args.channel}" - using context channel "${context.channelId}" instead`);
      channelId = context.channelId;
    } else {
      // Use channel from args, or fall back to context
      channelId = args.channel || context?.channelId;
    }
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // IMPORTANT: Check if this message has already been updated to prevent loops
    // Use messageTs as a unique key to track updates
    const updateKey = `update_${messageTs}`;
    if (threadState.updatedMessages && threadState.updatedMessages[updateKey]) {
      console.log(`⚠️ Message with timestamp ${messageTs} has already been updated. Preventing duplicate update.`);
      return {
        ok: true,
        ts: messageTs,
        channel: channelId,
        updated: true,
        alreadyUpdated: true,
        message: "This message has already been updated. Prevented duplicate update."
      };
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // First, add visual feedback that the update was initiated
    try {
      // Add a temporary loading message to indicate processing
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'hourglass_flowing_sand' // Loading indicator emoji
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      console.log(`⚠️ Could not add reaction: ${reactionError.message}`);
    }
    
    // First, get the current message to preserve any structure not being updated
    let originalMessage;
    try {
      const messageResponse = await slackClient.conversations.history({
        channel: channelId,
        latest: messageTs,
        inclusive: true,
        limit: 1
      });
      
      if (messageResponse.ok && messageResponse.messages && messageResponse.messages.length > 0) {
        originalMessage = messageResponse.messages[0];
      }
    } catch (error) {
      console.log(`⚠️ Could not fetch original message: ${error.message}`);
      // Continue with the update even if we couldn't fetch the original
    }
    
    // Check if this is a plain text message without blocks or attachments
    // This might happen when we're dealing with a user's message instead of a bot message
    if (originalMessage && 
        (!originalMessage.blocks || originalMessage.blocks.length === 0) &&
        (!originalMessage.attachments || originalMessage.attachments.length === 0) &&
        originalMessage.user) { // Ensure it's a user message
      console.log('⚠️ This appears to be a plain text user message, not a bot message.');
      
      // Remove the loading reaction
      try {
        await slackClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'hourglass_flowing_sand'
        });
      } catch (reactionError) {
        // Non-critical error, just log it
        console.log(`⚠️ Could not remove reaction: ${reactionError.message}`);
      }
      
      // Return gracefully without modifying the message
      return {
        ok: false,
        ts: messageTs,
        channel: channelId,
        updated: false,
        error: "Cannot update plain text user messages"
      };
    }
    
    // Determine if and how to update actions/buttons
    let formattedActions = actions;
    let contextText = null;
    
    if (removeButtons) {
      // If removeButtons is true, remove all buttons
      formattedActions = [];
    } else if (selectedButtonText) {
      // If selectedButtonText is provided, remove buttons and add this text as context
      formattedActions = [];
      contextText = selectedButtonText;
    }
    
    // Start building our message blocks
    const blocks = [];
    
    // Add title as a section with bold text if provided
    if (title) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*`
        }
      });
    }
    
    // Add main text content if provided
    if (text) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: text
        }
      });
    }
    
    // Add fields section if provided
    if (fields && Array.isArray(fields) && fields.length > 0) {
      const formattedFields = fields.map(field => {
        if (typeof field === 'string') {
          return {
            type: 'mrkdwn',
            text: field
          };
        }
        
        // Object with title/value
        if (field.title && field.value) {
          return {
            type: 'mrkdwn',
            text: `*${field.title}*\n${field.value}`
          };
        }
        
        // Just use the text property
        return {
          type: field.type || 'mrkdwn',
          text: field.text || ''
        };
      });
      
      blocks.push({
        type: 'section',
        fields: formattedFields
      });
    }
    
    // Add context text if provided (for selected button text)
    if (contextText) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: contextText
          }
        ]
      });
    }
    
    // Add actions/buttons if provided
    if (formattedActions && Array.isArray(formattedActions) && formattedActions.length > 0) {
      blocks.push({
        type: 'actions',
        elements: formattedActions.map((button, index) => ({
          type: 'button',
          text: {
            type: 'plain_text',
            text: button.text || `Button ${index + 1}`,
            emoji: true
          },
          value: button.value || `${index}`,
          action_id: button.action_id || `update_action_${index}_${Date.now()}`,
          style: button.style || undefined
        }))
      });
    }
    
    // Prepare message update options using the color bar pattern
    const updateOptions = {
      channel: channelId,
      ts: messageTs,
      text: "", // Empty text to prevent duplication
      attachments: [{
        color: formattedColor,
        blocks: blocks,
        fallback: title || text || "Updated message"
      }]
    };
    
    // Update the message
    const response = await slackClient.chat.update(updateOptions);
    
    // Store that we've updated this message to prevent duplicate updates
    if (!threadState.updatedMessages) {
      threadState.updatedMessages = {};
    }
    threadState.updatedMessages[updateKey] = {
      timestamp: new Date().toISOString(),
      title, 
      text
    };
    
    // Remove the loading reaction
    try {
      await slackClient.reactions.remove({
        channel: channelId,
        timestamp: messageTs,
        name: 'hourglass_flowing_sand'
      });
      
      // Add a checkmark reaction to indicate completion
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'white_check_mark'
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      console.log(`⚠️ Could not update reactions: ${reactionError.message}`);
    }
    
    // Return the result
    return {
      ok: response.ok,
      ts: response.ts,
      channel: response.channel,
      updated: true
    };
  } catch (error) {
    logError('Error updating message', error, { args });
    throw error;
  }
}

/**
 * Signals that the message update has been completed
 * This can be used to finalize the update and prevent repeated updates
 * 
 * @param {Object} args - Arguments for finalizing the message update
 * @param {string} args.messageTs - Message timestamp that was updated
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of finalizing the update
 */
async function finalizeMessageUpdate(args, threadState) {
  try {
    // Extract parameters
    const { messageTs } = args;
    
    // Store that this update has been finalized
    const updateKey = `update_${messageTs}`;
    if (!threadState.updatedMessages) {
      threadState.updatedMessages = {};
    }
    
    threadState.updatedMessages[updateKey] = {
      timestamp: new Date().toISOString(),
      finalized: true
    };
    
    return {
      success: true,
      messageTs,
      message: "Message update has been finalized and will not be processed again"
    };
  } catch (error) {
    logError('Error finalizing message update', error, { args });
    throw error;
  }
}

module.exports = {
  updateMessage,
  finalizeMessageUpdate,
  normalizeColor
}; 