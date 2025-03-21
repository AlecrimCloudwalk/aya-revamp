// Posts messages to Slack
const { formatSlackMessage } = require('../slackFormat.js');
const { logError } = require('../errors.js');
const { getSlackClient } = require('../slackClient.js');

/**
 * Process text to handle user mentions in the format <@USER_ID>
 * @param {string} text - The text to process
 * @returns {string} - Text with proper Slack user mentions
 */
function processUserMentions(text) {
  if (!text) return text;
  
  // Already in the correct format for Slack mentions
  // This passes through mention format: <@U1234567> is already valid in Slack
  return text;
}

/**
 * Tool to post a message to Slack
 * @param {Object} args - Arguments for the message
 * @param {string} args.title - Message title
 * @param {string} [args.subtitle] - Optional subtitle
 * @param {string} [args.text] - Message text (supports Slack markdown)
 * @param {string} [args.color] - Message color
 * @param {Array} [args.fields] - Optional fields
 * @param {Array} [args.actions] - Optional action buttons
 * @param {string} [args.thread_ts] - Optional thread timestamp
 * @param {string} [args.update_ts] - Optional message timestamp to update
 * @param {Object} conversationState - Current conversation state
 * @returns {Promise<Object>} - The Slack API response
 */
async function postMessage(args, conversationState) {
  try {
    const { 
      title, 
      subtitle, 
      text, 
      color, 
      fields, 
      actions,
      thread_ts,
      update_ts 
    } = args;
    
    // Get Slack client from our singleton
    const slackClient = getSlackClient();
    
    // Get channel from conversation context
    const channelId = conversationState.context.channelId;
    if (!channelId) {
      throw new Error('Channel ID not found in conversation context');
    }
    
    // Process text for user mentions
    const processedText = processUserMentions(text);
    const processedTitle = processUserMentions(title);
    const processedSubtitle = processUserMentions(subtitle);
    
    // Process fields if present
    let processedFields = fields;
    if (fields && Array.isArray(fields)) {
      processedFields = fields.map(field => ({
        ...field,
        title: processUserMentions(field.title),
        value: processUserMentions(field.value)
      }));
    }
    
    // Format the message using our helper
    const message = formatSlackMessage({
      title: processedTitle,
      subtitle: processedSubtitle,
      text: processedText,
      color,
      fields: processedFields,
      actions
    });
    
    // Prepare basic message options
    const messageOptions = {
      channel: channelId,
      text: message.text,
      blocks: message.blocks
    };
    
    // Add thread_ts if specified or from conversation context
    const threadTs = thread_ts || conversationState.context.threadTs;
    if (threadTs) {
      messageOptions.thread_ts = threadTs;
    }
    
    // Decide whether to post a new message or update an existing one
    let response;
    if (update_ts) {
      // Update an existing message
      response = await slackClient.chat.update({
        ...messageOptions,
        ts: update_ts
      });
    } else {
      // Post a new message
      response = await slackClient.chat.postMessage(messageOptions);
    }
    
    // Return a clean response with just what we need
    return {
      ok: response.ok,
      ts: response.ts,
      channel: response.channel
    };
  } catch (error) {
    // Log the error and re-throw for the orchestrator to handle
    logError('Error posting message to Slack', error, { args });
    throw error;
  }
}

module.exports = {
  postMessage
}; 