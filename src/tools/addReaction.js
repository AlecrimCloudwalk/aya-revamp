// Tool for adding emoji reactions to messages
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const logger = require('../toolUtils/logger.js');


// All available emoji names
const AVAILABLE_EMOJIS = [
  // Standard emojis
  'thumbsup', 'thumbsdown', 'heart', 'smile', 'x',
  'thinking_face', 'white_check_mark',
  
  // Workspace custom emojis
  'ae', 'alert', 'blob-wave', 'blender', 'brlc', 'cw-dark',
  'catno', 'catyes', 'chefskiss', 'ddrup', 'eyesshaking', 
  'kekw', 'kek-doge', 'loading',
  'pepebigbrain', 'pepechrist', 'pepeglass', 'pepelaugh',
  'pepelove', 'peperofl', 'pepe-sad-emo',
  'peepocheer', 'peepoclap', 'peepohey', 'peeporun', 'peeposhy',
  'prayge', 'thonking', 'this-is-fine-fire', 'wicked-thumbs-up'
];

/**
 * Adds emoji reaction(s) to a message
 * 
 * @param {Object} args - Arguments for the reaction
 * @param {string|string[]} args.emoji - Emoji name(s) to react with (without colons). Can be a single string or an array of strings.
 * @param {string} args.messageTs - Timestamp of the message to react to (optional)
 * @param {string} args.message_ts - Alternative parameter name for messageTs (optional)
 * @param {string} args.message_id - ID of the message to react to from the context (optional)
 * @param {string} args.reasoning - Reason for adding this reaction
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of adding the reaction(s)
 */
async function addReaction(args, threadState) {
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
    
    // Determine the message timestamp to react to
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
        throw new Error('No message timestamp available to react to. Provide messageTs, message_ts, or message_id.');
      }
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Track reactions added in thread state
    if (!threadState.reactions) {
      threadState.reactions = [];
    }
    
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
        
        // Add the reaction
        const response = await slackClient.reactions.add({
          channel: channelId,
          timestamp: targetMessageTs,
          name: cleanEmojiName
        });
        
        // Add this reaction to the tracking list
        threadState.reactions.push({
          emoji: cleanEmojiName,
          messageTs: targetMessageTs,
          timestamp: new Date().toISOString(),
          reasoning,
          messageId: messageId
        });
        
        results.push({
          emoji: cleanEmojiName,
          ok: response.ok
        });
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (emojiError) {
        // Handle the "already reacted" error gracefully
        if (emojiError.message && emojiError.message.includes('already reacted')) {
          results.push({
            emoji: emojiName,
            ok: false,
            error: 'Already reacted with this emoji'
          });
        } else {
          // For other errors, log but continue with other emojis
          logger.warn(`Error adding reaction ${emojiName}: ${emojiError.message}`);
          results.push({
            emoji: emojiName,
            ok: false,
            error: emojiError.message
          });
        }
      }
    }
    
    return {
      ok: results.some(r => r.ok), // At least one reaction succeeded
      results,
      messageTs: targetMessageTs,
      messageId: messageId,
      reasoning
    };
  } catch (error) {
    logError('Error adding reactions', error, { args });
    throw error;
  }
}

module.exports = {
  addReaction,
  availableEmojis: AVAILABLE_EMOJIS
}; 