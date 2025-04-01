// Tool for updating interactive message buttons
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const { 
  normalizeColor, 
  formatMessageText, 
  cleanAndProcessMessage, 
  getChannelId, 
  logMessageStructure 
} = require('../toolUtils/messageFormatUtils');

/**
 * Updates a message with buttons to show which option was selected
 * 
 * @param {Object} args - Arguments for updating the button message
 * @param {string} args.messageTs - Message timestamp to update
 * @param {string} args.selectedValue - The value of the selected button
 * @param {string} [args.buttonText] - Optional explicit button text to use instead of searching
 * @param {string} [args.channel] - Optional channel ID (defaults to context channel)
 * @param {string} [args.color] - Optional color for the attachment (defaults to 'good')
 * @param {string} [args.text] - Optional text to replace the original message text
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
      'messageTs', 'selectedValue', 'buttonText', 'channel', 'color', 'text'
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
    // If buttonText is provided, use it; otherwise, will be found in the message
    let selectedButtonText = args.buttonText || selectedValue;
    const channelId = getChannelId(args, threadState);
    const color = args.color || 'good';
    const text = args.text; // Optional text to replace the original message
    
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
        buttonText: selectedButtonText,
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
        name: 'loading' // Loading indicator emoji
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
    
    // Add more detailed logging of message structure for debugging
    console.log('⚙️ Original message structure:', JSON.stringify({
      has_blocks: !!originalMessage.blocks,
      blocks_length: originalMessage.blocks?.length || 0,
      has_attachments: !!originalMessage.attachments,
      attachments_length: originalMessage.attachments?.length || 0
    }));
    
    // Log a more detailed structure for deeper analysis
    console.log('📊 Detailed message structure:');
    if (originalMessage.blocks && originalMessage.blocks.length > 0) {
      console.log(`- Top level blocks types: ${originalMessage.blocks.map(b => b.type).join(', ')}`);
    }
    
    // Improved button finding algorithm - more robust search through message structure
    let foundActionsBlock = false;
    let originalBlocks = [];
    let originalAttachments = [];
    
    // Function to recursively search for buttons in a block structure
    function findButtonsInBlock(block) {
      if (!block) return null;
      
      // Direct check for actions block
      if (block.type === 'actions' && block.elements) {
        const buttonElement = block.elements.find(el => 
          el.type === 'button' && el.value === selectedValue
        );
        
        if (buttonElement) {
          return {
            block: block,
            buttonElement: buttonElement
          };
        }
      }
      
      // Check inside elements of rich_text blocks
      if (block.type === 'rich_text' && block.elements) {
        for (const element of block.elements) {
          if (element.elements) {
            const buttonElement = element.elements.find(el => 
              el.type === 'button' && el.value === selectedValue
            );
            
            if (buttonElement) {
              return {
                block: block,
                buttonElement: buttonElement,
                isRichText: true
              };
            }
          }
        }
      }
      
      return null;
    }
    
    // If buttonText wasn't provided, try to find it in the message
    if (!args.buttonText) {
      // If we have attachments, first search there as buttons are often in attachments
      if (originalMessage.attachments && originalMessage.attachments.length > 0) {
        console.log(`🔍 Searching through ${originalMessage.attachments.length} attachments for button text`);
        
        for (const attachment of originalMessage.attachments) {
          if (attachment.blocks && attachment.blocks.length > 0) {
            for (const block of attachment.blocks) {
              if (block.type === 'actions' && block.elements) {
                const clickedButton = block.elements.find(el => 
                  el.type === 'button' && el.value === selectedValue
                );
                
                if (clickedButton && clickedButton.text && clickedButton.text.text) {
                  selectedButtonText = clickedButton.text.text;
                  console.log(`✅ Found button text in attachment: "${selectedButtonText}"`);
                  break;
                }
              }
            }
          }
        }
      }
      
      // If we still don't have button text, check top-level blocks
      if (selectedButtonText === selectedValue && originalMessage.blocks && originalMessage.blocks.length > 0) {
        for (const block of originalMessage.blocks) {
          const result = findButtonsInBlock(block);
          if (result && result.buttonElement.text && result.buttonElement.text.text) {
            selectedButtonText = result.buttonElement.text.text;
            console.log(`✅ Found button text in block: "${selectedButtonText}"`);
            break;
          }
        }
      }
    }
    
    console.log(`🔘 Using button text: "${selectedButtonText}"`);
    
    // Create deep copies of the message structure
    if (originalMessage.attachments && originalMessage.attachments.length > 0) {
      originalAttachments = JSON.parse(JSON.stringify(originalMessage.attachments));
    }
    
    if (originalMessage.blocks && originalMessage.blocks.length > 0) {
      originalBlocks = JSON.parse(JSON.stringify(originalMessage.blocks));
    }
    
    // Now search and replace just the actions block
    // If we have attachments, first search there as buttons are often in attachments
    if (originalMessage.attachments && originalMessage.attachments.length > 0) {
      console.log(`🔍 Searching through ${originalMessage.attachments.length} attachments for actions block`);
      
      for (let i = 0; i < originalAttachments.length; i++) {
        const attachment = originalAttachments[i];
        
        if (attachment.blocks && attachment.blocks.length > 0) {
          for (let j = 0; j < attachment.blocks.length; j++) {
            const block = attachment.blocks[j];
            
            // Check if this is an actions block
            if (block.type === 'actions') {
              console.log(`✅ Found actions block in attachment ${i+1}, block ${j+1}`);
              
              // Find the button with matching value
              if (block.elements && block.elements.length > 0) {
                const clickedButton = block.elements.find(el => 
                  el.type === 'button' && el.value === selectedValue
                );
                
                if (clickedButton) {
                  console.log(`✅ Found clicked button in actions block`);
                  
                  // Replace ONLY this actions block with a confirmation section
                  attachment.blocks[j] = {
                    type: 'section',
                    text: {
                      type: 'mrkdwn',
                      text: `✅ Opção selecionada: *${selectedButtonText}*`
                    }
                  };
                  
                  foundActionsBlock = true;
                  break;
                }
              }
            }
          }
          
          if (foundActionsBlock) break;
        }
      }
    }
    
    // If we didn't find actions in attachments, look at top-level blocks
    if (!foundActionsBlock && originalMessage.blocks && originalMessage.blocks.length > 0) {
      console.log(`🔍 Searching through ${originalMessage.blocks.length} top-level blocks`);
      
      for (let i = 0; i < originalBlocks.length; i++) {
        const block = originalBlocks[i];
        
        const result = findButtonsInBlock(block);
        if (result) {
          console.log(`✅ Found button in block ${i+1}`);
          
          // Replace ONLY this block with a confirmation section
          originalBlocks[i] = {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ Opção selecionada: *${selectedButtonText}*`
            }
          };
          
          foundActionsBlock = true;
          break;
        }
      }
    }
    
    // If we still haven't found the actions block, use a failover approach - add a new attachment
    if (!foundActionsBlock) {
      console.log('⚠️ Could not find the actions block. Using failover approach by adding a new section.');
      
      // Instead of adding a new attachment, let's add to an existing attachment if possible
      if (originalAttachments.length > 0) {
        // Find the last attachment with blocks
        for (let i = originalAttachments.length - 1; i >= 0; i--) {
          if (originalAttachments[i].blocks && Array.isArray(originalAttachments[i].blocks)) {
            // Add the confirmation to this attachment's blocks
            originalAttachments[i].blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ Opção selecionada: *${selectedButtonText}*`
              }
            });
            console.log(`✅ Added selection confirmation to existing attachment ${i+1}`);
            foundActionsBlock = true;
            break;
          }
        }
      }
      
      // If we still couldn't find a place, create a new attachment
      if (!foundActionsBlock) {
        const selectionAttachment = {
          color: formattedColor,
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ Opção selecionada: *${selectedButtonText}*`
            }
          }]
        };
        
        // Keep existing attachments and add our new one
        if (!originalAttachments.length) {
          originalAttachments = originalMessage.attachments ? 
            JSON.parse(JSON.stringify(originalMessage.attachments)) : [];
        }
        
        originalAttachments.push(selectionAttachment);
        console.log('✅ Added new attachment with selection confirmation');
        foundActionsBlock = true;
      }
    }

    // Create update parameters for Slack API call
    const updateParams = {
      channel: channelId,
      ts: messageTs,
      text: originalMessage.text || " " // Preserve original text
    };

    // Prepare attachments or blocks for the API call
    if (originalAttachments.length > 0) {
      updateParams.attachments = JSON.stringify(originalAttachments);
      delete updateParams.blocks;
    } else if (originalBlocks.length > 0) {
      updateParams.blocks = JSON.stringify(originalBlocks);
      delete updateParams.attachments;
    }
    
    // Log update parameters for debugging
    console.log('📋 Update params:', JSON.stringify(updateParams, null, 2));
    
    try {
      // Update the message
      const updateResponse = await slackClient.chat.update(updateParams);
      
      console.log('✅ Message updated successfully');
      
      // Remove the loading reaction if it exists
      try {
        await slackClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'loading'
        });
      } catch (reactionError) {
        console.log(`⚠️ Could not remove reaction: ${reactionError.message}`);
      }
      
      // Try to add a success reaction
      try {
        await slackClient.reactions.add({
          channel: channelId,
          timestamp: messageTs,
          name: 'white_check_mark' // Success indicator emoji
        });
      } catch (reactionError) {
        // Non-critical error, just log it
        console.log(`⚠️ Could not add success reaction: ${reactionError.message}`);
      }
      
      // Add information to thread state for LLM context
      if (threadState) {
        // Store information about the selected button for the LLM
        threadState.setMetadata('selectedButton', {
          value: selectedValue,
          text: selectedButtonText,
          timestamp: Date.now()
        });
        
        // Register this update to prevent duplicate updates
        threadState.updatedButtons = threadState.updatedButtons || {};
        threadState.updatedButtons[`${messageTs}_${selectedValue}`] = {
          timestamp: Date.now()
        };
        
        // Add feedback for the LLM - only add if not already present
        if (!threadState.llmFeedback) {
          threadState.llmFeedback = [];
        }
        
        // Check if we already have a feedback item for this button
        const existingFeedback = threadState.llmFeedback.find(item => 
          item.type === 'buttonSelected' && 
          item.value === selectedValue
        );
        
        if (!existingFeedback) {
          threadState.llmFeedback.push({
            type: 'buttonSelected',
            message: `The user selected the "${selectedButtonText}" button with value "${selectedValue}".`,
            timestamp: new Date().toISOString(),
            value: selectedValue
          });
        }
      }
      
      return {
        updated: true,
        messageTs: messageTs,
        channelId,
        selectedValue,
        buttonText: selectedButtonText,
        response: updateResponse
      };
    } catch (updateError) {
      console.error(`Error updating message: ${updateError.message}`);
      
      // Try to remove the loading reaction
      try {
        await slackClient.reactions.remove({
          channel: channelId,
          timestamp: messageTs,
          name: 'loading'
        });
      } catch (reactionError) {
        console.log(`⚠️ Could not remove reaction: ${reactionError.message}`);
      }
      
      return {
        updated: false,
        messageTs: messageTs,
        channelId,
        selectedValue,
        buttonText: selectedButtonText,
        error: updateError.message
      };
    }
  } catch (error) {
    console.error(`Error in updateButtonMessage: ${error.message}`);
    
    // If threadState is available, record the error
    if (threadState) {
      threadState.errors = threadState.errors || [];
      threadState.errors.push({
        tool: 'updateButtonMessage',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    return {
      updated: false,
      messageTs,
      channelId,
      selectedValue,
      error: error.message
    };
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
  finalizeButtonInteraction
}; 