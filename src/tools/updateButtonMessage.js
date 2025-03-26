// Tool for updating interactive message buttons
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
 * Updates a message with buttons to show which option was selected
 * 
 * @param {Object} args - Arguments for updating the button message
 * @param {string} args.messageTs - Message timestamp to update
 * @param {string} args.selectedValue - The value of the selected button
 * @param {string} [args.channel] - Optional channel ID (defaults to context channel)
 * @param {string} [args.color] - Optional color for the attachment (defaults to 'good')
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of updating the message
 */
async function updateButtonMessage(args, threadState) {
  try {
    console.log('⚠️ updateButtonMessage args:', JSON.stringify(args, null, 2));
    
    // Handle potential nested parameters structure 
    if (args.parameters && !args.messageTs && !args.selectedValue) {
      console.log('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Filter out non-standard fields
    const validFields = [
      'messageTs', 'selectedValue', 'channel', 'color'
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

    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Extract parameters with validation
    let messageTs = args.messageTs;
    const selectedValue = args.selectedValue;
    const channelId = args.channel || context?.channelId;
    const color = args.color || 'good';
    
    // Normalize the color
    const formattedColor = normalizeColor(color);
    console.log(`Using color: ${formattedColor}`);
    
    // Validate essential parameters
    if (!messageTs || !selectedValue) {
      throw new Error('Both messageTs and selectedValue are required');
    }
    
    // Handle timestamp format issues - sometimes the LLM might use the button actionPrefix instead
    // If it's not in the right format (doesn't contain a '.'), try to find the actual message ts
    if (!messageTs.includes('.') && threadState.buttonRegistry) {
      console.log(`⚠️ messageTs format issue, attempting to find correct messageTs from: ${messageTs}`);
      
      // Look through the button registry to find a match
      for (const prefix in threadState.buttonRegistry) {
        // Check if the prefix is contained in the provided messageTs
        if (messageTs.includes(prefix) || prefix.includes(messageTs)) {
          messageTs = threadState.buttonRegistry[prefix].messageTs;
          console.log(`✅ Found matching message timestamp: ${messageTs}`);
          break;
        }
      }
    }
    
    // If we still don't have a valid messageTs and have action context, use that
    if ((!messageTs || !messageTs.includes('.')) && context?.messageTs) {
      console.log(`⚠️ Using messageTs from context: ${context.messageTs}`);
      messageTs = context.messageTs;
    }
    
    // Final validation after attempted fixes
    if (!messageTs || !messageTs.includes('.')) {
      throw new Error(`Invalid message timestamp format: ${messageTs}`);
    }
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    // IMPORTANT: Check if this button has already been updated to prevent loops
    // Use messageTs + selectedValue as a unique key
    const updateKey = `${messageTs}_${selectedValue}`;
    if (threadState.updatedButtons && threadState.updatedButtons[updateKey]) {
      console.log(`⚠️ Button with key ${updateKey} has already been updated. Preventing duplicate update.`);
      return {
        updated: true,
        messageTs: messageTs,
        channelId,
        selectedValue,
        alreadyUpdated: true,
        message: "This button has already been updated. Prevented duplicate update."
      };
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // First, add visual feedback that the button was clicked
    try {
      // Add a temporary loading message to indicate processing
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'hourglass_flowing_sand' // Loading indicator emoji
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      console.log(`⚠️ Could not add reaction: ${reactionError.message}`);
    }
    
    // Get the current message to preserve its structure
    const messageResponse = await slackClient.conversations.history({
      channel: channelId,
      latest: messageTs,
      inclusive: true,
      limit: 1
    });
    
    if (!messageResponse.ok || !messageResponse.messages || messageResponse.messages.length === 0) {
      console.log('⚠️ Failed to retrieve the original message');
      throw new Error(`Could not find original message to update at ${messageTs}`);
    }
    
    // Get the original message
    const originalMessage = messageResponse.messages[0];
    
    // Check if this is a plain text message without blocks or attachments
    // This might happen when we're dealing with a user's message instead of a bot message
    if ((!originalMessage.blocks || originalMessage.blocks.length === 0) &&
        (!originalMessage.attachments || originalMessage.attachments.length === 0)) {
      console.log('⚠️ This appears to be a plain text message, not a bot message with buttons.');
      
      // Remove the loading reaction
      try {
        await slackClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'hourglass_flowing_sand'
        });
      } catch (reactionError) {
        // Non-critical error, just log it
        console.log(`⚠️ Could not remove reaction: ${reactionError.message}`);
      }
      
      // Return gracefully without modifying the message
      return {
        updated: false,
        messageTs: messageTs,
        channelId,
        selectedValue,
        error: "Cannot update non-bot messages or messages without blocks/attachments"
      };
    }
    
    // Clone the message parts we'll modify
    const updatedMessage = {
      text: "", // Empty text to prevent duplication
      attachments: []
    };
    
    // Get the original color from attachments if available
    let originalColor = formattedColor; // Default
    if (originalMessage.attachments && originalMessage.attachments.length > 0) {
      originalColor = originalMessage.attachments[0].color || formattedColor;
    }
    
    // Find and update the buttons in blocks or attachments
    let blocks = [];
    let updated = false;
    
    // Process existing blocks in the message or attachments
    if (originalMessage.blocks && originalMessage.blocks.length > 0) {
      blocks = JSON.parse(JSON.stringify(originalMessage.blocks));
    } else if (originalMessage.attachments && originalMessage.attachments.length > 0 && 
               originalMessage.attachments[0].blocks) {
      blocks = JSON.parse(JSON.stringify(originalMessage.attachments[0].blocks));
    }
    
    // Update buttons in the blocks
    if (blocks.length > 0) {
      // Look for action blocks that contain buttons
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === 'actions' && block.elements) {
          // Go through all button elements
          for (let j = 0; j < block.elements.length; j++) {
            const element = block.elements[j];
            if (element.type === 'button') {
              // If this is the selected button, mark it
              if (element.value === selectedValue) {
                // Update button style and text
                element.style = 'primary';
                
                // Add ✓ to text if it doesn't already have it
                if (!element.text.text.includes('✓')) {
                  element.text.text = `✓ ${element.text.text}`;
                }
                
                updated = true;
              } else {
                // For other buttons, reset style or gray them out
                element.style = 'default';
                
                // If text has checkmark, remove it
                if (element.text.text.includes('✓')) {
                  element.text.text = element.text.text.replace('✓ ', '');
                }
                
                // Disable other buttons
                element.disabled = true;
              }
            }
          }
        }
      }
    }
    
    // If no buttons were found or updated, add a selection text
    if (!updated) {
      console.log('⚠️ No button blocks found, adding selection text to message');
      
      // Find the specific button text if available in registry
      let buttonText = selectedValue;
      if (threadState.buttonRegistry) {
        // Look through all registry entries for a matching value
        for (const prefix in threadState.buttonRegistry) {
          const registry = threadState.buttonRegistry[prefix];
          if (registry.buttons) {
            const matchingButton = registry.buttons.find(b => b.value === selectedValue);
            if (matchingButton && matchingButton.text) {
              buttonText = matchingButton.text;
              break;
            }
          }
        }
      }
      
      // Just preserve the existing blocks for title and text information
      // and add a new section showing the selection
      const newSection = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✓ Opção selecionada: *${buttonText}*`
        }
      };
      
      // If we have preserved blocks from the original content, examine them
      // to avoid duplicating content
      if (blocks.length > 0) {
        // If the blocks already have our selection text, don't add it again
        const selectionExists = blocks.some(block => 
          block.type === 'section' && 
          block.text && 
          block.text.text && 
          block.text.text.includes('Opção selecionada')
        );
        
        if (!selectionExists) {
          blocks.push(newSection);
        }
      } else {
        blocks = [newSection];
      }
    }
    
    // Update message using proper attachment structure to maintain color bar
    updatedMessage.attachments = [{
      color: originalColor,
      blocks: blocks,
      fallback: "Updated button message"
    }];
    
    // Update the message
    const updateResponse = await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      text: updatedMessage.text,
      attachments: updatedMessage.attachments
    });
    
    // Store that we've updated this button to prevent duplicate updates
    if (!threadState.updatedButtons) {
      threadState.updatedButtons = {};
    }
    threadState.updatedButtons[updateKey] = {
      timestamp: new Date().toISOString(),
      selectedValue
    };
    
    // Remove the loading reaction
    try {
      await slackClient.reactions.remove({
        channel: channelId,
        timestamp: messageTs,
        name: 'hourglass_flowing_sand'
      });
      
      // Add a checkmark reaction to indicate completion
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'white_check_mark'
      });
    } catch (reactionError) {
      // Non-critical error, just log it
      console.log(`⚠️ Could not update reactions: ${reactionError.message}`);
    }
    
    // Return the result
    return {
      updated: updateResponse.ok,
      messageTs: updateResponse.ts,
      channelId,
      selectedValue
    };
  } catch (error) {
    logError('Error updating button message', error, { args });
    throw error;
  }
}

/**
 * Signals that the button interaction has been processed
 * This can be used to finalize the interaction and prevent repeated updates
 * 
 * @param {Object} args - Arguments for finalizing the button interaction 
 * @param {string} args.messageTs - Message timestamp that was updated
 * @param {string} args.selectedValue - The value that was selected
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of finalizing the interaction
 */
async function finalizeButtonInteraction(args, threadState) {
  try {
    // Extract parameters
    const { messageTs, selectedValue } = args;
    
    // Store that this interaction has been finalized
    const updateKey = `${messageTs}_${selectedValue}`;
    if (!threadState.updatedButtons) {
      threadState.updatedButtons = {};
    }
    
    threadState.updatedButtons[updateKey] = {
      timestamp: new Date().toISOString(),
      selectedValue,
      finalized: true
    };
    
    return {
      success: true,
      messageTs,
      selectedValue,
      message: "Button interaction has been finalized and will not be processed again"
    };
  } catch (error) {
    logError('Error finalizing button interaction', error, { args });
    throw error;
  }
}

module.exports = {
  updateButtonMessage,
  finalizeButtonInteraction,
  normalizeColor
}; 