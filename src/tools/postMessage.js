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
  
  // Replace <@USER_ID> with proper Slack mention format
  return text.replace(/<@([A-Z0-9]+)>/g, '@$1');
}

/**
 * Posts a message to a channel
 * @param {Object} args - The arguments for the message
 * @param {string} args.text - The text content of the message
 * @param {string} [args.title] - An optional title for the message
 * @param {string} [args.color] - An optional color for the message (blue, green, red, orange, purple or hex code)
 * @param {string} [args.threadTs] - Optional thread timestamp to reply in
 * @param {string} [args.channel] - Optional channel to post in (defaults to the current channel)
 * @param {Object} threadState - The current thread state
 * @returns {Promise<Object>} - Result of posting the message
 */
async function postMessage(args, threadState) {
  try {
    // Handle potential nested parameters structure 
    // This happens when the LLM returns {"tool": "postMessage", "parameters": {...}}
    if (args.parameters && !args.text && !args.title) {
      console.log('⚠️ Detected nested parameters structure in postMessage, extracting inner parameters');
      args = args.parameters;
    }

    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Extract parameters
    const {
      text,
      title,
      color = 'good',
      threadTs
    } = args;
    
    // CRITICAL FIX: Ignore any hardcoded channel that doesn't match current context
    // (This happens when the LLM hallucinates channel IDs)
    let channelId;
    if (args.channel && context?.channelId && args.channel !== context.channelId) {
      // Channel mismatch - log warning and use context channel instead
      console.log(`⚠️ WARNING: Ignoring mismatched channel ID "${args.channel}" - using context channel "${context.channelId}" instead`);
      channelId = context.channelId;
    } else {
      // Use channel from args, or fall back to context
      channelId = args.channel || context?.channelId;
    }
    
    // Validate channel
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    // Debug the message about to be sent
    console.log(`Sending message to channel: ${channelId}`);
    console.log(`Message content: ${text ? (text.length > 100 ? text.substring(0, 100) + '...' : text) : 'No text'}`);
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Check if blocks are provided directly, and handle them specially
    let messageOptions;
    if (args.blocks) {
      console.log('Direct blocks provided, handling specially');
      messageOptions = handleDirectBlocks(args, channelId);
    } else {
      // Format the message with our formatting helper
      const formattedMessage = formatSlackMessage({
        title,
        text,
        color,
        subtitle: args.subtitle,
        fields: args.fields,
        actions: args.actions,
        sections: args.sections,
        elements: args.elements,
        attachments: args.attachments
      });
      
      // Ensure message has content - this is critical
      // If formatSlackMessage failed to generate blocks or attachments, create a simple text attachment
      if (!formattedMessage.blocks?.length && !formattedMessage.attachments?.length) {
        // Create a simple attachment with the text
        formattedMessage.attachments = [{
          color: color || 'good',
          text: text || "", // Use space if no text is provided
          fallback: text || title || "Message from bot"
        }];
        
        // Remove the text field to avoid duplication
        formattedMessage.text = "";
      }
      
      // Prepare message options
      messageOptions = {
        channel: channelId,
        ...formattedMessage
      };
    }
    
    // Always set text to a space character if we have blocks or attachments
    // This avoids duplication while still meeting Slack's requirement for text
    if (messageOptions.blocks?.length > 0 || messageOptions.attachments?.length > 0) {
      messageOptions.text = messageOptions.text || ""; // Space character if not already set
    }
    
    // Add thread_ts if provided or from thread context
    const threadTimestamp = threadTs || context?.threadTs;
    if (threadTimestamp) {
      messageOptions.thread_ts = threadTimestamp;
    }
    
    // Log the full message structure for debugging
    console.log('OUTGOING MESSAGE - Message structure:');
    console.log(JSON.stringify({
      hasText: !!messageOptions.text,
      textLength: messageOptions.text?.length,
      hasBlocks: !!messageOptions.blocks && messageOptions.blocks.length > 0,
      blockCount: messageOptions.blocks?.length || 0,
      hasAttachments: !!messageOptions.attachments && messageOptions.attachments.length > 0,
      attachmentCount: messageOptions.attachments?.length || 0
    }, null, 2));
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageOptions);
    
    // Structured response for the LLM
    return {
      messageTs: response.ts,
      channelId: response.channel,
      metadata: {
        userId: context?.userId,
        threadTs: threadTimestamp
      }
    };
  } catch (error) {
    logError('Error posting message to Slack', error, { args });
    throw error;
  }
}

/**
 * Formats a message using our abstracted formatting approach
 * 
 * @param {Object} args - Message arguments
 * @param {string} channel - Channel ID
 * @returns {Object} - Formatted message options for Slack API
 */
function formatMessageWithAbstraction(args, channel) {
  console.log('FORMATTING WITH ABSTRACTION - Input args:');
  console.log(JSON.stringify(args, null, 2));

  // Use our formatting utilities to create a rich message
  const formattedMessage = formatSlackMessage({
    title: args.title,
    subtitle: args.subtitle,
    text: args.text,
    color: args.color,
    fields: args.fields,
    actions: args.actions,
    sections: args.sections,
    elements: args.elements,
    attachments: args.attachments
  });
  
  console.log('FORMATTING WITH ABSTRACTION - Result:');
  console.log(JSON.stringify({
    hasText: !!formattedMessage.text,
    textLength: formattedMessage.text?.length,
    blockCount: formattedMessage.blocks?.length,
    attachmentCount: formattedMessage.attachments?.length
  }, null, 2));
  
  // Return message options for Slack API
  return {
    channel,
    text: formattedMessage.text,
    blocks: formattedMessage.blocks,
    attachments: formattedMessage.attachments
  };
}

/**
 * Handles direct Block Kit format for advanced usage
 * 
 * @param {Object} args - Message arguments
 * @param {string} channel - Channel ID
 * @returns {Object} - Formatted message options for Slack API
 */
function handleDirectBlocks(args, channel) {
  console.log('HANDLING DIRECT BLOCKS - Input args:');
  console.log(JSON.stringify({
    hasText: !!args.text,
    textLength: args.text?.length,
    blocksType: typeof args.blocks,
    isBlocksArray: Array.isArray(args.blocks),
    blocksLength: Array.isArray(args.blocks) ? args.blocks.length : 
                  (typeof args.blocks === 'string' ? args.blocks.length : 'N/A')
  }, null, 2));

  let formattedBlocks = args.blocks;
  
  // If blocks is a string, try to parse it as JSON, otherwise use formatSlackMessage
  if (typeof args.blocks === 'string') {
    // Try to parse it first as JSON
    try {
      // Check if it looks like JSON (starts with [ or {)
      if (args.blocks.trim().startsWith('[') || args.blocks.trim().startsWith('{')) {
        formattedBlocks = JSON.parse(args.blocks);
      } else {
        // Not JSON, use it as text in a section block
        formattedBlocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: args.blocks
            }
          }
        ];
      }
    } catch (parseError) {
      console.log(`Error parsing blocks JSON: ${parseError.message}. Using as plain text.`);
      // If parsing fails, use it as text in a section block
      formattedBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: args.blocks
          }
        }
      ];
    }
  }
  
  // Ensure blocks is an array if present
  if (formattedBlocks && !Array.isArray(formattedBlocks)) {
    console.log(`Blocks is not an array: ${typeof formattedBlocks}. Converting to array.`);
    formattedBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: String(formattedBlocks)
        }
      }
    ];
  }
  
  // Return message options
  return {
    channel,
    // Provide a non-empty text field for accessibility (required by Slack API)
    // When blocks are present, this is only used for notifications and screen readers
    text: args.text || args.title || "Message from assistant",
    blocks: formattedBlocks
  };
}

module.exports = {
  postMessage,
  formatMessageWithAbstraction,
  handleDirectBlocks
}; 