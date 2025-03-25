// Tool for updating interactive message buttons
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Updates a message with buttons to show which option was selected
 * 
 * @param {Object} args - Arguments for updating the button message
 * @param {string} args.messageTs - Message timestamp to update
 * @param {string} args.selectedValue - The value of the selected button
 * @param {string} [args.channel] - Optional channel ID (defaults to context channel)
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

    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Extract parameters with validation
    let messageTs = args.messageTs;
    const selectedValue = args.selectedValue;
    const channelId = args.channel || context?.channelId;
    
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
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // First, get the current message to preserve its structure
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
    
    // Clone the message parts we'll modify
    const updatedMessage = {
      text: originalMessage.text || " ",
      blocks: originalMessage.blocks ? JSON.parse(JSON.stringify(originalMessage.blocks)) : [],
      attachments: originalMessage.attachments ? JSON.parse(JSON.stringify(originalMessage.attachments)) : []
    };
    
    // Find and update the buttons in blocks or attachments
    let updated = false;
    
    // Process blocks directly in the message
    if (updatedMessage.blocks && updatedMessage.blocks.length > 0) {
      // Look for action blocks that contain buttons
      for (let i = 0; i < updatedMessage.blocks.length; i++) {
        const block = updatedMessage.blocks[i];
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
    
    // Process buttons in attachments
    if (!updated && updatedMessage.attachments && updatedMessage.attachments.length > 0) {
      // Look through all attachments
      for (let i = 0; i < updatedMessage.attachments.length; i++) {
        const attachment = updatedMessage.attachments[i];
        
        // Check for blocks within attachments
        if (attachment.blocks && attachment.blocks.length > 0) {
          for (let j = 0; j < attachment.blocks.length; j++) {
            const block = attachment.blocks[j];
            if (block.type === 'actions' && block.elements) {
              // Go through all button elements
              for (let k = 0; k < block.elements.length; k++) {
                const element = block.elements[k];
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
      }
    }
    
    // If no blocks or buttons found, add a response section to the message
    if (!updated) {
      console.log('⚠️ No button blocks found, adding selection text to message');
      
      // Add a new section showing the selection
      const newSection = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✓ Option selected: *${selectedValue}*`
        }
      };
      
      // Add to blocks if they exist, otherwise create blocks
      if (updatedMessage.blocks && updatedMessage.blocks.length > 0) {
        updatedMessage.blocks.push(newSection);
      } else {
        updatedMessage.blocks = [newSection];
      }
    }
    
    // Update the message
    const updateResponse = await slackClient.chat.update({
      channel: channelId,
      ts: messageTs,
      text: updatedMessage.text,
      blocks: updatedMessage.blocks,
      attachments: updatedMessage.attachments
    });
    
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

module.exports = {
  updateButtonMessage
}; 