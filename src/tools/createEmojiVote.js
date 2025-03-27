// Tool for creating emoji-based voting messages
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Creates a message with emoji voting options
 * 
 * @param {Object} args - Arguments for the emoji vote message
 * @param {string} args.text - Vote description/question with [header] for title
 * @param {Array} args.options - Array of emoji voting options
 * @param {string} args.color - Color of the message sidebar (optional)
 * @param {string} args.threadTs - Thread timestamp to reply in (optional)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of sending the message
 */
async function createEmojiVote(args, threadState) {
  try {
    const { text, options, color, threadTs } = args;
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Get channel ID from context
    const channelId = context?.channelId;
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // Parse options if provided as string
    let parsedOptions = options;
    if (typeof options === 'string') {
      try {
        parsedOptions = JSON.parse(options);
      } catch (error) {
        throw new Error(`Invalid options JSON: ${error.message}`);
      }
    }
    
    // Validate options
    if (!Array.isArray(parsedOptions) || parsedOptions.length === 0) {
      throw new Error('Options must be a non-empty array');
    }
    
    // Format options as a list with emojis
    const optionsText = parsedOptions.map((option, index) => {
      const emoji = option.emoji || `:${index + 1}️⃣:`; // Default to number emojis
      return `${emoji} - ${option.text}`;
    }).join('\n');
    
    // Create the full message text with instructions
    const fullText = `${text}\n\n**Options:**\n${optionsText}\n\n_React with the emoji next to your preferred option to vote._`;
    
    // Format the message
    const message = formatSlackMessage({
      text: fullText,
      color: color || '#0078D7'
    });
    
    // Prepare message options
    const messageParams = {
      channel: channelId,
      text: message.text,
      blocks: message.blocks
    };
    
    // Add thread_ts if provided or from thread context
    const threadTimestamp = threadTs || context?.threadTs;
    if (threadTimestamp) {
      messageParams.thread_ts = threadTimestamp;
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageParams);
    
    // Store vote metadata in thread state for later retrieval
    if (!threadState.voteRegistry) {
      threadState.voteRegistry = {};
    }
    
    // Generate a unique vote ID
    const voteId = `vote_${Date.now()}`;
    
    // Register this vote
    threadState.voteRegistry[voteId] = {
      text,
      options: parsedOptions,
      messageTs: response.ts,
      channelId,
      timestamp: new Date().toISOString(),
      // Automatically add reactions for each option
      reactions: parsedOptions.map(option => option.emoji || '')
    };
    
    // Add initial reactions to the message for each option
    try {
      // Add each emoji as a reaction
      for (const option of parsedOptions) {
        if (option.emoji) {
          // Remove colons from emoji if present
          const emojiName = option.emoji.replace(/:/g, '');
          
          // Wait a small amount to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 300));
          
          await slackClient.reactions.add({
            channel: channelId,
            timestamp: response.ts,
            name: emojiName
          });
        }
      }
    } catch (reactionError) {
      console.log(`Error adding initial reactions: ${reactionError.message}`);
      // Non-fatal error, continue
    }
    
    // Return relevant information
    return {
      ok: response.ok,
      ts: response.ts,
      channel: response.channel,
      voteId,
      options: parsedOptions.map(o => ({ text: o.text, emoji: o.emoji }))
    };
  } catch (error) {
    logError('Error creating emoji vote', error, { args });
    throw error;
  }
}

/**
 * Gets the current vote results for a specific vote
 * 
 * @param {Object} args - Arguments for getting vote results
 * @param {string} args.voteId - ID of the vote to get results for
 * @param {string} args.messageTs - Timestamp of the vote message (alternative to voteId)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Current vote results
 */
async function getVoteResults(args, threadState) {
  try {
    const { voteId, messageTs } = args;
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Get channel ID from context
    const channelId = context?.channelId;
    
    if (!channelId) {
      throw new Error('Channel ID not available in thread context');
    }
    
    // Need either voteId or messageTs
    if (!voteId && !messageTs) {
      throw new Error('Either voteId or messageTs is required');
    }
    
    // Find the vote in the registry
    const voteRegistry = threadState.voteRegistry || {};
    let voteInfo = null;
    let messageTimestamp = messageTs;
    
    if (voteId && voteRegistry[voteId]) {
      voteInfo = voteRegistry[voteId];
      messageTimestamp = voteInfo.messageTs;
    } else if (messageTs) {
      // Search for the vote by message timestamp
      for (const [regVoteId, regVoteInfo] of Object.entries(voteRegistry)) {
        if (regVoteInfo.messageTs === messageTs) {
          voteInfo = regVoteInfo;
          break;
        }
      }
    }
    
    if (!voteInfo && !messageTimestamp) {
      throw new Error('Vote not found in registry');
    }
    
    // Get reactions from the message
    const slackClient = getSlackClient();
    const reactionsResponse = await slackClient.reactions.get({
      channel: channelId,
      timestamp: messageTimestamp,
      full: true
    });
    
    if (!reactionsResponse.ok || !reactionsResponse.message) {
      throw new Error('Could not retrieve reactions');
    }
    
    // Extract vote counts from reactions
    const reactions = reactionsResponse.message.reactions || [];
    const results = [];
    
    // If we have vote info, map reactions to options
    if (voteInfo && voteInfo.options) {
      // Process each option
      for (const option of voteInfo.options) {
        const emoji = option.emoji ? option.emoji.replace(/:/g, '') : '';
        const reaction = reactions.find(r => r.name === emoji);
        
        results.push({
          text: option.text,
          emoji: option.emoji,
          count: reaction ? reaction.count - 1 : 0, // Subtract 1 for the bot's own reaction
          users: reaction ? reaction.users.filter(user => user !== reactionsResponse.message.user) : []
        });
      }
    } else {
      // If we don't have vote info, just return all reactions
      for (const reaction of reactions) {
        results.push({
          emoji: `:${reaction.name}:`,
          count: reaction.count - 1, // Subtract 1 for the bot's own reaction if it added it
          users: reaction.users
        });
      }
    }
    
    // Return the results
    return {
      results,
      timestamp: new Date().toISOString(),
      totalVotes: results.reduce((sum, result) => sum + result.count, 0),
      message: reactionsResponse.message
    };
  } catch (error) {
    logError('Error getting vote results', error, { args });
    throw error;
  }
}

module.exports = {
  createEmojiVote,
  getVoteResults
}; 