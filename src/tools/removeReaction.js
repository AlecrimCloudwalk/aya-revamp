// Tool for removing emoji reactions from messages
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const { availableEmojis } = require('./addReaction.js');
const logger = require('../toolUtils/logger.js');


/**
 * Removes emoji reaction(s) from a message
 * 
 * @param {Object} args - Arguments for the reaction removal
 * @param {string|string[]} args.emoji - Emoji name(s) to remove (without colons). Can be a single string or an array of strings.
 * @param {string} args.messageTs - Timestamp of the message to remove reaction from (optional)
 * @param {string} args.message_ts - Alternative parameter name for messageTs (optional)
 * @param {string} args.message_id - ID of the message to remove reaction from (optional)
 * @param {string} args.reasoning - Reason for removing this reaction
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of removing the reaction(s)
 */
async function removeReaction(args, threadState) {
  try {
    // Support multiple parameter naming conventions for message timestamp
    const emoji = args.emoji;
    const messageTs = args.messageTs || args.message_ts;
    const messageId = args.message_id || args.messageId;
    const reasoning = args.reasoning;
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Get channel ID from context
    const channelId = args.channel_id || args.channelId || context?.channelId;
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // Determine which emojis to use based on the type of emoji parameter
    let emojiList = [];
    
    if (Array.isArray(emoji)) {
      // If emoji is already an array, use it directly
      emojiList = emoji;
    } else if (emoji) {
      // If emoji is a string, convert to single-item array
      emojiList = [emoji];
    } else {
      throw new Error('Emoji parameter is required');
    }
    
    // Determine the message timestamp to remove reactions from
    let targetMessageTs = messageTs;
    
    // If messageId is provided, look up the corresponding message
    if (messageId && !targetMessageTs) {
      // Try to find the message in the context builder
      const contextBuilder = require('../contextBuilder').getContextBuilder();
      const messages = contextBuilder.getThreadMessages(threadState.threadId);
      
      // Look for a message with matching ID
      const targetMessage = messages.find(msg => 
        msg.id === messageId || 
        (msg.originalContent && msg.originalContent.ts === messageId)
      );
      
      if (targetMessage) {
        // Extract the timestamp from the message
        targetMessageTs = targetMessage.originalContent?.ts || 
                         targetMessage.ts || 
                         targetMessage.timestamp;
        
        // Convert ISO timestamp to Slack timestamp if needed
        if (typeof targetMessageTs === 'string' && targetMessageTs.includes('T')) {
          // This is an ISO timestamp, convert to UNIX timestamp
          targetMessageTs = (new Date(targetMessageTs).getTime() / 1000).toString();
        }
      } else {
        logger.warn(`Could not find message with ID ${messageId}`);
      }
    }
    
    // If no specific message timestamp provided, use the latest user message
    if (!targetMessageTs) {
      // Use the timestamp from context (the message that triggered this interaction)
      targetMessageTs = context.timestamp || context.threadTs;
      
      if (!targetMessageTs) {
        throw new Error('No message timestamp available to remove reactions from. Provide messageTs, message_ts, or message_id.');
      }
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Add each emoji as a reaction
    const results = [];
    
    for (const emojiName of emojiList) {
      try {
        // Clean the emoji name (remove colons if present)
        let cleanEmojiName = emojiName.replace(/:/g, '');
        
        // Handle a few common aliases
        if (cleanEmojiName === 'thinking') cleanEmojiName = 'thinking_face';
        if (cleanEmojiName === 'check') cleanEmojiName = 'white_check_mark';
        if (cleanEmojiName === 'kekdoge') cleanEmojiName = 'kek-doge';
        
        // Remove the reaction
        const response = await slackClient.reactions.remove({
          channel: channelId,
          timestamp: targetMessageTs,
          name: cleanEmojiName
        });
        
        // Track this in thread state if needed
        if (threadState.reactions) {
          // Mark this reaction as removed
          threadState.reactions = threadState.reactions.filter(r => 
            !(r.emoji === cleanEmojiName && r.messageTs === targetMessageTs)
          );
        }
        
        results.push({
          emoji: cleanEmojiName,
          ok: response.ok
        });
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (emojiError) {
        // Handle the "no reaction" error gracefully
        if (emojiError.message && (emojiError.message.includes('no_reaction') || emojiError.message.includes('not reacted'))) {
          results.push({
            emoji: emojiName,
            ok: false,
            error: 'No reaction to remove'
          });
        } else {
          // For other errors, log but continue with other emojis
          logger.warn(`Error removing reaction ${emojiName}: ${emojiError.message}`);
          results.push({
            emoji: emojiName,
            ok: false,
            error: emojiError.message
          });
        }
      }
    }
    
    return {
      ok: results.some(r => r.ok), // At least one reaction removed successfully
      results,
      messageTs: targetMessageTs,
      messageId: messageId,
      reasoning
    };
  } catch (error) {
    logError('Error removing reactions', error, { args });
    throw error;
  }
}

module.exports = {
  removeReaction
}; 