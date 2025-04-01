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
const { parseMessage, cleanForSlackApi } = require('../toolUtils/blockBuilder');
const { 
  normalizeColor, 
  formatMessageText, 
  cleanAndProcessMessage, 
  getChannelId, 
  getThreadTs, 
  logMessageStructure 
} = require('../toolUtils/messageFormatUtils');

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
    let text = args.text || '';
    let color = args.color || 'blue';
    let buttonsFoundInText = false; // Used just for logging purposes now

    // --- START EDIT: Remove manual #buttons parsing ---
    // Instead of manually parsing #buttons syntax, just log whether it exists
    // and let parseMessage/blockBuilder handle it later
    if (!text) {
      console.log('⚠️ Text parameter is empty. Cannot create buttons without #buttons syntax in text.');
      threadState.llmFeedback = threadState.llmFeedback || [];
      threadState.llmFeedback.push({
          type: 'buttonCreationFailed',
          message: "Button message creation failed: The 'text' parameter was empty. You MUST provide message content AND the #buttons syntax within the text.",
          timestamp: new Date().toISOString()
      });
    } else {
        // Just check if the syntax exists for logging 
        const buttonSyntaxMatch = text.match(/#buttons:\s*\[(.*?)\]/s);
        if (buttonSyntaxMatch) {
          console.log('Found #buttons syntax in text. This will be processed by parseMessage.');
          buttonsFoundInText = true;
        } else {
          console.log('⚠️ #buttons syntax not found in text. Message will be created without buttons.');
          threadState.llmFeedback = threadState.llmFeedback || [];
          threadState.llmFeedback.push({
              type: 'buttonSyntaxMissing',
              message: "Button message creation skipped buttons: The #buttons:[...] syntax was missing in the text parameter.",
              timestamp: new Date().toISOString()
          });
        }
    }
    // --- END EDIT ---

    // Normalize the color value
    const formattedColor = normalizeColor(color);
    console.log(`Using color: ${formattedColor}`);
    
    // --- START EDIT: Remove redundant button handling code ---
    // We'll no longer manually extract buttons or create button objects here.
    // Instead, we'll let blockBuilder's parseMessage handle this for us.
    // Just initialize an empty array to track buttons found later.
    let buttons = [];
    // --- END EDIT ---
    
    // Process duplicate detection as before
    // ... existing duplicate detection code ...

    // Get valid channel ID and thread timestamp
    const channelId = getChannelId(args, threadState);
    const threadTimestamp = getThreadTs(args, threadState);
    
    // Validate channel
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    console.log(`Using channel ID: ${channelId}`);
    console.log(`Using thread timestamp: ${threadTimestamp || 'none (new thread)'}`);
    
    // Generate a unique callback ID for this button set if not provided
    const callbackId = args.callbackId || `buttons_${Date.now()}`;
    
    // Generate a unique prefix for action IDs if needed
    const actionPrefix = args.actionPrefix || callbackId;
    
    // --- START EDIT: Let parseMessage handle button creation ---
    // Format the message text using our shared utility
    // parseMessage in blockBuilder.js will handle the #buttons syntax
    console.log('Calling formatMessageText to parse message including potential #buttons syntax');
    const formattedMessage = await formatMessageText(text);
    
    // Check if there are buttons defined in the BlockBuilder syntax
    // This is now the ONLY way buttons are created
    if (formattedMessage.blocks) {
      // Find any actions blocks containing buttons
      const actionsBlocks = formattedMessage.blocks.filter(block => 
        block.type === 'actions' && block.elements?.some(el => el.type === 'button')
      );
      
      if (actionsBlocks.length > 0) {
        console.log(`✅ Found ${actionsBlocks.length} actions block(s) with buttons from BlockBuilder parsing`);
        
        // Extract button info from all actions blocks for our registry
        let allButtons = [];
        actionsBlocks.forEach((actionsBlock, blockIndex) => {
          if (actionsBlock.elements) {
            const blockButtons = actionsBlock.elements
              .filter(element => element.type === 'button')
              .map(button => ({
                text: button.text.text,
                value: button.value || `button_${blockIndex}_${allButtons.length + 1}`,
                style: button.style,
                url: button.url,
                type: button.url ? 'link' : 'action'
              }));
            
            allButtons = [...allButtons, ...blockButtons];
          }
        });
        
        // Store all found buttons for later reference
        buttons = allButtons;
        console.log(`✅ Found a total of ${buttons.length} buttons from BlockBuilder parsing`);
      }
    }
    // --- END EDIT ---
    
    // --- START EDIT: Remove manual button actions block creation ---
    // We don't need to create an actions block manually anymore
    // blockBuilder.js will handle that via parseMessage
    // --- END EDIT ---
    
    // Prepare the message parameters
    const messageParams = {
      channel: channelId,
      text: " ", // Empty text to prevent duplication
    };
    
    // --- START EDIT: Simplify attachment/blocks handling ---
    // Just use the blocks and attachments that parseMessage created
    if (formattedMessage.attachments) {
      messageParams.attachments = formattedMessage.attachments;
    }
    
    if (formattedMessage.blocks) {
      messageParams.blocks = formattedMessage.blocks;
    }
    // --- END EDIT ---
    
    // Add thread_ts if needed
    if (threadTimestamp) {
      messageParams.thread_ts = threadTimestamp;
    }
    
    // Clean and process the message using our shared utility
    const cleanedMessage = cleanAndProcessMessage(messageParams);
    
    // Log the final message structure
    logMessageStructure(cleanedMessage);
    
    // Send the message
    const response = await getSlackClient().chat.postMessage(cleanedMessage);
    
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
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
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
  createButtonMessage
}; 