/**
 * Button update functionality
 * Handles updating button messages in Slack
 */

const { getSlackClient } = require('./slackClient');
const logger = require('./toolUtils/logger');

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
        
        logger.info(`Updating button message - selected: ${selectedValue}`);
        logger.detail(`Button details:`, {
            action_id: clickedActionId,
            message_ts: messageTs,
            channel: channelId
        });
        
        // CRITICAL FIX: The original message we want to update should be available directly in the payload
        // This is the message that contains the buttons, not the one we need to fetch
        let originalMessage = null;
        
        // Check if the payload directly contains the message (most reliable)
        if (payload.message) {
            logger.info(`Using message directly from payload`);
            originalMessage = payload.message;
        } else {
            // Fallback to fetching the message - MAKE SURE we get the right one
            logger.warn(`Message not in payload, fetching from Slack API with ts=${messageTs}`);
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
            
            originalMessage = originalMessageResult.messages[0];
        }
        
        // Log the message structure
        logger.logMessageStructure(originalMessage, 'ORIGINAL_MESSAGE');
        
        // Check if this is actually our message with buttons
        const hasActionButtons = (
            (originalMessage.attachments && originalMessage.attachments.some(a => 
                a.blocks && a.blocks.some(b => b.type === 'actions')
            )) || 
            (originalMessage.blocks && originalMessage.blocks.some(b => b.type === 'actions'))
        );
        
        if (!hasActionButtons) {
            logger.error(`The message we're trying to update doesn't contain action buttons.`);
            logger.debug(`Full message structure:`, originalMessage);
            return {
                updated: false,
                error: "The message doesn't contain action buttons",
                actionsBlockFound: false
            };
        }
        
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
        
        // Create the replacement context block with user avatar and selection
        const contextBlock = {
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

        // Initialize update parameters
        let updateParams = {
            channel: channelId,
            ts: messageTs,
            text: 'Selection made'
        };
        
        // Track whether we found and updated any actions blocks
        let actionsBlockFound = false;
        
        // Case 1: If message has direct blocks, update them
        if (originalMessage.blocks && originalMessage.blocks.length > 0) {
            logger.detail(`Processing direct blocks (${originalMessage.blocks.length})`);
            
            const updatedBlocks = originalMessage.blocks.map(block => {
                if (block.type === 'actions') {
                    actionsBlockFound = true;
                    return contextBlock;
                }
                return block;
            });
            
            updateParams.blocks = updatedBlocks;
        }
        
        // Case 2: If message has attachments with blocks, update those
        if (originalMessage.attachments && originalMessage.attachments.length > 0) {
            logger.detail(`Processing attachments (${originalMessage.attachments.length})`);
            
            const updatedAttachments = originalMessage.attachments.map(attachment => {
                if (attachment.blocks && attachment.blocks.length > 0) {
                    const updatedBlocks = attachment.blocks.map(block => {
                        if (block.type === 'actions') {
                            actionsBlockFound = true;
                            return contextBlock;
                        }
                        return block;
                    });
                    
                    return {
                        ...attachment,
                        blocks: updatedBlocks
                    };
                }
                return attachment;
            });
            
            updateParams.attachments = updatedAttachments;
        }
        
        // Log warning if no actions block found
        if (!actionsBlockFound) {
            logger.warn(`No actions block found in the message - button update may not work correctly`);
            logger.debug(`Full message structure for debugging:`, originalMessage);
        }
        
        logger.detail(`Sending update with params:`, {
            channel: updateParams.channel,
            ts: updateParams.ts,
            has_blocks: !!updateParams.blocks,
            block_count: updateParams.blocks?.length || 0,
            has_attachments: !!updateParams.attachments,
            attachment_count: updateParams.attachments?.length || 0
        });
        
        // Update the message
        const slackClient = getSlackClient();
        const updateResult = await slackClient.chat.update(updateParams);
        
        // Log result
        if (updateResult.ok) {
            logger.info(`Successfully updated message with selection`);
        } else {
            logger.error(`Failed to update message: ${updateResult.error}`);
        }
        
        // Return result
        return {
            updated: updateResult.ok,
            responseUrl,
            selectedValue,
            buttonText,
            messageTs,
            actionsBlockFound,
            error: updateResult.ok ? null : updateResult.error
        };
    } catch (error) {
        logger.error('Error updating button message:', error);
        
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