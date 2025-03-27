const { getSlackClient } = require('../slackClient.js');
const { createToolError } = require('../errors.js');

/**
 * Gets a user's avatar URL from their user ID
 * @param {Object} args - Tool arguments
 * @param {string} args.userId - The Slack user ID to get avatar for
 * @param {string} [args.size] - The size of avatar to return (24, 32, 48, 72, 192, 512, 1024, or 'original')
 * @param {Object} threadState - The current thread state
 * @returns {Promise<Object>} - The result of the operation containing user info and avatar URLs
 */
async function getUserAvatar(args, threadState) {
  try {
    const { userId, size = '192' } = args;
    
    if (!userId) {
      throw createToolError('Missing required parameter: userId', 'MISSING_PARAMETER');
    }
    
    // Valid sizes for Slack avatars
    const validSizes = ['24', '32', '48', '72', '192', '512', '1024', 'original'];
    const requestedSize = size.toString();
    
    if (!validSizes.includes(requestedSize)) {
      throw createToolError(
        `Invalid size parameter: ${size}. Valid values are: ${validSizes.join(', ')}`,
        'INVALID_PARAMETER'
      );
    }
    
    const client = getSlackClient();
    
    // Call the users.info API method
    const response = await client.users.info({
      user: userId
    });
    
    if (!response.ok) {
      throw createToolError(`Failed to get user info: ${response.error}`, 'API_ERROR');
    }
    
    const user = response.user;
    
    // Extract avatar URLs from the user's profile
    const avatarUrls = {};
    
    if (user.profile) {
      // Add all available avatar URLs to the response
      validSizes.forEach(s => {
        const key = s === 'original' ? 'image_original' : `image_${s}`;
        if (user.profile[key]) {
          avatarUrls[s] = user.profile[key];
        }
      });
      
      // If the requested size doesn't exist, use the closest available size
      if (!avatarUrls[requestedSize]) {
        const availableSizes = Object.keys(avatarUrls).filter(s => s !== 'original');
        if (availableSizes.length > 0) {
          // Sort sizes numerically
          availableSizes.sort((a, b) => parseInt(a) - parseInt(b));
          
          // Find the closest available size
          let closestSize = availableSizes[0];
          const requestedSizeNum = parseInt(requestedSize);
          if (!isNaN(requestedSizeNum)) {
            for (const s of availableSizes) {
              if (parseInt(s) >= requestedSizeNum) {
                closestSize = s;
                break;
              }
            }
          }
          
          // Add a note about using an alternative size
          avatarUrls.note = `Requested size ${requestedSize} not available, using ${closestSize} instead`;
        }
      }
    }
    
    return {
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        real_name: user.real_name,
        display_name: user.profile?.display_name
      },
      avatar_urls: avatarUrls,
      requested_size: requestedSize,
      avatar_url: avatarUrls[requestedSize] || avatarUrls.original || null
    };
  } catch (error) {
    // Handle errors and return an appropriate response
    if (error.name === 'ToolError') {
      throw error;
    }
    
    throw createToolError(
      `Error getting user avatar: ${error.message}`,
      'TOOL_EXECUTION_ERROR'
    );
  }
}

module.exports = getUserAvatar; 