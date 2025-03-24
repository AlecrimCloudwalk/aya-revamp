// Tool for creating interactive messages with buttons
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Creates a message with interactive buttons
 * 
 * @param {Object} args - Arguments for the button message
 * @param {string} args.title - Title of the message
 * @param {string} args.text - Message content
 * @param {string} args.color - Color of the message (optional)
 * @param {Array} args.buttons - Array of button objects
 * @param {string} args.callbackId - Unique identifier for this set of buttons
 * @param {string} args.threadTs - Thread timestamp to reply in (optional)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of sending the message
 */
async function createButtonMessage(args, threadState) {
  try {
    const { title, text, color, buttons, callbackId, threadTs } = args;
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Get channel from thread state
    const channelId = threadState.context.channelId;
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
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
    
    // Parse buttons if provided as string
    let parsedButtons = buttons;
    if (typeof buttons === 'string') {
      try {
        parsedButtons = JSON.parse(buttons);
      } catch (error) {
        throw new Error(`Invalid buttons JSON: ${error.message}`);
      }
    }
    
    // Validate buttons
    if (!Array.isArray(parsedButtons) || parsedButtons.length === 0) {
      throw new Error('Buttons must be a non-empty array');
    }
    
    // Add callback_id to each button for tracking
    const actionsWithCallbackId = parsedButtons.map((button, index) => ({
      text: button.text || `Button ${index + 1}`,
      value: button.value || `${index}`,
      action_id: `${callbackId || 'button'}_${index}`,
      // Store metadata in the button to track when clicked
      metadata: JSON.stringify({
        callbackId: callbackId || 'button',
        buttonIndex: index,
        threadTs: threadTs || threadState.context.threadTs,
        channelId,
        userId: threadState.context.userId
      })
    }));
    
    // Format the message with buttons
    const message = formatSlackMessage({
      title,
      text,
      color: color || '#0078D7',
      actions: actionsWithCallbackId
    });
    
    // Prepare message options
    const messageOptions = {
      channel: channelId,
      text: message.text,
      blocks: message.blocks
    };
    
    // Add thread_ts if provided or from thread context
    const threadTimestamp = threadTs || threadState.context.threadTs;
    if (threadTimestamp) {
      messageOptions.thread_ts = threadTimestamp;
    }
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageOptions);
    
    // Store button metadata in thread state for later retrieval
    if (!threadState.buttonRegistry) {
      threadState.buttonRegistry = {};
    }
    
    // Register this set of buttons
    threadState.buttonRegistry[callbackId || response.ts] = {
      buttons: parsedButtons,
      messageTs: response.ts,
      threadTs: threadTimestamp,
      channelId,
      userId: threadState.context.userId,
      timestamp: new Date().toISOString(),
      title: title,  // Store title for duplicate detection
      text: text     // Store text for duplicate detection
    };
    
    // Return relevant information
    return {
      ok: response.ok,
      ts: response.ts,
      channel: response.channel,
      buttons: parsedButtons.map(b => ({ text: b.text, value: b.value })),
      callbackId: callbackId || response.ts
    };
  } catch (error) {
    logError('Error creating button message', error, { args });
    throw error;
  }
}

module.exports = {
  createButtonMessage
}; 