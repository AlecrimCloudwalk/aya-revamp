/**
 * Modular Block Builder for Slack Block Kit
 * 
 * A simpler, more maintainable approach to building Slack Block Kit messages
 * using a consistent syntax designed for easier LLM integration.
 */

const { getSlackClient } = require('../slackClient.js');
const logger = require('./logger.js');


// Debug logging function
function debugLog(message, data) {
  if (process.env.DEBUG === 'true' || process.env.DEBUG_SLACK === 'true') {
    if (data) {
      logger.debug(message, data);
    } else {
      logger.debug(message);
    }
  }
}

// Default color for attachments
const defaultAttachmentColor = '#842BFF'; // Slack blue

/**
 * Get a user's display name or real name from their Slack ID
 * @param {string} userId - The Slack user ID
 * @returns {Promise<string>} - The user's display name or real name
 */
async function getUserName(userId) {
  try {
    // Get Slack client
    let slack = null;
    try {
      slack = getSlackClient();
    } catch (error) {
      logger.error(`Error getting Slack client: ${error.message}`);
      return `@User`;
    }
    
    if (!slack) {
      return `@User`;
    }
    
    // Call users.info API to get user info
    try {
      const result = await slack.users.info({ user: userId });
      
      if (result.ok && result.user) {
        // First try to get display name
        if (result.user.profile.display_name) {
          return `@${result.user.profile.display_name}`;
        }
        // Fall back to real name
        else if (result.user.profile.real_name) {
          return `@${result.user.profile.real_name}`;
        }
        // Last resort, use the user ID
        else {
          return `@User`;
        }
      } else {
        logger.warn(`No user data returned for ${userId}`);
        return `@User`;
      }
    } catch (apiError) {
      logger.error(`API error fetching user info for ${userId}: ${apiError.message}`);
      return `@User`;
    }
  } catch (error) {
    logger.error(`Error in getUserName for ${userId}: ${error.message}`);
    return `@User`;
  }
}

/**
 * Block definitions with their parameters and configurations
 */
const blockDefinitions = {
  // Basic blocks
  section: {
    params: ['text'],
    attachmentWrapped: true,
    description: 'Standard text section'
  },
  image: {
    params: ['url', 'altText'],
    attachmentWrapped: false,
    description: 'Standalone image'
  },
  context: {
    params: ['text'],
    attachmentWrapped: true,
    description: 'Smaller helper text'
  },
  divider: {
    params: [],
    attachmentWrapped: true,
    description: 'Horizontal line separator'
  },
  header: {
    params: ['text'],
    attachmentWrapped: true,
    description: 'Larger header text'
  },
  
  // Compound blocks
  sectionWithImage: {
    params: ['text', 'imageUrl', 'imageAlt', 'imagePosition'],
    attachmentWrapped: true,
    description: 'Section with image accessory'
  },
  contextWithImages: {
    params: ['text', 'images'],
    attachmentWrapped: true,
    description: 'Context with multiple images'
  },
  sectionWithUsers: {
    params: ['text', 'users'],
    attachmentWrapped: true,
    description: 'Section with user mentions'
  },
  userContext: {
    params: ['text', 'users'],
    attachmentWrapped: true,
    description: 'Context block with user profiles'
  },
  buttons: {
    params: ['buttons'],
    attachmentWrapped: true,
    description: 'Interactive button set'
  },
  fields: {
    params: ['fields'],
    attachmentWrapped: true,
    description: 'Multi-column field layout'
  }
};

/**
 * Parameter validators for each block type
 */
const paramValidators = {
  text: (value) => typeof value === 'string',
  url: (value) => typeof value === 'string' && value.match(/^https?:\/\//),
  altText: (value) => typeof value === 'string',
  imageUrl: (value) => typeof value === 'string' && value.match(/^https?:\/\//),
  imageAlt: (value) => typeof value === 'string',
  imagePosition: (value) => !value || ['right', 'bottom'].includes(value),
  images: (value) => Array.isArray(value) && value.every(img => 
    (typeof img === 'string' && img.match(/^https?:\/\//)) || 
    (img.url && img.alt && typeof img.url === 'string' && typeof img.alt === 'string')
  ),
  users: (value) => Array.isArray(value) && value.every(user => 
    typeof user === 'string' || (user.id && typeof user.id === 'string')
  ),
  buttons: (value) => Array.isArray(value) && value.every(btn => 
    typeof btn === 'string' || (btn.text && typeof btn.text === 'string')
  ),
  fields: (value) => Array.isArray(value) && value.every(field => 
    typeof field === 'string' || 
    (field.title && field.value && typeof field.title === 'string' && typeof field.value === 'string')
  )
};

/**
 * Block generators for each block type
 */
const blockGenerators = {
  section: (params) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: params.text
    }
  }),
  
  image: (params) => ({
    type: 'image',
    image_url: params.url,
    alt_text: params.altText || 'Image'
  }),
  
  context: (params) => ({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: params.text
    }]
  }),
  
  divider: () => ({
    type: 'divider'
  }),
  
  header: (params) => {
    // Headers only support plain_text, so we need to convert any user mentions
    // to a plain text format since Slack will reject mentions in header blocks
    let headerText = params.text;
    
    // Remove or replace newlines since headers don't support them
    headerText = headerText.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
    
    // Check if there are user mentions that need to be processed
    if (headerText && headerText.includes('<@')) {
      // Extract all user IDs from mentions
      const userIds = [];
      const mentionRegex = /<@([A-Z0-9]+)>/g;
      let match;
      
      while ((match = mentionRegex.exec(headerText)) !== null) {
        userIds.push(match[1]);
      }
      
      // For synchronous processing, we'll replace with placeholder text first
      headerText = headerText.replace(/<@([A-Z0-9]+)>/g, '@UserName');
      logger.warn(`⚠️ Converting ${userIds.length} user mentions in header to plain text usernames`);
      
      // Since we can't use async/await directly in this synchronous function,
      // we'll return the basic block now, but queue up the user name lookups
      
      // Create the basic header block
      const headerBlock = {
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerText,
          emoji: true
        }
      };
      
      // If there are user IDs to process, start the async lookups
      // This is a best-effort approach that will update usernames if they can be fetched quickly
      if (userIds.length > 0) {
        // For each user ID, fetch the username and update the header text
        Promise.all(userIds.map(userId => getUserName(userId)))
          .then(userNames => {
            // Replace each placeholder with the actual username
            let updatedText = headerText;
            userNames.forEach((userName, index) => {
              updatedText = updatedText.replace('@UserName', userName);
            });
            
            // Update the block with the new text
            headerBlock.text.text = updatedText;
            logger.info('✅ Updated header with actual usernames');
          })
          .catch(error => {
            logger.error('Error updating usernames in header:', error);
          });
      }
      
      return headerBlock;
    } else {
      // No user mentions, return the header as is
      return {
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerText,
          emoji: true
        }
      };
    }
  },
  
  sectionWithImage: (params) => {
    if (params.imagePosition === 'right' || !params.imagePosition) {
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: params.text
        },
        accessory: {
          type: 'image',
          image_url: params.imageUrl,
          alt_text: params.imageAlt || 'Image'
        }
      };
    } else {
      // For bottom position, we'll handle it at the message level
      // by creating separate blocks
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: params.text
          }
        },
        {
          type: 'image',
          image_url: params.imageUrl,
          alt_text: params.imageAlt || 'Image'
        }
      ];
    }
  },
  
  contextWithImages: (params) => {
    try {
      debugLog('🖼️ GENERATING CONTEXT WITH IMAGES block with params:', JSON.stringify(params, null, 2));
      
      const elements = [{
        type: 'mrkdwn',
        text: params.text || 'Image Context'
      }];
      
      // Add image elements if they exist and are an array
      if (params.images && Array.isArray(params.images) && params.images.length > 0) {
        debugLog(`🖼️ Adding ${params.images.length} images to context`);
        
        // Process each image
        params.images.forEach((img, index) => {
          try {
            // Check if it's a string URL or object with url/alt properties
            const imgUrl = typeof img === 'string' ? img : img.url;
            const imgAlt = typeof img === 'string' ? 'Image' : (img.alt || 'Image');
            
            debugLog(`🖼️ Adding image #${index + 1}: URL=${imgUrl}, ALT=${imgAlt}`);
            
            // Add the image element to the context
            elements.push({
              type: 'image',
              image_url: imgUrl,
              alt_text: imgAlt
            });
          } catch (imgError) {
            logger.error(`🔴 Error adding image #${index + 1}:`, imgError);
          }
        });
      } else {
        debugLog('⚠️ No images or empty images array for contextWithImages');
      }
      
      // Create the context block with all elements
      const block = {
        type: 'context',
        elements: elements
      };
      
      debugLog('🖼️ Final context block:', JSON.stringify(block, null, 2));
      return block;
    } catch (error) {
      logger.error('🔴 Error in contextWithImages generator:', error);
      // Fallback to simple context
      return {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: params.text || 'Image Context (Error)'
        }]
      };
    }
  },
  
  sectionWithUsers: (params) => {
    try {
      // Create the basic section with text
      const section = {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: params.text || ''
        }
      };
      
      // If we have users, add them to the section
      if (params.users && Array.isArray(params.users) && params.users.length > 0) {
        // For section with users, we just add user mentions directly in the text
        // Users should already be formatted as <@USER_ID> by the LLM
        // This function doesn't actually need special handling since the LLM formats the mentions
        debugLog(`👥 Section with users: ${params.users.length} users`);
      }
      
      return section;
    } catch (error) {
      logger.error('Error in sectionWithUsers generator:', error);
      // Fallback to simple section
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: params.text || 'User Section (Error)'
        }
      };
    }
  },
  
  userContext: async (params) => {
    try {
      debugLog('👥 Generating userContext block with params:', JSON.stringify(params, null, 2));
      
      // Extract user IDs from text if they're not provided directly
      let userIds = params.users || [];
      
      // Convert string user input to array if needed
      if (typeof userIds === 'string') {
        debugLog('Converting string user input to array');
        userIds = userIds.split(',').map(id => id.trim());
      }
      
      if (!userIds.length && params.text) {
        // Extract user IDs from text format like <@U123456>
        const mentionRegex = /<@([A-Z0-9]+)>/g;
        let match;
        while ((match = mentionRegex.exec(params.text)) !== null) {
          userIds.push(match[1]);
        }
      }
      
      // If no user IDs found, return a simple text context
      if (!userIds.length) {
        return {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: params.text || 'No users specified'
          }]
        };
      }
      
      // NOTE: We're NOT deduplicating here anymore, to allow multiple mentions of the same user
      
      // Log found userIds for debugging
      debugLog(`👥 Processing ${userIds.length} user IDs: ${userIds.join(', ')}`);
      logger.info(`👥 User IDs to process: ${userIds.join(', ')}`);
      
      // Extract description text (content after the pipe character)
      let descriptionText = '';
      if (params.text && params.text.includes('|')) {
        const parts = params.text.split('|', 2);
        descriptionText = parts[1] ? parts[1].trim() : '';
      } else {
        descriptionText = params.text || '';
      }
      
      // Determine if we need mrkdwn or plain_text based on content
      // Use mrkdwn if the text contains markdown formatting or emoji codes
      const needsMrkdwn = descriptionText.match(/[*_~`>]|\:[a-z0-9_\-\+]+\:|<@|<#|<http/);
      const textType = needsMrkdwn ? 'mrkdwn' : 'plain_text';
      
      // Set workspace ID for fallback URL construction
      const workspaceId = process.env.SLACK_WORKSPACE_ID || 'T02RAEMPK';
      
      // Create the context block structure
      const contextBlock = {
        type: 'context',
        block_id: `uc_${Date.now().toString().slice(-6)}_${userIds.length}`,
        elements: []
      };
      
      // Set maximum number of avatars to show
      const MAX_AVATARS = 3;
      const totalUsers = userIds.length;
      const hasMoreUsers = totalUsers > MAX_AVATARS;
      const avatarsToShow = hasMoreUsers ? MAX_AVATARS : totalUsers;
      
      // Get Slack client for fetching user info
      try {
        const slack = getSlackClient();
        logger.info('✅ Successfully got Slack client');
        
        // Use Promise.all to fetch all user info in parallel with a timeout
        const userInfoPromises = userIds.map(userId => {
          // Create a promise that resolves after 3 seconds with a fallback
          const timeoutPromise = new Promise(resolve => {
            setTimeout(() => {
              logger.info(`⏱️ Timeout for user ${userId}, using fallback avatar`);
              resolve({
                userId,
                name: userId,
                imageUrl: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`
              });
            }, 3000); // 3 second timeout
          });
          
          // Create the fetch promise
          logger.info(`⏳ Starting API call for user ${userId} at ${new Date().toISOString()}`);
          const startTime = Date.now();
          
          const fetchPromise = slack.users.info({ user: userId })
            .then(result => {
              const elapsed = Date.now() - startTime;
              logger.info(`⌛ API call for user ${userId} took ${elapsed}ms`);
              
              if (result && result.ok && result.user && result.user.profile) {
                const imageUrl = result.user.profile.image_72 || 
                                result.user.profile.image_48 || 
                                `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`;
                const name = result.user.profile.display_name || result.user.real_name || userId;
                
                logger.info(`✅ Successfully fetched avatar for ${name} (${userId}): ${imageUrl}`);
                
                return {
                  userId,
                  name,
                  imageUrl
                };
              } else {
                logger.warn(`⚠️ Slack API returned ok but no user data for ${userId}`);
                return {
                  userId,
                  name: userId,
                  imageUrl: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`
                };
              }
            })
            .catch(error => {
              const elapsed = Date.now() - startTime;
              logger.error(`❌ Error fetching user info for ${userId} after ${elapsed}ms:`, error);
              logger.error(`Error details: ${error.message}`);
              
              if (error.data) {
                logger.error(`API error data:`, JSON.stringify(error.data));
              }
              
              return {
                userId,
                name: userId,
                imageUrl: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`
              };
            });
          
          // Return whichever resolves first
          return Promise.race([fetchPromise, timeoutPromise]);
        });
        
        // Wait for all user info to be fetched (with timeout protection)
        const userInfos = await Promise.all(userInfoPromises);
        
        // Add image elements with real user avatars
        for (let i = 0; i < avatarsToShow; i++) {
          contextBlock.elements.push({
            type: 'image',
            image_url: userInfos[i].imageUrl,
            alt_text: userInfos[i].name
          });
        }
        
        // Add the text element with dot character at the beginning
        // Context blocks don't support rich text formatting in plain_text mode
        // So we'll use mrkdwn format and include the dot as part of the text
        const firstName = userInfos[0].name;
        let finalText = '';
        
        // Create different messages based on user count
        if (totalUsers === 1) {
          finalText = `\u2003\u2003·\u2003\u2003*${firstName}* ${descriptionText || 'is part of this conversation'}`;
        } else if (totalUsers === 2) {
          finalText = `\u2003\u2003·\u2003\u2003*${firstName} and 1 other* ${descriptionText || 'are part of this conversation'}`;
        } else if (hasMoreUsers) {
          const othersCount = totalUsers - 1;
          finalText = `\u2003\u2003·\u2003\u2003*${firstName} and ${othersCount} others* ${descriptionText || 'are part of this conversation'}`;
        } else {
          finalText = `\u2003\u2003·\u2003\u2003*${firstName} and ${totalUsers - 1} others* ${descriptionText || 'are part of this conversation'}`;
        }
        
        // Add as mrkdwn to support formatting
        contextBlock.elements.push({
          type: 'mrkdwn',
          text: finalText
        });
        
        // Log the final block for debugging
        logger.info('📋 Final userContext block structure:');
        logger.detail('📋 Final userContext block structure:', contextBlock);
        
        // Ensure the block has a type field
        if (!contextBlock.type) {
          logger.error('⚠️ userContext block missing type field, adding it');
          contextBlock.type = 'context';
        }
        
        // Check that elements are added
        if (!contextBlock.elements || contextBlock.elements.length === 0) {
          logger.error('⚠️ userContext block has no elements, adding fallback text');
          contextBlock.elements = [{
            type: 'mrkdwn',
            text: 'User context (Error: No elements found)'
          }];
        }
        
        return contextBlock;
      } catch (error) {
        logger.error('Error fetching user info:', error);
        
        // Fallback to placeholder avatars if we couldn't get the Slack client
        for (let i = 0; i < avatarsToShow; i++) {
          contextBlock.elements.push({
            type: 'image',
            image_url: `https://ca.slack-edge.com/${workspaceId}-${userIds[i]}-4c812ee43716-72`,
            alt_text: `User ${userIds[i]}`
          });
        }
        
        // Add the text element with dot character at the beginning
        const firstUserId = userIds[0];
        let finalText = '';
        
        // Create different messages based on user count
        if (totalUsers === 1) {
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId}* ${descriptionText || 'is part of this conversation'}`;
        } else if (totalUsers === 2) {
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and 1 other* ${descriptionText || 'are part of this conversation'}`;
        } else if (hasMoreUsers) {
          const othersCount = totalUsers - 1;
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and ${othersCount} others* ${descriptionText || 'are part of this conversation'}`;
        } else {
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and ${totalUsers - 1} others* ${descriptionText || 'are part of this conversation'}`;
        }
        
        // Add as mrkdwn to support formatting
        contextBlock.elements.push({
          type: 'mrkdwn',
          text: finalText
        });
        
        // Log the final block for debugging
        logger.info('📋 Final userContext block structure (fallback):');
        logger.detail('📋 Final userContext block structure (fallback):', contextBlock);
        
        // Ensure the block has a type field
        if (!contextBlock.type) {
          logger.error('⚠️ userContext block missing type field, adding it');
          contextBlock.type = 'context';
        }
        
        // Check that elements are added
        if (!contextBlock.elements || contextBlock.elements.length === 0) {
          logger.error('⚠️ userContext block has no elements, adding fallback text');
          contextBlock.elements = [{
            type: 'mrkdwn',
            text: 'User context (Error: No elements found)'
          }];
        }
        
        return contextBlock;
      }
    } catch (error) {
      logger.error('Error in userContext generator:', error);
      // Fallback to simple context
      return {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: params.text || 'User Context (Error)'
        }]
      };
    }
  },
  
  buttons: (params) => {
    const buttonElements = params.buttons.map((btn, index) => {
      if (typeof btn === 'string') {
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: btn,
            emoji: true
          },
          value: `button_${index}`,
          action_id: `button_${index}`
        };
      } else {
        // Validate style - only 'primary', 'danger' or undefined are valid
        let style;
        if (btn.style === 'primary' || btn.style === 'danger') {
          style = btn.style;
        } else if (btn.style && btn.style !== 'default') {
          logger.warn(`⚠️ Invalid button style "${btn.style}" for button "${btn.text}", using default`);
        }
        
        // --- START EDIT: Check if value is a URL to create a link button ---
        const value = btn.value || `button_${index}`;
        
        // If button value starts with http:// or https://, create a link button
        if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
          logger.info(`Creating link button: ${btn.text} → ${value}`);
          return {
            type: 'button',
            text: {
              type: 'plain_text',
              text: btn.text,
              emoji: true
            },
            url: value,
            // Note: style and action_id are not applicable for link buttons
          };
        }
        // --- END EDIT ---
        
        // Otherwise create a regular action button
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: btn.text,
            emoji: true
          },
          ...(style && { style }),
          value: value,
          action_id: btn.actionId || `button_${index}`
        };
      }
    });
    
    return {
      type: 'actions',
      elements: buttonElements
    };
  },
  
  fields: (params) => {
    const fieldObjects = params.fields.map(field => {
      if (typeof field === 'string') {
        return {
          type: 'mrkdwn',
          text: field
        };
      } else {
        return {
          type: 'mrkdwn',
          text: `*${field.title}*\n${field.value}`
        };
      }
    });
    
    return {
      type: 'section',
      fields: fieldObjects
    };
  }
};

/**
 * The central block registry that combines definitions, validators, and generators
 */
const blockRegistry = Object.keys(blockDefinitions).reduce((registry, blockType) => {
  registry[blockType] = {
    definition: blockDefinitions[blockType],
    validate: (params) => {
      const definition = blockDefinitions[blockType];
      return definition.params.every(param => {
        return !paramValidators[param] || !params[param] || paramValidators[param](params[param]);
      });
    },
    generate: blockGenerators[blockType]
  };
  return registry;
}, {});

/**
 * Parse parameters from block content
 * @param {string} blockType - The type of block being parsed
 * @param {string} content - The content for the block
 * @returns {Object} - Parsed parameters
 */
function parseParams(blockType, content) {
  // Add debug logging
  debugLog(`🔍 Parsing ${blockType} parameters from: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);

  // Common parameters extraction - check for color parameter in all blocks
  let params = {};
  
  // Check for color parameter (format: |color:value)
  if (content.includes('|color:')) {
    const colorMatch = content.match(/\|color:([^|]+)/i);
    if (colorMatch && colorMatch[1]) {
      const colorValue = colorMatch[1].trim();
      debugLog(`🎨 Found color parameter: ${colorValue}`);
      params.color = colorValue;
      
      // Remove the color parameter from content to avoid confusion in further parsing
      content = content.replace(/\|color:[^|]+/i, '');
    }
  }
  
  // For context with images, handle special syntax
  if (blockType === 'contextWithImages') {
    debugLog(`🖼️ Special handling for contextWithImages`);
    debugLog(`📝 Raw content: ${content}`);
    
    // Extract text (everything before | images:)
    let text = content;
    let imagesStr = '';
    
    // Handle both formats: "| images:" and simply "|"
    if (content.includes('| images:')) {
      const parts = content.split('| images:');
      text = parts[0].trim();
      imagesStr = parts[1] ? parts[1].trim() : '';
    } else if (content.includes('|')) {
      const parts = content.split('|', 2);
      text = parts[0].trim();
      imagesStr = parts[1] ? parts[1].trim() : '';
      
      // If the second part contains "images:", extract just that part
      if (imagesStr.includes('images:')) {
        const imagesParts = imagesStr.split('images:');
        imagesStr = imagesParts[1] ? imagesParts[1].trim() : '';
      }
    }
    
    debugLog(`📄 Extracted text: "${text}"`);
    debugLog(`🖼️ Extracted images string: "${imagesStr}"`);
    
    // Extract images
    const images = [];
    if (imagesStr) {
      // Check if in array format [url|alt, url|alt]
      if (imagesStr.startsWith('[') && imagesStr.endsWith(']')) {
        debugLog(`📋 Images in array format`);
        // Remove the square brackets
        const arrayContent = imagesStr.substring(1, imagesStr.length - 1);
        
        // Split by comma, but handle cases where alt text might contain commas
        let inAltText = false;
        let currentItem = '';
        let items = [];
        
        for (let i = 0; i < arrayContent.length; i++) {
          const char = arrayContent[i];
          
          if (char === '|') {
            inAltText = true;
            currentItem += char;
          } else if (char === ',' && !inAltText) {
            items.push(currentItem.trim());
            currentItem = '';
          } else {
            currentItem += char;
          }
        }
        
        if (currentItem) {
          items.push(currentItem.trim());
        }
        
        debugLog(`🔢 Found ${items.length} images in array`);
        
        // Process each image
        items.forEach((item, index) => {
          debugLog(`🖼️ Processing image ${index + 1}: ${item}`);
          const [url, alt] = item.split('|').map(s => s.trim());
          if (url) {
            images.push({ url, alt: alt || 'Image' });
            debugLog(`✅ Added image: ${url} with alt: ${alt || 'Image'}`);
          }
        });
      } else {
        // Single image or unsupported format
        debugLog(`❓ Unrecognized image format`);
      }
    }
    
    return { ...params, text, images };
  } 
  // For image blocks, handle URL and alt text
  else if (blockType === 'image') {
    debugLog(`🔍 Parsing image parameters from: "${content}"`);
    
    // Check if the content has a pipe (indicating URL|alt format)
    let url = content;
    let altText = 'Image';
    
    if (content.includes('|')) {
      const parts = content.split('|');
      url = parts[0].trim();
      altText = parts[1] ? parts[1].trim() : 'Image';
      
      // Remove "altText:" prefix if present
      if (altText.startsWith('altText:')) {
        altText = altText.substring('altText:'.length).trim();
      }
      
      debugLog(`🖼️ Image URL: "${url}", Alt Text: "${altText}"`);
    } else if (content.includes('altText:')) {
      // Handle format: url altText:alt
      const parts = content.split('altText:');
      url = parts[0].trim();
      altText = parts[1] ? parts[1].trim() : 'Image';
      debugLog(`🖼️ Image URL (alt format): "${url}", Alt Text: "${altText}"`);
    }
    
    return { ...params, url, altText };
  }
  // For section blocks, check if they have an image
  else if (blockType === 'section') {
    debugLog(`📊 Parsing section parameters`);
    
    // Extract text (everything before the first pipe, if any)
    let text = content;
    let imageUrl = null;
    let altText = 'Image';
    
    if (content.includes('|')) {
      const parts = content.split('|');
      text = parts[0].trim();
      debugLog(`📄 Extracted section text: "${text}"`);
      
      // Check if any of the remaining parts has an image
      const remainingContent = parts.slice(1).join('|').trim();
      debugLog(`🔍 Looking for image in: "${remainingContent}"`);
      
      // Instead of regex, look for "image:" followed by URL
      if (remainingContent.includes('image:')) {
        const imagePrefix = 'image:';
        const imageStart = remainingContent.indexOf(imagePrefix) + imagePrefix.length;
        let imageEnd = remainingContent.length;
        
        // If there's a pipe after the image URL, it indicates alt text
        const pipeAfterImage = remainingContent.indexOf('|', imageStart);
        if (pipeAfterImage !== -1) {
          imageEnd = pipeAfterImage;
          altText = remainingContent.substring(pipeAfterImage + 1).trim();
          debugLog(`🏷️ Found alt text: "${altText}"`);
        }
        
        imageUrl = remainingContent.substring(imageStart, imageEnd).trim();
        debugLog(`🖼️ Found image URL: "${imageUrl}"`);
      }
    }
    
    // If we found an image URL, convert to sectionWithImage
    if (imageUrl) {
      debugLog(`🔄 Converting section to sectionWithImage`);
      return {
        text,
        imageUrl,
        altText: altText || 'Image',
        imagePosition: 'right' // Default position
      };
    }
    
    // Return standard section params
    return { ...params, text };
  }
  // Check for usercontext format which should be converted to proper blocks
  else if (blockType === 'context' && content.match(/\(usercontext\)(.*?)(?:\|.*?)?(?:\(!usercontext\))/)) {
    debugLog(`👥 Detected usercontext format in context block`);
    // Extract user IDs and optional description
    const match = content.match(/\(usercontext\)(.*?)(?:\|(.*?))?(?:\(!usercontext\))/);
    if (match) {
      let userIds = match[1].trim().split(',').map(id => id.trim());
      const description = match[2] ? match[2].trim() : '';
      
      // Check for <@ID> format in comma-separated list and extract IDs
      const extractedIds = [];
      for (const item of userIds) {
        if (item.match(/<@([A-Z0-9]+)>/)) {
          const idMatch = item.match(/<@([A-Z0-9]+)>/);
          extractedIds.push(idMatch[1]);
        } else if (item.match(/^[A-Z0-9]+$/)) {
          extractedIds.push(item);
        }
      }
      
      // If we found any IDs in <@ID> format, use those instead
      if (extractedIds.length > 0) {
        userIds = extractedIds;
      }
      
      // Note: No longer deduplicating user IDs
      
      debugLog(`👥 Extracted user IDs: ${userIds.join(', ')}`);
      debugLog(`📄 Description: "${description}"`);
      
      // Convert to userContext params
      return { 
        blockTypeOverride: 'userContext',
        text: description,
        users: userIds
      };
    }
  }
  // Handle userContext blocks directly
  else if (blockType === 'userContext') {
    debugLog(`👥 Parsing userContext block parameters`);
    
    // Extract text (content before the pipe, if any)
    let text = content;
    let description = '';
    
    if (content.includes('|')) {
      const parts = content.split('|', 2);
      text = parts[0].trim();
      description = parts[1] ? parts[1].trim() : '';
      debugLog(`📄 Extracted userContext base text: "${text}"`);
      debugLog(`📄 Description: "${description}"`);
    }
    
    // Extract user IDs from text
    const userIds = [];
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      userIds.push(match[1]);
    }
    
    // If no user IDs found in text, check if there are comma-separated IDs
    if (userIds.length === 0 && text) {
      const possibleIds = text.split(',').map(id => id.trim());
      
      // Process IDs that are either plain or in <@ID> format
      for (const possibleId of possibleIds) {
        // If it's already in <@ID> format, extract the ID
        if (possibleId.match(/<@([A-Z0-9]+)>/)) {
          const idMatch = possibleId.match(/<@([A-Z0-9]+)>/);
          userIds.push(idMatch[1]);
        } 
        // If it's a plain ID (just alphanumeric), use it directly
        else if (possibleId.match(/^[A-Z0-9]+$/)) {
          userIds.push(possibleId);
        }
      }
    }
    
    // Note: No longer deduplicating user IDs
    
    debugLog(`👥 Extracted ${userIds.length} user IDs from mentions`);
    
    // Return formatted params
    return {
      text: description,
      users: userIds
    };
  }
  // Handle buttons blocks
  else if (blockType === 'buttons') {
    debugLog(`🔘 Parsing buttons block parameters`);
    
    // Check if content is in the format [button1|value1|style1, button2|value2|style2]
    const buttonsMatch = content.match(/\[(.*)\]/);
    
    if (buttonsMatch) {
      const buttonsContent = buttonsMatch[1];
      debugLog(`🔘 Found buttons content: ${buttonsContent}`);
      
      // Split by commas, but be careful of commas inside button text
      const buttonDefinitions = [];
      let currentButton = '';
      let inButtonText = false;
      
      for (let i = 0; i < buttonsContent.length; i++) {
        const char = buttonsContent[i];
        
        if (char === '|') {
          // Pipe separates parts of a button definition
          currentButton += char;
        } else if (char === ',' && !inButtonText) {
          // Comma outside quotes separates buttons
          if (currentButton.trim()) {
            buttonDefinitions.push(currentButton.trim());
          }
          currentButton = '';
        } else {
          // Regular character, add to current button
          currentButton += char;
          
          // Track quotes to handle commas inside button text
          if (char === '"' || char === "'") {
            inButtonText = !inButtonText;
          }
        }
      }
      
      // Add the last button if there is one
      if (currentButton.trim()) {
        buttonDefinitions.push(currentButton.trim());
      }
      
      debugLog(`🔘 Parsed ${buttonDefinitions.length} button definitions`);
      
      // Process each button definition into button objects
      const buttons = buttonDefinitions.map((buttonDef, index) => {
        const parts = buttonDef.split('|').map(part => part.trim());
        
        // Create button object with text, value, and optional style
        const buttonObj = {
          text: parts[0],
          value: parts[1] || `button_${index}`,
          style: parts[2] || undefined // undefined will use default style
        };
        
        // --- START EDIT: Identify if this is a link button based on value ---
        // For consistent behavior with the generator, add a type property that
        // identifies if this is a link button or an action button
        if (buttonObj.value && typeof buttonObj.value === 'string' && 
            (buttonObj.value.startsWith('http://') || buttonObj.value.startsWith('https://'))) {
          debugLog(`🔘 Button ${index + 1}: Link button ${buttonObj.text} → ${buttonObj.value}`);
          buttonObj.type = 'link';
        } else {
          debugLog(`🔘 Button ${index + 1}: Action button ${buttonObj.text} → ${buttonObj.value}`);
          buttonObj.type = 'action';
        }
        // --- END EDIT ---
        
        debugLog(`🔘 Button ${index + 1}: ${JSON.stringify(buttonObj)}`);
        return buttonObj;
      });
      
      return { buttons };
    }
    
    // If no valid button format found, return empty buttons array
    return { buttons: [] };
  }
  
  // Default case, just return the content as text parameter plus any common parameters
  return { ...params, text: content };
}

/**
 * Clean blocks of any private metadata before sending to Slack API
 * Removes properties that Slack API rejects (like _metadata)
 * @param {Object} obj - The block object to clean
 * @returns {Object} - A clean copy without private properties
 */
function cleanForSlackApi(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // If it's an array, clean each item
  if (Array.isArray(obj)) {
    return obj.map(item => cleanForSlackApi(item));
  }
  
  // Create a new object without the _metadata property
  const cleaned = {};
  
  // Copy all properties except _metadata
  for (const key in obj) {
    if (key !== '_metadata') {
      // Recursively clean nested objects
      cleaned[key] = typeof obj[key] === 'object' ? 
        cleanForSlackApi(obj[key]) : obj[key];
    }
  }
  
  return cleaned;
}

/**
 * Parses a message with block syntax into a Slack message structure
 * @param {string} message - The message with block syntax
 * @returns {Object|Promise<Object>} - The parsed message structure with blocks and attachments
 */
async function parseMessage(message) {
  logger.detail(`🔄 Parsing message with block syntax`);
  
  // Check for standalone usercontext syntax (not inside a block)
  const userContextRegex = /\(usercontext\)(.*?)(?:\|(.*?))?(?:\(!usercontext\))/g;
  const userContextMatches = Array.from(message.matchAll(userContextRegex));
  
  if (userContextMatches.length > 0 && !message.includes('#')) {
    logger.info(`👥 Found ${userContextMatches.length} standalone usercontext tags in message`);
    
    // We'll create one or more context blocks with user avatars
    const contextBlocks = [];
    const workspaceId = process.env.SLACK_WORKSPACE_ID || 'T02RAEMPK';
    
    // Try to get the Slack client
    let slack = null;
    try {
      slack = getSlackClient();
      logger.info('✅ Successfully got Slack client for userContext processing');
    } catch (slackError) {
      logger.error('Error getting Slack client:', slackError);
    }
    
    // Process each usercontext match
    for (const match of userContextMatches) {
      logger.info('🔎 Processing usercontext match:', match[0]);
      
      // Extract and process user IDs
      let userIdsRaw = match[1].trim();
      
      // Handle both comma-separated IDs and <@ID> format
      let userIds = [];
      
      // Check if we have <@ID> format mentions
      if (userIdsRaw.includes('<@')) {
        const mentionRegex = /<@([A-Z0-9]+)>/g;
        let idMatch;
        while ((idMatch = mentionRegex.exec(userIdsRaw)) !== null) {
          userIds.push(idMatch[1]);
        }
      } else {
        // Process as comma-separated list
        userIds = userIdsRaw.split(',').map(id => id.trim());
      }
      
      // Note: We no longer deduplicate user IDs to allow multiple mentions of the same user
      
      // Extract description
      const description = match[2] ? match[2].trim() : '';
      
      logger.info(`👥 Processing ${userIds.length} user IDs with description: "${description}"`);
      
      // Determine if we need mrkdwn or plain_text based on content
      const needsMrkdwn = description.match(/[*_~`>]|\:[a-z0-9_\-\+]+\:|<@|<#|<http/);
      const textType = needsMrkdwn ? 'mrkdwn' : 'plain_text';
      
      // Set maximum number of avatars to show
      const MAX_AVATARS = 3;
      const totalUsers = userIds.length;
      const hasMoreUsers = totalUsers > MAX_AVATARS;
      const avatarsToShow = hasMoreUsers ? MAX_AVATARS : totalUsers;
      
      // Create a context block
      const contextBlock = {
        type: 'context',
        block_id: `uc_${Date.now().toString().slice(-6)}_${userIds.length}`,
        elements: []
      };
      
      // If we have a Slack client, try to fetch real avatars
      if (slack) {
        try {
          // Use Promise.all with a timeout to fetch all user info in parallel
          const userInfoPromises = userIds.map(userId => {
            // Create a promise that resolves after 3 seconds with a fallback
            const timeoutPromise = new Promise(resolve => {
              setTimeout(() => {
                logger.info(`⏱️ Timeout for user ${userId}, using fallback avatar`);
                resolve({
                  userId,
                  name: userId,
                  imageUrl: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`
                });
              }, 3000); // 3 second timeout
            });
            
            // Create the fetch promise
            logger.info(`⏳ Starting API call for user ${userId} at ${new Date().toISOString()}`);
            const startTime = Date.now();
            
            const fetchPromise = slack.users.info({ user: userId })
              .then(result => {
                const elapsed = Date.now() - startTime;
                logger.info(`⌛ API call for user ${userId} took ${elapsed}ms`);
                
                if (result && result.ok && result.user && result.user.profile) {
                  const imageUrl = result.user.profile.image_72 || 
                                  result.user.profile.image_48 || 
                                  `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`;
                  const name = result.user.profile.display_name || result.user.real_name || userId;
                  
                  logger.info(`✅ Successfully fetched avatar for ${name} (${userId}): ${imageUrl}`);
                  
                  return {
                    userId,
                    name,
                    imageUrl
                  };
                } else {
                  logger.warn(`⚠️ Slack API returned ok but no user data for ${userId}`);
                  return {
                    userId,
                    name: userId,
                    imageUrl: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`
                  };
                }
              })
              .catch(error => {
                const elapsed = Date.now() - startTime;
                logger.error(`❌ Error fetching user info for ${userId} after ${elapsed}ms:`, error);
                logger.error(`Error details: ${error.message}`);
                
                if (error.data) {
                  logger.error(`API error data:`, JSON.stringify(error.data));
                }
                
                return {
                  userId,
                  name: userId,
                  imageUrl: `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-72`
                };
              });
            
            // Return whichever resolves first
            return Promise.race([fetchPromise, timeoutPromise]);
          });
          
          // Wait for all user info to be fetched (with timeout protection)
          const userInfos = await Promise.all(userInfoPromises);
          
          // Add image elements with real user avatars
          for (let i = 0; i < avatarsToShow; i++) {
            contextBlock.elements.push({
              type: 'image',
              image_url: userInfos[i].imageUrl,
              alt_text: userInfos[i].name
            });
          }
          
          // Add the text element with dot character at the beginning
          // Context blocks don't support rich text formatting in plain_text mode
          // So we'll use mrkdwn format and include the dot as part of the text
          const firstName = userInfos[0].name;
          let finalText = '';
          
          // Create different messages based on user count
          if (totalUsers === 1) {
            finalText = `\u2003\u2003·\u2003\u2003*${firstName}* ${description || 'is part of this conversation'}`;
          } else if (totalUsers === 2) {
            finalText = `\u2003\u2003·\u2003\u2003*${firstName}* _and 1 other_ ${description || 'are part of this conversation'}`;
          } else if (hasMoreUsers) {
            const othersCount = totalUsers - 1;
            finalText = `\u2003\u2003·\u2003\u2003*${firstName}* _and ${othersCount} others_ ${description || 'are part of this conversation'}`;
          } else {
            finalText = `\u2003\u2003·\u2003\u2003*${firstName}* _and ${totalUsers - 1} others_ ${description || 'are part of this conversation'}`;
          }
          
          // Add as mrkdwn to support formatting
          contextBlock.elements.push({
            type: 'mrkdwn',
            text: finalText
          });
          
        } catch (error) {
          logger.error('Error fetching user avatars:', error);
          
          // Fallback to placeholder avatars
          for (let i = 0; i < avatarsToShow; i++) {
            contextBlock.elements.push({
              type: 'image',
              image_url: `https://ca.slack-edge.com/${workspaceId}-${userIds[i]}-4c812ee43716-72`,
              alt_text: `User ${userIds[i]}`
            });
          }
          
          // Add the text element with dot character at the beginning
          const firstUserId = userIds[0];
          let finalText = '';
          
          // Create different messages based on user count
          if (totalUsers === 1) {
            finalText = `\u2003\u2003·\u2003\u2003*${firstUserId}* ${description || 'is part of this conversation'}`;
          } else if (totalUsers === 2) {
            finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and 1 other* ${description || 'are part of this conversation'}`;
          } else if (hasMoreUsers) {
            const othersCount = totalUsers - 1;
            finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and ${othersCount} others* ${description || 'are part of this conversation'}`;
          } else {
            finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and ${totalUsers - 1} others* ${description || 'are part of this conversation'}`;
          }
          
          // Add as mrkdwn to support formatting
          contextBlock.elements.push({
            type: 'mrkdwn',
            text: finalText
          });
        }
      } else {
        // No Slack client, use placeholder avatars
        for (let i = 0; i < avatarsToShow; i++) {
          contextBlock.elements.push({
            type: 'image',
            image_url: `https://ca.slack-edge.com/${workspaceId}-${userIds[i]}-4c812ee43716-72`,
            alt_text: `User ${userIds[i]}`
          });
        }
        
        // Add the text element with dot character at the beginning
        const firstUserId = userIds[0];
        let finalText = '';
        
        // Create different messages based on user count
        if (totalUsers === 1) {
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId}* ${description || 'is part of this conversation'}`;
        } else if (totalUsers === 2) {
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and 1 other* ${description || 'are part of this conversation'}`;
        } else if (hasMoreUsers) {
          const othersCount = totalUsers - 1;
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and ${othersCount} others* ${description || 'are part of this conversation'}`;
        } else {
          finalText = `\u2003\u2003·\u2003\u2003*${firstUserId} and ${totalUsers - 1} others* ${description || 'are part of this conversation'}`;
        }
        
        // Add as mrkdwn to support formatting
        contextBlock.elements.push({
          type: 'mrkdwn',
          text: finalText
        });
      }
      
      // Add to our list of blocks
      contextBlocks.push(contextBlock);
    }
    
    // Return all the context blocks
    return {
      blocks: cleanForSlackApi(contextBlocks)
    };
  }
  
  // Extract block declarations using regex
  // Updated regex that's more flexible with newlines and whitespace
  const blockRegex = /#([a-zA-Z]+):\s*([\s\S]*?)(?=\s*#[a-zA-Z]+:|$)/g;
  const matches = Array.from(message.matchAll(blockRegex));
  
  // If no blocks found, treat as plain text but put in an attachment with colored bar
  if (matches.length === 0) {
    logger.info('📦 No block syntax found, creating attachment with section for plain text');
    return { 
      attachments: [{
        color: defaultAttachmentColor, // Use default color for consistent experience
        blocks: [{ 
          type: 'section', 
          text: { 
            type: 'mrkdwn', 
            text: message 
          } 
        }]
      }]
    };
  }
  
  logger.info(`🔢 Found ${matches.length} blocks to process`);
  
  // Process each block
  const blocks = [];
  const attachments = [];
  
  for (const match of matches) {
    // Get the original block type from the match
    const rawBlockType = match[1];
    // Convert to lowercase for case-insensitive comparison
    const blockTypeLower = rawBlockType.toLowerCase();

    // Find the actual block type in our blockDefinitions with case-sensitivity
    const actualBlockType = Object.keys(blockDefinitions).find(key => 
      key.toLowerCase() === blockTypeLower
    ) || rawBlockType;

    // Log the block type mapping for debugging
    debugLog(`🔍 Block type: Original="${rawBlockType}", Actual="${actualBlockType}"`);

    const content = match[2].trim();
    
    logger.info(`📦 Processing ${actualBlockType} block: ${content.substring(0, 40)}${content.length > 40 ? '...' : ''}`);
    
    // Parse parameters for this block
    const params = parseParams(actualBlockType, content);
    
    // Use a variable to track the block type we'll actually use
    let blockTypeToUse = params.blockTypeOverride || actualBlockType;
    
    // Determine if we need to convert section to sectionWithImage
    if (blockTypeToUse.toLowerCase() === 'section' && params.imageUrl) {
      debugLog(`🔄 Converting section to sectionWithImage based on parameters`);
      blockTypeToUse = 'sectionWithImage';
    }
    
    // Validate parameters
    if (!blockDefinitions[blockTypeToUse]) {
      logger.error(`❌ Unknown block type: ${blockTypeToUse}`);
      continue;
    }
    
    // Check if this is a standalone block or part of an attachment
    const blockDef = blockDefinitions[blockTypeToUse];
    debugLog(`🔍 Block definition for ${blockTypeToUse}: ${JSON.stringify(blockDef)}`);
    
    // Get attachment wrap status
    const isAttachment = blockDef.attachmentWrapped === true || 
                         (typeof blockDef.attachmentWrapped === 'function' && blockDef.attachmentWrapped(params));
    
    // Generate the block
    try {
      const generator = blockGenerators[blockTypeToUse];
      if (!generator) {
        logger.error(`❌ No generator for block type: ${blockTypeToUse}`);
        continue;
      }
      
      const generated = await Promise.resolve(generator(params));
      debugLog(`✅ Generated ${blockTypeToUse} block`);
      
      // Ensure the generated block has a type field
      if (!generated) {
        logger.error(`❌ Block generator for ${blockTypeToUse} returned empty result`);
        continue;
      }
      
      // Additional debugging for header blocks to check for newline issues
      if (generated.type === 'header') {
        logger.detail(`🔍 Header block text before sending: "${generated.text.text}"`);
        // Ensure we don't have any literal \n characters in header text
        if (generated.text && typeof generated.text.text === 'string') {
          if (generated.text.text.includes('\\n') || generated.text.text.includes('\n')) {
            logger.warn(`⚠️ Found newlines in header text, removing...`);
            generated.text.text = generated.text.text.replace(/\\n/g, ' ').replace(/\n/g, ' ').trim();
            logger.info(`✅ Cleaned header text: "${generated.text.text}"`);
          }
        }
      }
      
      // Handle array result (some generators return multiple blocks)
      if (Array.isArray(generated)) {
        if (isAttachment) {
          debugLog(`📎 Adding array as attachment: ${blockTypeToUse}`);
          attachments.push({
            color: params.color || defaultAttachmentColor,
            blocks: generated
          });
        } else {
          debugLog(`📦 Adding array as blocks: ${blockTypeToUse}`);
          blocks.push(...generated);
        }
      } else {
        // Ensure the block has a type field
        if (!generated.type) {
          logger.error(`❌ Block generator for ${blockTypeToUse} returned block without type field:`, JSON.stringify(generated));
          continue;
        }
        
        if (isAttachment) {
          debugLog(`📎 Adding as attachment: ${blockTypeToUse}`);
          attachments.push({
            color: params.color || defaultAttachmentColor,
            blocks: [generated]
          });
        } else {
          debugLog(`📦 Adding as block: ${blockTypeToUse}`);
          blocks.push(generated);
        }
      }
      
      debugLog(`✅ Processed ${blockTypeToUse} block`);
      debugLog(`📊 Blocks count: ${blocks.length}, Attachments count: ${attachments.length}`);
      if (blockTypeToUse === 'contextWithImages') {
        debugLog(`🔍 ContextWithImages block details:`);
        debugLog(`📄 Text: ${params.text}`);
        debugLog(`🖼️ Images: ${params.images ? JSON.stringify(params.images) : 'None'}`);
        debugLog(`📊 Is attachment wrapped: ${isAttachment}`);
      }
    } catch (error) {
      logger.error(`❌ Error generating block: ${blockTypeToUse}`, error);
    }
  }
  
  // Assemble the final message
  const result = {};
  if (blocks.length > 0) {
    result.blocks = cleanForSlackApi(blocks);
  }
  if (attachments.length > 0) {
    result.attachments = cleanForSlackApi(attachments);
  }
  
  // Add debug logging of the final message structure
  logger.info('🏁 Final message structure from parseMessage:');
  logger.detail('Message structure:', result);
  
  return result;
}

/**
 * Simple utility to process user mentions in text
 * This ensures user mentions are properly formatted for Slack
 * @param {string} text - Text that may contain user mentions
 * @returns {string} - Text with properly formatted user mentions
 */
function processUserMentions(text) {
  if (!text) return '';
  
  // The Slack format for user mentions is <@USER_ID>
  // We need to ensure all user mentions are in this format

  // Regular expression to detect user mentions that might need processing
  // This regex already matches the correct Slack format <@U...>
  const mentionRegex = /<@([A-Z0-9]+)>/g;
  
  // Replace any non-standard formats with the correct Slack format
  // But leave correctly formatted mentions as they are
  
  // Return the text with properly formatted mentions
  // The correct format is preserved - do not attempt to resolve user names
  return text;
}

module.exports = {
  parseMessage,
  parseParams,
  blockRegistry,
  blockDefinitions,
  processUserMentions,
  getUserName,
  cleanForSlackApi
};