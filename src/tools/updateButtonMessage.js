// Tool for updating button messages
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Updates a button message to highlight the selected option and disable other buttons
 * 
 * @param {Object} args - Arguments for updating the button message
 * @param {string} args.messageTs - Timestamp of the button message to update
 * @param {string} args.selectedValue - Value of the selected button
 * @param {string} args.callbackId - Callback ID of the button set (optional)
 * @param {string} args.additionalText - Text to add indicating selection (optional)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of updating the message
 */
async function updateButtonMessage(args, threadState) {
  try {
    const { messageTs, selectedValue, callbackId, additionalText } = args;
    
    if (!messageTs || !selectedValue) {
      throw new Error('Both messageTs and selectedValue are required');
    }
    
    // Get channel from thread state
    const channelId = threadState.context.channelId;
    if (!channelId) {
      throw new Error('Channel ID not found in thread context');
    }
    
    // Find the original button message in the registry
    const buttonRegistry = threadState.buttonRegistry || {};
    let originalButtons = [];
    let buttonInfo = null;
    
    // Look for the specific button set in the registry
    if (callbackId && buttonRegistry[callbackId]) {
      buttonInfo = buttonRegistry[callbackId];
      originalButtons = buttonInfo.buttons || [];
    } else {
      // If no callbackId, check all registry entries for this messageTs
      for (const [regCallbackId, regButtonInfo] of Object.entries(buttonRegistry)) {
        if (regButtonInfo.messageTs === messageTs) {
          buttonInfo = regButtonInfo;
          originalButtons = regButtonInfo.buttons || [];
          break;
        }
      }
    }
    
    if (!buttonInfo) {
      console.log(`Button message with timestamp ${messageTs} not found in registry, will use direct Slack API`);
    }
    
    // Get the original message to preserve its content
    const slackClient = getSlackClient();
    const originalMessage = await slackClient.conversations.history({
      channel: channelId,
      latest: messageTs,
      limit: 1,
      inclusive: true
    });
    
    if (!originalMessage.ok || !originalMessage.messages || originalMessage.messages.length === 0) {
      throw new Error('Could not retrieve original message');
    }
    
    // Get the original message content
    const original = originalMessage.messages[0];
    
    // If we don't have buttons in registry, try to parse them from the original message
    if (!originalButtons.length && original.blocks) {
      try {
        // Find action blocks with buttons
        for (const block of original.blocks) {
          if (block.type === 'actions' && block.elements && block.elements.length > 0) {
            // Extract button info from elements
            originalButtons = block.elements.map(element => {
              if (element.type === 'button') {
                return {
                  text: element.text?.text || 'Button',
                  value: element.value || '',
                  action_id: element.action_id || ''
                };
              }
              return null;
            }).filter(Boolean);
            break;
          }
        }
      } catch (parseError) {
        console.log(`Error parsing buttons from original message: ${parseError.message}`);
      }
    }
    
    // Create a deep copy of the original blocks to modify
    let updatedBlocks = JSON.parse(JSON.stringify(original.blocks || []));
    
    // Create updated buttons with selected one highlighted and others disabled
    const updatedButtonElements = originalButtons.map(button => {
      if (button.value === selectedValue) {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `✅ ${button.text.replace(/^✅\s+/, '')}`, // Add checkmark but avoid duplicates
            emoji: true
          },
          value: button.value,
          action_id: button.action_id,
          style: 'primary'
        };
      } else {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: button.text.replace(/^✅\s+/, ''), // Remove any existing checkmark
            emoji: true
          },
          value: button.value,
          action_id: button.action_id,
          confirm: {
            title: {
              type: "plain_text",
              text: "Are you sure?",
              emoji: true
            },
            text: {
              type: "mrkdwn",
              text: "You've already selected a different option."
            },
            confirm: {
              type: "plain_text",
              text: "Change my selection",
              emoji: true
            },
            deny: {
              type: "plain_text",
              text: "Keep my current selection",
              emoji: true
            }
          }
        };
      }
    });
    
    // Find and update the actions block that contains buttons
    let actionsBlockFound = false;
    for (let i = 0; i < updatedBlocks.length; i++) {
      if (updatedBlocks[i].type === 'actions') {
        updatedBlocks[i].elements = updatedButtonElements;
        actionsBlockFound = true;
        break;
      }
    }
    
    // If no actions block found, add one
    if (!actionsBlockFound && updatedButtonElements.length > 0) {
      updatedBlocks.push({
        type: 'actions',
        elements: updatedButtonElements
      });
    }
    
    // If we want to add text about the selection, find the main text block to modify
    // or add a new context block at the end
    if (additionalText) {
      // Create a new context block for the selection
      updatedBlocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: additionalText
          }
        ]
      });
    }
    
    // Ensure there's a text field for the plain message (required by Slack)
    let messageText = 'Updated message';
    // Try to extract text from header or section blocks
    for (const block of updatedBlocks) {
      if (block.type === 'header' && block.text) {
        messageText = block.text.text;
        break;
      } else if (block.type === 'section' && block.text) {
        messageText = block.text.text;
        break;
      }
    }
    
    // Update the message directly with the modified blocks
    const updateOptions = {
      channel: channelId,
      ts: messageTs,
      text: messageText, // Important: Slack requires a non-empty text field
      blocks: updatedBlocks
    };
    
    // Update the message
    const response = await slackClient.chat.update(updateOptions);
    
    // Return the result
    return {
      ok: response.ok,
      ts: response.ts,
      channel: response.channel,
      updated: true
    };
  } catch (error) {
    logError('Error updating button message', error, { args });
    throw error;
  }
}

module.exports = {
  updateButtonMessage
}; 