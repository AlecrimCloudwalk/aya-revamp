// Tool for creating interactive messages with buttons
// 
// MANDATORY RULES:
// 1. The text field outside of blocks and attachments MUST ALWAYS be empty ("") to prevent duplicate text
// 2. All message content MUST be placed inside an attachments block to ensure proper vertical colored bar display
// 3. Never place content directly in blocks at the top level, always use attachments with blocks inside
//
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const { parseMessage, cleanForSlackApi, processUserMentions } = require('./blockBuilder');

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
 * Creates a message with interactive buttons
 * 
 * @param {Object} args - Arguments for the button message
 * @param {string} args.text - Message content with optional block syntax
 * @param {string} args.color - Color of the message (optional)
 * @param {Array|string} args.buttons - Array of button objects or JSON string representing buttons
 * @param {string} args.callbackId - Unique identifier for this set of buttons
 * @param {string} args.threadTs - Thread timestamp to reply in (optional)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of sending the message
 */
async function createButtonMessage(args, threadState) {
  try {
    console.log('⚠️ createButtonMessage args:', JSON.stringify(args, null, 2));
    
    // Handle potential nested parameters structure 
    if (args.parameters && !args.text && !args.buttons) {
      console.log('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Extract the top-level reasoning (no need to filter it out)
    const reasoning = args.reasoning;
    
    // Filter out non-standard fields that shouldn't be sent to Slack
    const validFields = [
      'text', 'color', 'buttons', 'callbackId', 
      'actionPrefix', 'threadTs', 'channel'
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
      console.log(`⚠️ Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
    }
    
    // Use filtered args from now on
    args = filteredArgs;
    
    // Extract parameters with validation - use let for variables we'll modify later
    let text = args.text || 'Please select an option';
    let buttons = args.buttons || [];
    let color = args.color || 'blue';
    let threadTs = args.threadTs;
    
    // Normalize the color value
    const formattedColor = normalizeColor(color);
    console.log(`Using color: ${formattedColor}`);
    
    // Validate and log parameters
    console.log(`⚠️ Buttons parameter type: ${typeof buttons}`);
    
    // Handle buttons format - can be an array, string JSON, or missing
    if (typeof buttons === 'string') {
      try {
        console.log('Parsing buttons parameter from JSON string to array');
        buttons = JSON.parse(buttons);
        console.log('Successfully parsed buttons parameter to array');
      } catch (error) {
        console.log(`Error parsing buttons parameter: ${error.message}`);
        // Create default buttons if parsing fails
        buttons = [
          { text: 'Option 1', value: 'option1' },
          { text: 'Option 2', value: 'option2' }
        ];
      }
    }
    
    // Ensure buttons is an array
    if (!Array.isArray(buttons)) {
      console.log(`⚠️ Buttons is not an array, converting to array`);
      // Try to convert to array if possible, otherwise use default
      if (buttons && typeof buttons === 'object') {
        buttons = [buttons]; // Single button object
      } else {
        // Default buttons
        buttons = [
          { text: 'Option 1', value: 'option1' },
          { text: 'Option 2', value: 'option2' }
        ];
      }
    } else {
      console.log(`⚠️ Buttons parameter is already an array with ${buttons.length} items`);
    }
    
    // Ensure we have at least one button
    if (buttons.length === 0) {
      console.log('⚠️ No buttons provided, adding default buttons');
      buttons = [
        { text: 'Option 1', value: 'option1' },
        { text: 'Option 2', value: 'option2' }
      ];
    }
    
    // Map buttons to ensure they have all required properties
    buttons = buttons.map((button, index) => {
      // Sanity check - ensure button is an object
      if (!button || typeof button !== 'object') {
        button = { text: `Option ${index + 1}`, value: `option${index + 1}` };
      }
      
      // Ensure button has text and value
      return {
        text: button.text || `Option ${index + 1}`,
        value: button.value || `option${index + 1}`,
        style: button.style
      };
    });
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
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
    
    // CRITICAL FIX: Ignore any hardcoded threadTs that doesn't match current context
    // (This happens when the LLM hallucinates thread timestamps)
    let threadTimestamp;
    if (args.threadTs && context?.threadTs && args.threadTs !== context.threadTs) {
      // Thread timestamp mismatch - log warning and use context threadTs instead
      console.log(`⚠️ WARNING: Ignoring mismatched thread timestamp "${args.threadTs}" - using context timestamp "${context.threadTs}" instead`);
      threadTimestamp = context.threadTs;
    } else {
      // Use threadTs from args, or fall back to context
      threadTimestamp = args.threadTs || context?.threadTs;
    }
    
    // Validate channel
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    console.log(`Using channel ID: ${channelId}`);
    console.log(`Using thread timestamp: ${threadTimestamp || 'none (new thread)'}`);
    
    // Check for potential duplicates in the button registry
    if (threadState.buttonRegistry) {
      const existingButtons = Object.values(threadState.buttonRegistry);
      
      // Look for a similar button set (similar text and buttons)
      const potentialDuplicate = existingButtons.find(registry => {
        // Check if text is the same or very similar
        const textMatch = registry.text === text || 
                         (text && registry.text && 
                         (text.includes(registry.text) || registry.text.includes(text)));
        
        // If text matches, this is likely a duplicate
        return textMatch;
      });
      
      if (potentialDuplicate) {
        console.log(`⚠️ Found potentially duplicate button message`);
        console.log(`- Existing: from ${potentialDuplicate.timestamp}`);
        
        // Return the existing button info instead of creating a new one
        return {
          ok: true,
          ts: potentialDuplicate.messageTs,
          channel: potentialDuplicate.channelId,
          buttons: potentialDuplicate.buttons.map(b => ({ text: b.text, value: b.value })),
          callbackId: potentialDuplicate.callbackId || potentialDuplicate.messageTs,
          isDuplicate: true,
          message: "Used existing button message to prevent duplicate"
        };
      }
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Generate a unique callback ID for this button set if not provided
    const callbackId = args.callbackId || `buttons_${Date.now()}`;
    
    // Generate a unique prefix for action IDs if needed
    const actionPrefix = args.actionPrefix || callbackId;
    
    // Format the message using the BlockBuilder if text has block syntax
    let formattedMessage;
    
    // Check if message has block syntax markers
    const hasBlockSyntax = text.includes('#') || text.includes('(usercontext)');
    
    if (hasBlockSyntax) {
      console.log('✅ Using BlockBuilder format for message');
      formattedMessage = await parseMessage(text);
    } else {
      // Use standard message formatting
      formattedMessage = formatSlackMessage(text);
      console.log('✅ Using standard message format');
    }
    
    // Create the button actions block
    const actionsBlock = {
      type: 'actions',
      block_id: `actions_${actionPrefix}`,
      elements: buttons.map((button, index) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: button.text,
          emoji: true
        },
        value: button.value,
        action_id: `${actionPrefix}_action_${index}`,
        style: button.style || undefined // Default: no style (gray)
      }))
    };
    
    // Prepare the message parameters
    const messageParams = {
      channel: channelId,
      text: " ", // Empty text to prevent duplication
    };
    
    // If we got blocks from blockBuilder, use them
    if (formattedMessage.blocks && formattedMessage.blocks.length > 0) {
      // If there are attachments, add the actions block to the last attachment's blocks
      if (formattedMessage.attachments && formattedMessage.attachments.length > 0) {
        const lastAttachment = formattedMessage.attachments[formattedMessage.attachments.length - 1];
        if (!lastAttachment.blocks) {
          lastAttachment.blocks = [];
        }
        lastAttachment.blocks.push(actionsBlock);
      } else {
        // No attachments, create one with the existing blocks and actions
        messageParams.attachments = [{
          color: formattedColor,
          blocks: [...formattedMessage.blocks, actionsBlock]
        }];
        // Clear the blocks at the top level to prevent duplication
        formattedMessage.blocks = [];
      }
    } else if (formattedMessage.attachments && formattedMessage.attachments.length > 0) {
      // We got attachments from blockBuilder, add actions to the last one
      const lastAttachment = formattedMessage.attachments[formattedMessage.attachments.length - 1];
      if (!lastAttachment.blocks) {
        lastAttachment.blocks = [];
      }
      lastAttachment.blocks.push(actionsBlock);
    } else {
      // No blocks or attachments, create a new attachment with a section and actions
      messageParams.attachments = [{
        color: formattedColor,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: text
            }
          },
          actionsBlock
        ]
      }];
    }
    
    // Add thread_ts if needed
    if (threadTimestamp) {
      messageParams.thread_ts = threadTimestamp;
    }
    
    // Combine the formatted message with our parameters
    if (formattedMessage.attachments) {
      messageParams.attachments = formattedMessage.attachments;
    }
    
    // Ensure all message blocks are clean without _metadata properties
    if (messageParams.blocks) {
      messageParams.blocks = cleanForSlackApi(messageParams.blocks);
      
      // Process text in blocks
      messageParams.blocks.forEach(block => {
        // Process emoji shortcodes and user mentions in text
        if (block.text && typeof block.text.text === 'string') {
          block.text.text = processUserMentions(block.text.text);
        }
        
        // Clean newlines in header blocks
        if (block.type === 'header' && block.text && block.text.text) {
          block.text.text = block.text.text.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
        }
      });
    }
    
    if (messageParams.attachments) {
      messageParams.attachments = cleanForSlackApi(messageParams.attachments);
      
      // Validate each attachment has properly formed blocks
      messageParams.attachments.forEach(attachment => {
        if (attachment.blocks) {
          attachment.blocks.forEach(block => {
            // Process emoji shortcodes and user mentions in text
            if (block.text && typeof block.text.text === 'string') {
              block.text.text = processUserMentions(block.text.text);
            }
            
            // Clean newlines in header blocks
            if (block.type === 'header' && block.text && block.text.text) {
              block.text.text = block.text.text.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
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
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageParams);
    
    // Store button metadata in thread state for later retrieval
    if (!threadState.buttonRegistry) {
      threadState.buttonRegistry = {};
    }
    
    // Register this button set
    threadState.buttonRegistry[callbackId] = {
      text,
      buttons,
      messageTs: response.ts,
      channelId,
      callbackId,
      timestamp: new Date().toISOString()
    };
    
    // Add metadata to button state for reference
    if (typeof threadState.setButtonState === 'function') {
      buttons.forEach(option => {
        const buttonId = `${actionPrefix}:${option.value}`;
        threadState.setButtonState(buttonId, 'active', {
          label: option.label || option.value,
          value: option.value,
          threadTs: threadTimestamp,
          timestamp: response.ts,
          userId: context?.userId
        });
      });
    } else {
      console.log('⚠️ Warning: threadState.setButtonState is not a function - button states will not be saved');
    }
    
    // Return information about the created message
    return {
      messageTs: response.ts,
      channelId: response.channel,
      actionId: actionPrefix,
      options: buttons.map(option => ({
        label: option.label || option.value,
        value: option.value,
        actionId: `${actionPrefix}:${option.value}`
      })),
      metadata: {
        userId: context?.userId,
        threadTs: threadTimestamp
      }
    };
  } catch (error) {
    console.log(`❌ CRITICAL ERROR: ${error.message}`);
    console.log('Stack trace:', error.stack);
    logError('Error creating button message', error, { args });
    throw error;
  }
}

module.exports = {
  createButtonMessage,
  normalizeColor
}; 