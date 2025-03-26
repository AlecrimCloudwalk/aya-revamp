// Tool for creating interactive messages with buttons
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
 * Creates a message with interactive buttons
 * 
 * @param {Object} args - Arguments for the button message
 * @param {string} args.title - Title of the message
 * @param {string} args.text - Message content
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
    if (args.parameters && !args.text && !args.title && !args.buttons) {
      console.log('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Filter out non-standard fields that shouldn't be sent to Slack
    // This prevents fields like 'reasoning' from being incorrectly included
    const validFields = [
      'text', 'title', 'color', 'buttons', 'callbackId', 
      'actionPrefix', 'threadTs', 'channel'
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
    
    // Extract parameters with validation - use let for variables we'll modify later
    let title = args.title || 'Interactive Message';
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
    
    // Check for potential duplicates in the button registry
    if (threadState.buttonRegistry) {
      const existingButtons = Object.values(threadState.buttonRegistry);
      
      // Look for a similar button set (same title, text, and similar buttons)
      const potentialDuplicate = existingButtons.find(registry => {
        // Check if title and text are the same or very similar
        const titleMatch = registry.title === title || 
                          (title && registry.title && 
                          (title.includes(registry.title) || registry.title.includes(title)));
                          
        const textMatch = registry.text === text || 
                         (text && registry.text && 
                         (text.includes(registry.text) || registry.text.includes(text)));
        
        // If both title and text match, this is likely a duplicate
        return titleMatch && textMatch;
      });
      
      if (potentialDuplicate) {
        console.log(`⚠️ Found potentially duplicate button message: "${title}"`);
        console.log(`- Existing: "${potentialDuplicate.title}" from ${potentialDuplicate.timestamp}`);
        
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
    
    // Generate a random actionPrefix if not provided
    const actionPrefix = args.actionPrefix || `btn_${Date.now().toString()}_${Math.floor(Math.random() * 1000)}`;
    
    // Add callback_id to each button for tracking
    const actionsWithCallbackId = buttons.map((button, index) => {
      // Create a unique action ID that encodes the necessary tracking info
      const actionId = `${actionPrefix}_${index}`;
      
      // Store the metadata mapping in thread state for reference when button is clicked
      if (!threadState.buttonMetadataMap) {
        threadState.buttonMetadataMap = {};
      }
      
      // Store the metadata mapped to the action_id
      threadState.buttonMetadataMap[actionId] = {
        callbackId: actionPrefix,
        buttonIndex: index,
        threadTs: threadTs || context?.threadTs,
        channelId,
        userId: context?.userId
      };
      
      return {
        text: button.text || `Button ${index + 1}`,
        value: button.value || `${index}`,
        style: button.style,
        action_id: actionId
      };
    });
    
    // Create blocks to be placed inside the attachment
    const blocks = [];
    
    // Add title as a section with bold text (not header block)
    // This matches postMessage.js approach for consistency
    if (title) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*`
        }
      });
    }
    
    // Add section with text if provided
    if (text) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: text
        }
      });
    }
    
    // Add buttons as actions block
    blocks.push({
      type: 'actions',
      elements: actionsWithCallbackId.map(button => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: button.text,
          emoji: true
        },
        value: button.value,
        action_id: button.action_id,
        style: button.style || undefined
      }))
    });
    
    // Message structure for Slack API:
    // 1. empty text field to prevent duplication
    // 2. blocks go inside the colored attachment
    // 3. color goes on the attachment
    // This structure ensures we get the colored vertical bar and no duplicated content
    
    // Prepare message options using attachments for color bar
    const messageOptions = {
      channel: channelId,
      text: "", // Empty string for fallback, content will be in blocks inside attachment
      attachments: [{
        color: formattedColor,
        blocks: blocks,
        fallback: title || text || "Button message"
      }]
    };
    
    // Add thread_ts if we have a valid thread timestamp
    if (threadTimestamp) {
      messageOptions.thread_ts = threadTimestamp;
    }
    
    // Debug logging
    console.log('BUTTON MESSAGE - Message structure:');
    console.log(JSON.stringify({
      hasText: !!messageOptions.text,
      textLength: messageOptions.text?.length,
      hasAttachments: !!messageOptions.attachments && messageOptions.attachments.length > 0,
      attachmentCount: messageOptions.attachments?.length || 0,
      blockCount: messageOptions.attachments?.[0]?.blocks?.length || 0,
      buttonCount: messageOptions.attachments?.[0]?.blocks?.find(b => b.type === 'actions')?.elements?.length || 0,
      threadTs: messageOptions.thread_ts || null
    }, null, 2));
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageOptions);
    
    // Store button metadata in thread state for later retrieval
    if (!threadState.buttonRegistry) {
      threadState.buttonRegistry = {};
    }
    
    // Register this set of buttons
    threadState.buttonRegistry[actionPrefix] = {
      buttons,
      messageTs: response.ts,
      threadTs: threadTimestamp,
      channelId,
      userId: context?.userId,
      timestamp: new Date().toISOString(),
      title,  // Store title for duplicate detection
      text    // Store text for duplicate detection
    };
    
    // Also register each button's specific action ID for easier lookup
    actionsWithCallbackId.forEach((button, index) => {
      const specificActionId = button.action_id;
      threadState.buttonRegistry[specificActionId] = {
        actionPrefix,
        buttonIndex: index,
        text: button.text,
        value: button.value,
        messageTs: response.ts,
        threadTs: threadTimestamp,
        channelId,
        timestamp: new Date().toISOString()
      };
    });
    
    console.log(`Registered button set with action prefix: ${actionPrefix} and ${actionsWithCallbackId.length} individual buttons`);
    
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
    logError('Error creating button message', error, { args });
    throw error;
  }
}

module.exports = {
  createButtonMessage,
  normalizeColor
}; 