// Tool for updating existing Slack messages
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const { parseMessage } = require('../toolUtils/blockBuilder');
const logger = require('../toolUtils/logger.js');

const { 
  normalizeColor, 
  formatMessageText, 
  cleanAndProcessMessage, 
  getChannelId,
  getThreadTs, 
  logMessageStructure,
  mergeAttachmentsByColor
} = require('../toolUtils/messageFormatUtils');

/**
 * Updates an existing message in Slack
 * 
 * @param {Object} args - Arguments for updating the message
 * @param {string} args.messageTs - Timestamp of the message to update
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
    if (args.parameters && !args.messageTs && !args.text) {
      logger.warn('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Filter out non-standard fields
    const validFields = [
      'messageTs', 'text', 'color', 'fields', 
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
      logger.warn(`⚠️ Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
    }
    
    // Use filtered args from now on
    args = filteredArgs;
    
    // Extract parameters
    const { 
      messageTs, 
      text, 
      color = 'blue', 
      fields, 
      actions, 
      removeButtons, 
      selectedButtonText 
    } = args;
    
    // Normalize the color value
    const formattedColor = normalizeColor(color);
    logger.info(`Using color: ${formattedColor}`);
    
    // Get required parameters
    if (!messageTs) {
      throw new Error('Message timestamp (messageTs) is required');
    }
    
    if (!text && !fields) {
      throw new Error('Either text or fields must be provided');
    }
    
    // Get valid channel ID
    const channelId = getChannelId(args, threadState);
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // IMPORTANT: Check if this message has already been updated to prevent loops
    // Use messageTs as a unique key to track updates
    const updateKey = `update_${messageTs}`;
    if (threadState.updatedMessages && threadState.updatedMessages[updateKey]) {
      logger.warn(`⚠️ Message with timestamp ${messageTs} has already been updated. Preventing duplicate update.`);
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
        name: 'loading' // Loading indicator emoji
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      logger.warn(`⚠️ Could not add reaction: ${reactionError.message}`);
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
      logger.warn(`⚠️ Could not fetch original message: ${error.message}`);
      // Continue with the update even if we couldn't fetch the original
    }
    
    // Check if this is a plain text message without blocks or attachments
    // This might happen when we're dealing with a user's message instead of a bot message
    if (originalMessage && 
        (!originalMessage.blocks || originalMessage.blocks.length === 0) &&
        (!originalMessage.attachments || originalMessage.attachments.length === 0) &&
        originalMessage.user) { // Ensure it's a user message
      logger.warn('⚠️ This appears to be a plain text user message, not a bot message.');
      
      // Remove the loading reaction
      try {
        await slackClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'loading'
        });
      } catch (reactionError) {
        // Non-critical error, just log it
        logger.warn(`⚠️ Could not remove reaction: ${reactionError.message}`);
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
    
    // Format the message text using our shared utility
    let formattedMessage;
    if (text) {
      formattedMessage = await formatMessageText(text);
    } else {
      formattedMessage = { blocks: [] };
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
      
      formattedMessage.blocks.push({
        type: 'section',
        fields: formattedFields
      });
    }
    
    // Add context text if provided (for selected button text)
    if (contextText) {
      formattedMessage.blocks.push({
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
      formattedMessage.blocks.push({
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
      text: " ", // Empty text to prevent duplication
    };
    
    // If we have attachments from parseMessage, use them
    if (formattedMessage.attachments && formattedMessage.attachments.length > 0) {
      updateOptions.attachments = formattedMessage.attachments;
    } else {
      // Otherwise, create a new attachment with our blocks
      updateOptions.attachments = [{
        color: formattedColor,
        blocks: formattedMessage.blocks,
        fallback: text || "Updated message"
      }];
    }
    
    // Apply color from args to attachments
    if (color && updateOptions.attachments && updateOptions.attachments.length > 0) {
      logger.info(`Applying color ${formattedColor} from args to attachments`);
      
      updateOptions.attachments.forEach(attachment => {
        // Always override the attachment color with the specified color
        const defaultColor = "#842BFF"; // The default Slack blue
        const isDefaultColor = attachment.color === defaultColor;
        
        // Apply the color if attachment has default color or no color
        if (isDefaultColor || !attachment.color) {
          logger.info(`Replacing color ${attachment.color || 'none'} with ${formattedColor}`);
          attachment.color = formattedColor;
        } else {
          logger.info(`Keeping existing color ${attachment.color} (not default)`);
        }
      });
    }
    
    // Merge attachments with same color to reduce number of visual bars
    if (updateOptions.attachments && updateOptions.attachments.length > 1) {
      logger.info(`Before merging: ${updateOptions.attachments.length} attachments`);
      updateOptions.attachments = mergeAttachmentsByColor(updateOptions.attachments);
      logger.info(`After merging: ${updateOptions.attachments.length} attachments`);
    }
    
    // Clean and process all blocks and attachments for Slack API
    const cleanedMessage = cleanAndProcessMessage(updateOptions);
    
    // Log the final message structure
    logMessageStructure(cleanedMessage, 'UPDATE');
    
    // Update the message
    const response = await slackClient.chat.update(cleanedMessage);
    
    // Store that we've updated this message to prevent duplicate updates
    if (!threadState.updatedMessages) {
      threadState.updatedMessages = {};
    }
    threadState.updatedMessages[updateKey] = {
      timestamp: new Date().toISOString(),
      text
    };
    
    // Remove the loading reaction
    try {
      await slackClient.reactions.remove({
        channel: channelId,
        timestamp: messageTs,
        name: 'loading'
      });
      
      // Add a checkmark reaction to indicate completion
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'white_check_mark'
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      logger.warn(`⚠️ Could not update reactions: ${reactionError.message}`);
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
  finalizeMessageUpdate
}; 