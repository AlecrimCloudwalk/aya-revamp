/**
 * Modular Block Builder for Slack Block Kit
 * 
 * A simpler, more maintainable approach to building Slack Block Kit messages
 * using a consistent syntax designed for easier LLM integration.
 */

// Debug logging function
function debugLog(message, data) {
  if (process.env.DEBUG === 'true' || process.env.DEBUG_SLACK === 'true') {
    if (data) {
      console.log(message, data);
    } else {
      console.log(message);
    }
  }
}

// Default color for attachments
const defaultAttachmentColor = '#36C5F0'; // Slack blue

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
  
  header: (params) => ({
    type: 'header',
    text: {
      type: 'plain_text',
      text: params.text,
      emoji: true
    }
  }),
  
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
            console.error(`🔴 Error adding image #${index + 1}:`, imgError);
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
      console.error('🔴 Error in contextWithImages generator:', error);
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
  
  // Implement remaining generators...
  sectionWithUsers: (params) => {
    // Implementation here
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: params.text
      }
    };
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
        return {
          type: 'button',
          text: {
            type: 'plain_text',
            text: btn.text,
            emoji: true
          },
          style: btn.style || 'default',
          value: btn.value || `button_${index}`,
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
 * Parse parameters for a specific block type from content string
 * @param {string} blockType - The type of block
 * @param {string} content - The content string with parameters
 * @returns {Object} - Parsed parameters
 */
function parseParams(blockType, content) {
  // Add debug logging
  debugLog(`🔍 Parsing ${blockType} parameters from: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);

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
    
    return { text, images };
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
    
    return { url, altText };
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
    return { text };
  }
  
  // Default case, just return the content as text parameter
  return { text: content };
}

/**
 * Parses a message with block syntax into a Slack message structure
 * @param {string} message - The message with block syntax
 * @returns {Object} - The parsed message structure with blocks and attachments
 */
function parseMessage(message) {
  console.log(`🔄 Parsing message with block syntax`);
  
  // Extract block declarations using regex
  const blockRegex = /#([a-zA-Z]+):\s*([^#]+?)(?=#[a-zA-Z]+:|$)/g;
  const matches = Array.from(message.matchAll(blockRegex));
  
  // If no blocks found, treat as plain text
  if (matches.length === 0) {
    return { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: message } }] };
  }
  
  console.log(`🔢 Found ${matches.length} blocks to process`);
  
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
    
    console.log(`📦 Processing ${actualBlockType} block: ${content.substring(0, 40)}${content.length > 40 ? '...' : ''}`);
    
    // Parse parameters for this block
    const params = parseParams(actualBlockType, content);
    
    // Use a variable to track the block type we'll actually use
    let blockTypeToUse = actualBlockType;
    
    // Determine if we need to convert section to sectionWithImage
    if (blockTypeToUse.toLowerCase() === 'section' && params.imageUrl) {
      debugLog(`🔄 Converting section to sectionWithImage based on parameters`);
      blockTypeToUse = 'sectionWithImage';
    }
    
    // Validate parameters
    if (!blockDefinitions[blockTypeToUse]) {
      console.error(`❌ Unknown block type: ${blockTypeToUse}`);
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
        console.error(`❌ No generator for block type: ${blockTypeToUse}`);
        continue;
      }
      
      const generated = generator(params);
      debugLog(`✅ Generated ${blockTypeToUse} block`);
      
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
      
      debugLog(`✅ Processed ${blockTypeToUse} block`);
      debugLog(`📊 Blocks count: ${blocks.length}, Attachments count: ${attachments.length}`);
      if (blockTypeToUse === 'contextWithImages') {
        debugLog(`🔍 ContextWithImages block details:`);
        debugLog(`📄 Text: ${params.text}`);
        debugLog(`🖼️ Images: ${params.images ? JSON.stringify(params.images) : 'None'}`);
        debugLog(`📊 Is attachment wrapped: ${isAttachment}`);
      }
    } catch (error) {
      console.error(`❌ Error generating block: ${blockTypeToUse}`, error);
    }
  }
  
  // Assemble the final message
  const result = {};
  if (blocks.length > 0) {
    result.blocks = blocks;
  }
  if (attachments.length > 0) {
    result.attachments = attachments;
  }
  
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
  
  // Convert <@USER_ID> format (already correct for Slack)
  // This is just a placeholder - in a real implementation,
  // you might need more complex logic for user mentions
  return text;
}

module.exports = {
  parseMessage,
  parseParams,
  blockRegistry,
  blockDefinitions,
  processUserMentions
}; 