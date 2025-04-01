// Retrieves and formats thread history from Slack
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Tool to retrieve the history of a thread for context rebuilding
 * @param {Object} args - Arguments
 * @param {number} [args.limit=20] - Maximum number of messages to retrieve
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Formatted thread history and thread stats
 */
async function getThreadHistory(args = {}, threadState) {
  try {
    // Handle potential nested parameters structure 
    if (args.parameters && !args.limit) {
      console.log('Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Extract the top-level reasoning (no need to filter it out)
    const reasoning = args.reasoning;
    
    // Filter out non-standard fields
    const validFields = [
      'limit', 'threadTs', 'includeParent'
    ];
    
    const filteredArgs = {};
    for (const key of validFields) {
      if (args[key] !== undefined) {
        filteredArgs[key] = args[key];
      }
    }
    
    // Log any filtered fields for debugging (excluding reasoning which we expect at top level)
    const filteredKeys = Object.keys(args)
      .filter(key => !validFields.includes(key) && key !== 'reasoning');
    if (filteredKeys.length > 0) {
      console.log(`Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
    }
    
    // Use filtered args from now on
    args = filteredArgs;
    
    // Default arguments
    const {
      limit = 20
    } = args;
    
    // Get required context info from metadata
    const context = threadState.getMetadata('context');
    const { channelId, threadTs, threadStats } = context || {};
    
    // Verify we have the necessary context
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    if (!threadTs) {
      throw new Error('Thread timestamp not found. This tool only works in threads');
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Use existing thread statistics if available and recent (less than 1 minute old)
    let totalMessagesInThread = 0;
    const threadStatsAreRecent = threadStats && 
      new Date().getTime() - new Date(threadStats.lastChecked).getTime() < 60000;
    
    if (threadStatsAreRecent) {
      totalMessagesInThread = threadStats.totalMessagesInThread;
      console.log(`- Using existing thread stats: ${totalMessagesInThread} messages in thread`);
    } else {
      // First get thread information to know total messages
      // We're intentionally using a small limit first to just get the count
      const threadInfo = await slackClient.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 5
      });
      
      // Get thread statistics
      totalMessagesInThread = threadInfo.messages?.[0]?.reply_count || 0;
    }
    
    // Now fetch the actual messages we want
    const result = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: limit,
      inclusive: true // Always include the parent message
    });
    
    // Format the messages
    const formattedMessages = [];
    const botUserId = await getBotUserId(slackClient);
    
    // Process the messages
    if (result.messages && result.messages.length > 0) {
      for (const message of result.messages) {
        // Skip messages without text or attachments
        if (!message.text && !message.attachments?.length) continue;
        
        // Determine if this is a bot message
        const isBot = message.bot_id || message.user === botUserId;
        const isParent = message.ts === threadTs;
        
        // Format text content
        let formattedText = message.text || '';
        
        // Filter out dev prefix '!@#' from the text
        if (formattedText.startsWith('!@#')) {
          formattedText = formattedText.substring(3).trim();
        }
        
        // Always process attachments
        if (message.attachments?.length) {
          formattedText += formatAttachments(message.attachments);
        }
        
        // Skip empty messages after processing
        if (!formattedText.trim()) continue;
        
        // Create the formatted message
        formattedMessages.push({
          isUser: !isBot,
          userId: message.user,
          text: formattedText,
          timestamp: message.ts,
          isParent
        });
      }
    }
    
    // Add the formatted messages to the thread state
    if (formattedMessages.length > 0) {
      // Sort messages by timestamp to ensure chronological order
      formattedMessages.sort((a, b) => parseFloat(a.timestamp) - parseFloat(b.timestamp));
      
      // Clear existing messages if we're rebuilding context
      threadState.messages = [];
      
      // Add all formatted messages to the thread state
      for (const msg of formattedMessages) {
        threadState.messages.push(msg);
      }
      
      // Set mayNeedHistory to false since we've now loaded the history
      if (context) {
        context.mayNeedHistory = false;
      }
    }
    
    // Return a summary of what we did along with thread statistics
    return {
      messagesRetrieved: formattedMessages.length,
      threadTs,
      channelId,
      threadStats: {
        totalMessagesInThread,
        parentMessageRetrieved: formattedMessages.some(msg => msg.isParent),
        remainingMessages: Math.max(0, totalMessagesInThread - formattedMessages.length + 1) // +1 accounts for parent message
      },
      contextRebuilt: formattedMessages.length > 0
    };
  } catch (error) {
    logError('Error retrieving thread history', error);
    throw error;
  }
}

/**
 * Gets the bot's own user ID
 * @param {Object} slackClient - Slack client
 * @returns {Promise<string>} - Bot user ID
 */
async function getBotUserId(slackClient) {
  try {
    const authInfo = await slackClient.auth.test();
    return authInfo.user_id;
  } catch (error) {
    logError('Error getting bot user ID', error);
    return null;
  }
}

/**
 * Formats attachments into a text description
 * @param {Array} attachments - Slack message attachments
 * @returns {string} - Formatted attachment descriptions
 */
function formatAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return '';
  }
  
  let result = '';
  
  for (const attachment of attachments) {
    // Check if attachment contains blocks (this is common for messages with interactive elements)
    if (attachment.blocks && attachment.blocks.length > 0) {
      result += '\n' + formatBlocks(attachment.blocks);
    }
    // Handle images
    else if (attachment.image_url) {
      result += `\n[Image: ${attachment.image_url}]`;
    }
    // Handle files
    else if (attachment.files) {
      for (const file of attachment.files) {
        result += `\n[File: ${file.name || 'unnamed'} - ${file.url_private || 'no url'}]`;
      }
    }
    // Handle links with previews
    else if (attachment.title_link) {
      result += `\n[Link: ${attachment.title || attachment.title_link} - ${attachment.title_link}]`;
    }
    // Handle other attachments with text
    else if (attachment.text) {
      result += `\n${attachment.text}`;
    }
    // Other attachments - use fallback text if available
    else if (attachment.fallback) {
      // Skip generic "[no preview available]" fallback
      if (attachment.fallback !== '[no preview available]') {
        result += `\n${attachment.fallback}`;
      }
    }
    // Add color information as context if available
    if (attachment.color) {
      // Convert hex color to descriptive name if possible
      const colorName = getColorName(attachment.color);
      if (colorName) {
        result += ` (${colorName} theme)`;
      }
    }
  }
  
  return result;
}

/**
 * Recursively formats blocks into text
 * @param {Array} blocks - Slack blocks to format
 * @returns {string} - Formatted text from blocks
 */
function formatBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) {
    return '';
  }
  
  let result = '';
  
  for (const block of blocks) {
    // Handle different block types
    switch (block.type) {
      case 'header':
        if (block.text && block.text.text) {
          result += `\n# ${block.text.text}`;
        }
        break;
        
      case 'section':
        if (block.text && block.text.text) {
          result += `\n${block.text.text}`;
        }
        // Handle fields in section
        if (block.fields && block.fields.length > 0) {
          block.fields.forEach(field => {
            if (field.text) {
              result += `\n${field.text}`;
            }
          });
        }
        break;
        
      case 'actions':
        // Extract button information
        if (block.elements && block.elements.length > 0) {
          const buttons = block.elements
            .filter(el => el.type === 'button')
            .map(btn => {
              const buttonText = btn.text?.text || 'Button';
              const buttonValue = btn.value || '';
              return `[${buttonText}${buttonValue ? ': ' + buttonValue : ''}]`;
            })
            .join(', ');
          
          if (buttons) {
            result += `\nButtons: ${buttons}`;
          }
        }
        break;
        
      case 'context':
        if (block.elements && block.elements.length > 0) {
          block.elements.forEach(element => {
            if (element.text) {
              result += `\n_${element.text}_`;
            }
          });
        }
        break;
        
      case 'divider':
        result += '\n---';
        break;
        
      case 'image':
        result += `\n[Image${block.title ? ': ' + block.title.text : ''}${block.alt_text ? ' (' + block.alt_text + ')' : ''}]`;
        break;
        
      case 'rich_text':
        // Process rich text elements
        if (block.elements) {
          for (const element of block.elements) {
            if (element.type === 'rich_text_section' && element.elements) {
              for (const subElement of element.elements) {
                if (subElement.type === 'text') {
                  result += subElement.text;
                }
              }
            }
          }
        }
        break;
    }
  }
  
  return result;
}

/**
 * Convert hex color to a descriptive name
 * @param {string} color - Color in hex or Slack color name
 * @returns {string|null} - Descriptive color name or null if not recognized
 */
function getColorName(color) {
  if (!color) return null;
  
  // Remove # from hex and standardize
  const formattedColor = color.startsWith('#') ? color.toLowerCase() : color;
  
  // Map of common Slack colors
  const colorMap = {
    'good': 'green',
    'warning': 'yellow',
    'danger': 'red',
    '#36c5f0': 'blue',
    '#2eb67d': 'green',
    '#e01e5a': 'red',
    '#ecb22e': 'yellow'
  };
  
  return colorMap[formattedColor] || null;
}

module.exports = {
  getThreadHistory
}; 