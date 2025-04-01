/**
 * Button updater - handles updating button messages when clicked
 * This is NOT an LLM tool - it is called directly from the orchestrator
 */
const { getSlackClient } = require('./slackClient.js');
const { logError } = require('./errors.js');

/**
 * Updates a message containing buttons to show which option was selected
 * 
 * @param {Object} payload - The original button click payload from Slack
 * @param {Object} threadState - Current thread state for context
 * @returns {Promise<Object>} - Result of updating the message
 */
async function updateButtonMessage(payload, threadState) {
  try {
    // Extract key information from the payload
    const actionValue = payload.actions[0].value;
    const actionText = payload.actions[0].text?.text || actionValue;
    const channelId = payload.channel.id;
    const messageTs = payload.message.ts;
    
    console.log(`🔄 Updating button message: ${messageTs}`);
    console.log(`Button: "${actionText}" (${actionValue})`);
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // First, add visual loading feedback
    try {
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'loading'
      });
    } catch (error) {
      console.log(`⚠️ Could not add loading reaction: ${error.message}`);
      // Continue anyway - this is non-critical
    }
    
    // APPROACH 1: Get the original message directly from the payload
    // This has the advantage of getting the message structure exactly as Slack knows it
    const originalMessage = payload.message;
    
    // Log the structure for debugging
    console.log(`📊 Original message structure:`);
    console.log(`Has blocks: ${!!originalMessage.blocks}, Count: ${originalMessage.blocks?.length || 0}`);
    console.log(`Has attachments: ${!!originalMessage.attachments}, Count: ${originalMessage.attachments?.length || 0}`);
    
    if (originalMessage.blocks) {
      console.log(`Block types: ${originalMessage.blocks.map(b => b.type).join(', ')}`);
    }
    
    // Create deep copies of message components to avoid modifying originals
    let updatedBlocks = originalMessage.blocks ? JSON.parse(JSON.stringify(originalMessage.blocks)) : [];
    let updatedAttachments = originalMessage.attachments ? JSON.parse(JSON.stringify(originalMessage.attachments)) : [];
    
    // Track if we found and replaced the buttons
    let foundButtons = false;
    
    // APPROACH 2: Look directly in the actions list from the payload
    // This gives us the exact block ID that contained the button
    if (payload.actions && payload.actions.length > 0) {
      const actionId = payload.actions[0].action_id;
      const blockId = payload.actions[0].block_id;
      
      console.log(`🔍 Button action_id: ${actionId}, block_id: ${blockId}`);
      
      // If we have a block ID, search through all blocks to find a match
      if (blockId) {
        // Function to find and replace a block by ID
        const replaceBlockById = (blocks) => {
          if (!Array.isArray(blocks)) return false;
          
          for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].block_id === blockId) {
              console.log(`✅ Found block with matching ID: ${blockId}`);
              
              // Replace with confirmation section
              blocks[i] = {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `✅ Opção selecionada: *${actionText}*`
                }
              };
              return true;
            }
          }
          return false;
        };
        
        // Try to find in top-level blocks
        if (updatedBlocks.length > 0) {
          foundButtons = replaceBlockById(updatedBlocks);
        }
        
        // If not found, look in attachments
        if (!foundButtons && updatedAttachments.length > 0) {
          for (let i = 0; i < updatedAttachments.length && !foundButtons; i++) {
            if (updatedAttachments[i].blocks) {
              foundButtons = replaceBlockById(updatedAttachments[i].blocks);
            }
          }
        }
      }
    }
    
    // APPROACH 3: Search for 'actions' blocks containing buttons
    if (!foundButtons) {
      console.log(`🔍 Searching for actions blocks containing buttons...`);
      
      // Function to find and replace actions blocks
      const replaceActionsBlock = (blocks) => {
        if (!Array.isArray(blocks)) return false;
        
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          
          // Check if this is an actions block
          if (block.type === 'actions') {
            console.log(`✅ Found actions block at index ${i}`);
            
            // Check if it contains our button
            if (block.elements && Array.isArray(block.elements)) {
              const buttonIndex = block.elements.findIndex(
                el => el.type === 'button' && el.value === actionValue
              );
              
              if (buttonIndex !== -1) {
                console.log(`✅ Found matching button at index ${buttonIndex}`);
                
                // Replace the entire actions block with a confirmation
                blocks[i] = {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `✅ Opção selecionada: *${actionText}*`
                  }
                };
                return true;
              }
            }
          }
        }
        return false;
      };
      
      // Try to find in top-level blocks
      if (updatedBlocks.length > 0) {
        foundButtons = replaceActionsBlock(updatedBlocks);
      }
      
      // If not found, look in attachments
      if (!foundButtons && updatedAttachments.length > 0) {
        for (let i = 0; i < updatedAttachments.length && !foundButtons; i++) {
          if (updatedAttachments[i].blocks) {
            foundButtons = replaceActionsBlock(updatedAttachments[i].blocks);
          }
        }
      }
    }
    
    // APPROACH 4: Last resort, add a new section to the message
    if (!foundButtons) {
      console.log(`⚠️ Could not find button block. Adding confirmation section.`);
      
      // If we have attachments, add to the last one
      if (updatedAttachments.length > 0) {
        // Find the last attachment with blocks
        let targetAttachment = updatedAttachments[updatedAttachments.length - 1];
        
        // Make sure it has a blocks array
        if (!targetAttachment.blocks) {
          targetAttachment.blocks = [];
        }
        
        // Add the confirmation section
        targetAttachment.blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Opção selecionada: *${actionText}*`
          }
        });
        
        foundButtons = true;
      }
      // If we have blocks, add a new section at the end
      else if (updatedBlocks.length > 0) {
        updatedBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Opção selecionada: *${actionText}*`
          }
        });
        
        foundButtons = true;
      }
      // If we have neither, create a new attachment
      else {
        updatedAttachments.push({
          color: '#2EB67D', // Green
          blocks: [{
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ Opção selecionada: *${actionText}*`
            }
          }]
        });
        
        foundButtons = true;
      }
    }
    
    // Prepare the update parameters
    const updateParams = {
      channel: channelId,
      ts: messageTs,
      // Preserve original text if there was any
      text: originalMessage.text || " "
    };
    
    // Add blocks and/or attachments
    if (updatedBlocks.length > 0) {
      updateParams.blocks = updatedBlocks;
    }
    
    if (updatedAttachments.length > 0) {
      // Slack API expects attachments as JSON string
      updateParams.attachments = JSON.stringify(updatedAttachments);
    }
    
    console.log(`📤 Sending update to Slack API...`);
    
    // Update the message
    const updateResult = await slackClient.chat.update(updateParams);
    
    // Remove loading reaction and add a success indicator
    try {
      await slackClient.reactions.remove({
        channel: channelId,
        timestamp: messageTs,
        name: 'loading'
      });
      
      await slackClient.reactions.add({
        channel: channelId,
        timestamp: messageTs,
        name: 'white_check_mark'
      });
    } catch (error) {
      console.log(`⚠️ Error updating reactions: ${error.message}`);
      // Non-critical, continue
    }
    
    // Store information about the selection in thread state
    if (threadState) {
      // Record the button selection
      if (!threadState.buttonSelections) {
        threadState.buttonSelections = [];
      }
      
      threadState.buttonSelections.push({
        value: actionValue,
        text: actionText,
        timestamp: new Date().toISOString(),
        messageTs: messageTs
      });
      
      // Update last selection for easy access
      threadState.lastButtonSelection = {
        value: actionValue,
        text: actionText,
        timestamp: new Date().toISOString()
      };
      
      // IMPORTANT: Mark this button as already visually acknowledged
      // This tells the system not to generate another acknowledgment message
      threadState.buttonSelectionAlreadyAcknowledged = true;
      
      // Add to LLM feedback
      if (!threadState.llmFeedback) {
        threadState.llmFeedback = [];
      }
      
      // Only add if not already present
      const existingFeedback = threadState.llmFeedback.find(
        item => item.type === 'buttonSelected' && item.value === actionValue
      );
      
      if (!existingFeedback) {
        threadState.llmFeedback.push({
          type: 'buttonSelected',
          message: `The user selected the "${actionText}" button with value "${actionValue}".`,
          timestamp: new Date().toISOString(),
          value: actionValue
        });
      }
    }
    
    return {
      updated: true,
      messageTs,
      channelId,
      buttonValue: actionValue,
      buttonText: actionText
    };
  } catch (error) {
    console.error(`❌ Error updating button message: ${error.message}`);
    logError('Button update failed', error);
    
    return {
      updated: false,
      error: error.message
    };
  }
}

module.exports = {
  updateButtonMessage
}; 