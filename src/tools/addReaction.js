// Tool for adding emoji reactions to messages
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

// Custom emoji constants with workspace emojis
const CUSTOM_EMOJIS = {
  // Basic emoji mapping for easy reference
  thumbsup: 'thumbsup',
  thumbsdown: 'thumbsdown',
  heart: 'heart',
  smile: 'smile',
  thinking: 'thinking_face',
  check: 'white_check_mark',
  x: 'x',
  
  // Custom workspace emojis
  loading: 'loading', // Custom loading emoji
  kekdoge: 'kek-doge', // Custom kek-doge emoji
  
  // Additional custom emojis can be added here
  // Format: emojiAlias: 'emoji-name-in-slack'
};

/**
 * Adds an emoji reaction to a message
 * 
 * @param {Object} args - Arguments for the reaction
 * @param {string} args.emoji - Emoji name to react with (without colons)
 * @param {string} args.messageTs - Timestamp of the message to react to (optional, defaults to the latest user message)
 * @param {string} args.reasoning - Reason for adding this reaction
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of adding the reaction
 */
async function addReaction(args, threadState) {
  try {
    const { emoji, messageTs, reasoning } = args;
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Get channel ID from context
    const channelId = context?.channelId;
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    if (!emoji) {
      throw new Error('Emoji name is required');
    }
    
    // Determine the message timestamp to react to
    let targetMessageTs = messageTs;
    
    // If no specific message timestamp provided, use the latest user message
    if (!targetMessageTs) {
      // Use the timestamp from context (the message that triggered this interaction)
      targetMessageTs = context.timestamp || context.threadTs;
      
      if (!targetMessageTs) {
        throw new Error('No message timestamp available to react to');
      }
    }
    
    // Clean the emoji name (remove colons if present)
    let cleanEmojiName = emoji.replace(/:/g, '');
    
    // Check if this is a reference to a custom emoji
    if (CUSTOM_EMOJIS[cleanEmojiName]) {
      cleanEmojiName = CUSTOM_EMOJIS[cleanEmojiName];
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Add the reaction
    const response = await slackClient.reactions.add({
      channel: channelId,
      timestamp: targetMessageTs,
      name: cleanEmojiName
    });
    
    // Track reactions added in thread state
    if (!threadState.reactions) {
      threadState.reactions = [];
    }
    
    // Add this reaction to the tracking list
    threadState.reactions.push({
      emoji: cleanEmojiName,
      messageTs: targetMessageTs,
      timestamp: new Date().toISOString(),
      reasoning
    });
    
    return {
      ok: response.ok,
      emoji: cleanEmojiName,
      messageTs: targetMessageTs,
      reasoning
    };
  } catch (error) {
    // If the error is because the reaction already exists, return a friendly message
    if (error.message && error.message.includes('already reacted')) {
      return {
        ok: false,
        error: 'Already reacted with this emoji',
        emoji: args.emoji,
        messageTs: args.messageTs || threadState.getMetadata('context')?.timestamp || threadState.getMetadata('context')?.threadTs
      };
    }
    
    logError('Error adding reaction', error, { args });
    throw error;
  }
}

module.exports = {
  addReaction,
  CUSTOM_EMOJIS
}; 