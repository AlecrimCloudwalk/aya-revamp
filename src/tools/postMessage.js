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
 * Posts a message to Slack with rich formatting options
 * 
 * @param {Object} args - Arguments for posting the message
 * @param {string} args.text - Plain text or markdown formatted message content
 * @param {string} args.title - Optional title for the message
 * @param {string} args.subtitle - Optional subtitle for the message
 * @param {string} args.color - Optional color for the message sidebar (hex code or color name)
 * @param {Array} args.fields - Optional fields as [{title, value}]
 * @param {Array} args.elements - Optional rich elements for advanced formatting
 * @param {Array} args.sections - Optional section texts
 * @param {Array} args.actions - Optional button actions for basic buttons without tracking
 * @param {Array|string} args.blocks - Direct Slack Block Kit formatted message content (optional, advanced)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of sending the message
 */
async function postMessage(args, threadState) {
  try {
    // Always use the channel from thread context, ignoring any channel provided in args
    const channel = threadState.context?.channelId;
    
    if (!channel) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // Ensure we have some content
    if (!args.text && !args.title && !args.elements && !args.blocks && !args.sections) {
      throw new Error('Message must have content (text, title, elements, or blocks)');
    }
    
    // Process user mentions in text and other content
    if (args.text) {
      args.text = processUserMentions(args.text);
    }
    
    if (args.title) {
      args.title = processUserMentions(args.title);
    }
    
    if (args.subtitle) {
      args.subtitle = processUserMentions(args.subtitle);
    }
    
    // Process direct blocks if provided (advanced usage)
    let messageOptions = {};
    
    if (args.blocks) {
      // Handle direct block kit format (advanced)
      messageOptions = handleDirectBlocks(args, channel);
    } else {
      // Use our abstracted formatting (recommended approach)
      messageOptions = formatMessageWithAbstraction(args, channel);
    }
    
    // Add thread_ts if provided
    if (args.threadTs) {
      messageOptions.thread_ts = args.threadTs;
    } else if (threadState.context?.threadTs) {
      // If threadTs not provided but thread context exists, use that
      messageOptions.thread_ts = threadState.context.threadTs;
    }
    
    // Post the message
    console.log(`Posting message to channel ${channel} with options: ${JSON.stringify({
      channel: messageOptions.channel,
      text: messageOptions.text?.substring(0, 50) + (messageOptions.text?.length > 50 ? '...' : ''),
      hasBlocks: !!messageOptions.blocks,
      blockCount: messageOptions.blocks?.length,
      hasAttachments: !!messageOptions.attachments,
      threadTs: messageOptions.thread_ts
    })}`);
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageOptions);
    
    // Return relevant information
    return {
      ok: response.ok,
      ts: response.ts,
      channel: response.channel,
      message: response.message
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
    text: args.text || "Message from assistant",
    blocks: formattedBlocks
  };
}

module.exports = {
  postMessage
}; 