/**
 * Button update functionality
 * Handles updating button messages in Slack
 */

const { getSlackClient } = require('./slackClient');

/**
 * Updates a button message in Slack to reflect a selection
 * @param {Object} payload - The payload from the button interaction
 * @param {Object} threadContext - Thread context object
 * @returns {Promise<Object>} - Result of the update
 */
async function updateButtonMessage(payload, threadContext) {
    try {
        if (!payload || !payload.actions || !payload.actions[0]) {
            throw new Error('Invalid button payload');
        }

        // Extract key information
        const clickedActionId = payload.actions[0].action_id;
        const selectedValue = payload.actions[0].value;
        const buttonText = payload.actions[0].text?.text || selectedValue;
        const messageTs = payload.container.message_ts;
        const channelId = payload.channel.id;
        const responseUrl = payload.response_url;
        const userId = payload.user.id;
        
        console.log(`Updating button message - selected: ${selectedValue}`);
        
        // Get the original message
        const slackClient = getSlackClient();
        const originalMessageResult = await slackClient.conversations.history({
            channel: channelId,
            latest: messageTs,
            limit: 1,
            inclusive: true
        });
        
        if (!originalMessageResult.ok || !originalMessageResult.messages || originalMessageResult.messages.length === 0) {
            throw new Error(`Could not find original message: ${originalMessageResult.error || 'Unknown error'}`);
        }
        
        const originalMessage = originalMessageResult.messages[0];
        
        // Store the selection in thread context
        if (threadContext) {
            // Save the selected button info
            threadContext.setButtonState(clickedActionId, 'selected', {
                selectedValue,
                buttonText,
                messageTs,
                timestamp: new Date().toISOString()
            });
        }
        
        // Get workspace ID for avatar URL
        const workspaceId = process.env.SLACK_WORKSPACE_ID || 'T02RAEMPK';
        
        // Update the blocks to replace actions with a rich user context
        const updatedBlocks = originalMessage.blocks.map(block => {
            // Only modify actions blocks
            if (block.type === 'actions') {
                // Create a context block with user avatar and selection info
                return {
                    type: 'context',
                    elements: [
                        // User avatar image
                        {
                            type: 'image',
                            image_url: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`,
                            alt_text: `User ${userId}`
                        },
                        // Selection text with formatting
                        {
                            type: 'mrkdwn',
                            text: `*<@${userId}>* selected: *${buttonText}*`
                        }
                    ]
                };
            }
            
            // For non-action blocks, keep as is
            return block;
        });
        
        // Update the message
        const updateResult = await slackClient.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: updatedBlocks,
            text: 'Selection made'
        });
        
        // Return result
        return {
            updated: updateResult.ok,
            responseUrl,
            selectedValue,
            buttonText,
            messageTs,
            error: updateResult.ok ? null : updateResult.error
        };
    } catch (error) {
        console.error('Error updating button message:', error);
        
        // Return error result
        return {
            updated: false,
            error: error.message,
            payload
        };
    }
}

module.exports = {
    updateButtonMessage
}; 