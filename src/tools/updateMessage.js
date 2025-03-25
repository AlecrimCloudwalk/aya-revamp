// Tool for updating existing Slack messages
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

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
    const { messageTs, title, text, color, fields, actions, removeButtons, selectedButtonText } = args;
    
    // Get required parameters
    if (!messageTs) {
      throw new Error('Message timestamp (messageTs) is required');
    }
    
    if (!text && !fields) {
      throw new Error('Either text or fields must be provided');
    }
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Get channel ID from context
    const channelId = context?.channelId;
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
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
    
    // Format the updated message
    const message = formatSlackMessage({
      title,
      text,
      color: color || '#0078D7',
      fields,
      actions: formattedActions,
      context: contextText ? [{ text: contextText }] : undefined
    });
    
    // Prepare message update options
    const updateOptions = {
      channel: channelId,
      ts: messageTs,
      text: message.text,
      blocks: message.blocks
    };
    
    // Update the message
    const response = await slackClient.chat.update(updateOptions);
    
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

module.exports = {
  updateMessage
}; 