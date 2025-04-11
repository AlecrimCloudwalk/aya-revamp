const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');
const logger = require('../toolUtils/logger.js');

/**
 * Gets a user's avatar URL from their Slack user ID
 * @param {string} userId - Slack user ID to get avatar for
 * @param {string} [size=512] - Avatar size (one of: 24, 32, 48, 72, 192, 512, 1024)
 * @param {Object} threadContext - Thread context with connection info
 * @returns {Promise<Object>} - Object containing the avatar URL
 */
async function getUserAvatar(userId, size = 512, threadContext) {
  try {
    if (!userId) {
      return { 
        error: "Missing required parameter: userId",
        status: "error"
      };
    }
    
    // Validate size
    const validSizes = [24, 32, 48, 72, 192, 512, 1024];
    const sizeInt = parseInt(size, 10);
    const validatedSize = validSizes.includes(sizeInt) ? sizeInt : 512;
    
    // Get slack client
    const slackClient = getSlackClient();
    
    // Get user info
    const userInfo = await slackClient.users.info({ user: userId });
    
    if (!userInfo.ok || !userInfo.user) {
      return {
        error: "Could not retrieve user information",
        status: "error"
      };
    }
    
    // Get avatar URL
    const avatar = userInfo.user.profile.image_original || 
                 userInfo.user.profile[`image_${validatedSize}`] ||
                 userInfo.user.profile.image_72;
                 
    if (!avatar) {
      return {
        error: "No avatar found for user",
        status: "error"
      };
    }
    
    // Return the avatar URL
    return {
      avatar_url: avatar,
      user_id: userId,
      user_name: userInfo.user.real_name || userInfo.user.name,
      status: "success"
    };
    
  } catch (error) {
    logError('Error getting user avatar', error, { userId });
    return {
      error: `Failed to get user avatar: ${error.message}`,
      status: "error"
    };
  }
}

// Export the function directly to avoid circular dependencies
module.exports = getUserAvatar; 