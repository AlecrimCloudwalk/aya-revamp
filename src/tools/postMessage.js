// Posts messages to Slack
const { formatSlackMessage } = require('../slackFormat.js');
const { logError } = require('../errors.js');
const { getSlackClient } = require('../slackClient.js');

/**
 * Convert named colors to proper hex values
 * @param {string} color - The color name or hex value
 * @returns {string} - A properly formatted color value
 */
function normalizeColor(color) {
  // Default to blue if no color specified
  if (!color) return '#0078D7';
  
  // If it's already a hex code with #, return as is
  if (color.startsWith('#')) return color;
  
  // If it's a hex code without #, add it
  if (color.match(/^[0-9A-Fa-f]{6}$/)) {
    return `#${color}`;
  }
  
  // Map of named colors to hex values
  const colorMap = {
    // Slack's standard colors
    'good': '#2EB67D',     // Green
    'warning': '#ECB22E',  // Yellow
    'danger': '#E01E5A',   // Red
    
    // Additional standard colors
    'blue': '#0078D7',
    'green': '#2EB67D',
    'red': '#E01E5A',
    'orange': '#F2952F', 
    'purple': '#6B46C1',
    'cyan': '#00BCD4',
    'teal': '#008080',
    'magenta': '#E91E63',
    'yellow': '#FFEB3B',
    'pink': '#FF69B4',
    'brown': '#795548',
    'black': '#000000',
    'white': '#FFFFFF',
    'gray': '#9E9E9E',
    'grey': '#9E9E9E'
  };
  
  // Return the mapped color or default to blue
  return colorMap[color.toLowerCase()] || '#0078D7';
}

/**
 * Process text to handle user mentions in the format <@USER_ID>
 * @param {string} text - The text to process
 * @returns {string} - Text with proper Slack user mentions
 */
function processUserMentions(text) {
  if (!text) return text;
  
  // Replace <@USER_ID> with proper Slack mention format
  return text.replace(/<@([A-Z0-9]+)>/g, '@$1');
}

/**
 * Parse rich text with markers into Block Kit blocks
 * 
 * @param {string} text - Rich text with markers
 * @returns {Array} - Array of Block Kit blocks
 */
function parseRichText(text) {
  if (!text) return [];
  
  const blocks = [];
  
  // Split text by double newlines to create sections
  const paragraphs = text.split(/\n{2,}/);
  
  paragraphs.forEach(paragraph => {
    // Check for special markers
    const trimmedParagraph = paragraph.trim();
    
    // Handle various divider formats
    if (trimmedParagraph === '---' || 
        trimmedParagraph === '---\n' || 
        trimmedParagraph === '!divider!' || 
        trimmedParagraph === '!divider' || 
        trimmedParagraph === '[divider]' ||
        trimmedParagraph === '{divider}' ||
        trimmedParagraph === '{"type":"divider"}') {
      // Divider
      blocks.push({ type: 'divider' });
    } else if (trimmedParagraph.startsWith('#') && !trimmedParagraph.startsWith('##')) {
      // Header (# Header text)
      const headerText = trimmedParagraph.substring(1).trim();
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerText,
          emoji: true
        }
      });
    } else if (trimmedParagraph.startsWith('> ')) {
      // Context block (> Context text)
      const contextText = trimmedParagraph.substring(2).trim();
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: contextText
          }
        ]
      });
    } else if (trimmedParagraph.startsWith('!image:')) {
      // Image (!image:url:alt_text)
      const imageString = trimmedParagraph.substring(7);
      const firstColonIndex = imageString.indexOf(':');
      
      if (firstColonIndex > 0) {
        const imageUrl = imageString.substring(0, firstColonIndex);
        const altText = imageString.substring(firstColonIndex + 1) || 'Image';
        
        blocks.push({
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        });
      }
    } else if (trimmedParagraph.startsWith('!emojis:')) {
      // Emoji showcase (!emojis:basketball,snowboarder,checkered_flag)
      const emojiString = trimmedParagraph.substring(8).trim();
      const emojiNames = emojiString.split(',').map(e => e.trim());
      
      if (emojiNames.length > 0) {
        const richTextElements = [];
        
        emojiNames.forEach((emojiName, index) => {
          // Add emoji
          richTextElements.push({
            type: 'emoji',
            name: emojiName
          });
          
          // Add space between emojis (except after the last one)
          if (index < emojiNames.length - 1) {
            richTextElements.push({
              type: 'text',
              text: ' '
            });
          }
        });
        
        blocks.push({
          type: 'rich_text',
          elements: [
            {
              type: 'rich_text_section',
              elements: richTextElements
            }
          ]
        });
      }
    } else if (trimmedParagraph.startsWith('!big-emoji:')) {
      // Single big emoji emphasis (!big-emoji:tada)
      const emojiName = trimmedParagraph.substring(11).trim();
      
      if (emojiName) {
        blocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `:${emojiName}:` // Slack will render this as a larger emoji in a context block
            }
          ]
        });
      }
    } else {
      // Regular section
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: trimmedParagraph
        }
      });
    }
  });
  
  return blocks;
}

/**
 * Create buttons from button definitions
 * 
 * @param {Array} buttons - Array of button definitions
 * @returns {Object} - Actions block with buttons
 */
function createButtonsBlock(buttons) {
  if (!buttons || !Array.isArray(buttons) || buttons.length === 0) return null;
  
  const buttonElements = buttons.map((button, index) => {
    // Handle different formats of button definition
    let text, value, url, style;
    
    if (typeof button === 'string') {
      // Simple string becomes button text and value
      text = button;
      value = button.toLowerCase().replace(/\s+/g, '_');
    } else {
      // Object with properties
      text = button.text || 'Button';
      value = button.value || text.toLowerCase().replace(/\s+/g, '_');
      url = button.url;
      style = button.style;
    }
    
    const buttonElement = {
      type: 'button',
      text: {
        type: 'plain_text',
        text,
        emoji: true
      },
      value,
      action_id: `button_${index}`
    };
    
    // Add URL if provided
    if (url) buttonElement.url = url;
    
    // Add style if provided and valid
    if (style && ['primary', 'danger'].includes(style)) {
      buttonElement.style = style;
    }
    
    return buttonElement;
  });
  
  return {
    type: 'actions',
    elements: buttonElements
  };
}

/**
 * Create fields block from field definitions
 * 
 * @param {Array} fields - Array of field definitions
 * @returns {Object} - Section block with fields
 */
function createFieldsBlock(fields) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) return null;
  
  const formattedFields = fields.map(field => {
    if (typeof field === 'string') {
      return {
        type: 'mrkdwn',
        text: field
      };
    }
    
    // Object with title/value
    if (field.title && field.value) {
      return {
        type: 'mrkdwn',
        text: `*${field.title}*\n${field.value}`
      };
    }
    
    // Just use the text property
    return {
      type: field.type || 'mrkdwn',
      text: field.text || ''
    };
  });
  
  return {
    type: 'section',
    fields: formattedFields
  };
}

/**
 * Posts a message to a channel
 * @param {Object} args - The arguments for the message
 * @param {string} args.text - The text content of the message
 * @param {string} [args.title] - An optional title for the message
 * @param {string} [args.color] - An optional color for the message (blue, green, red, orange, purple or hex code)
 * @param {Array} [args.buttons] - Optional array of button definitions
 * @param {Array} [args.fields] - Optional array of field definitions for two-column layout
 * @param {Array} [args.images] - Optional array of image URLs to include
 * @param {Array} [args.blocks] - Optional array of simplified block definitions (for advanced usage)
 * @param {Object} threadState - The current thread state
 * @returns {Promise<Object>} - Result of posting the message
 * 
 * Note: Block Kit blocks are placed inside attachments along with the color property
 * to ensure the vertical colored bar appears with the content in Slack messages.
 */
async function postMessage(args, threadState) {
  try {
    // Handle potential nested parameters structure 
    // This happens when the LLM returns {"tool": "postMessage", "parameters": {...}}
    if (args.parameters && !args.text && !args.title) {
      console.log('⚠️ Detected nested parameters structure in postMessage, extracting inner parameters');
      args = args.parameters;
    }

    // Filter out non-standard fields that shouldn't be sent to Slack
    // This prevents fields like 'reasoning' from being incorrectly included
    const validFields = [
      'text', 'title', 'color', 'buttons', 'fields', 
      'images', 'blocks', 'attachments', 'channel', 'threadTs'
    ];
    
    const filteredArgs = {};
    for (const key of validFields) {
      if (args[key] !== undefined) {
        filteredArgs[key] = args[key];
      }
    }
    
    // Log any filtered fields for debugging
    const filteredKeys = Object.keys(args).filter(key => !validFields.includes(key));
    if (filteredKeys.length > 0) {
      console.log(`⚠️ Filtered out non-standard fields: ${filteredKeys.join(', ')}`);
    }
    
    // Use filtered args from now on
    args = filteredArgs;

    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Extract parameters
    const {
      text,
      title,
      color = 'good',
      buttons,
      fields,
      images,
      blocks: simpleBlocks
    } = args;
    
    // Prevent duplication - if blocks are provided, they take precedence over text
    // This helps avoid the issue where similar content appears twice
    let effectiveText = text;
    if (simpleBlocks && Array.isArray(simpleBlocks) && simpleBlocks.length > 0) {
      console.log('⚠️ Both text and blocks are provided. Using blocks and ignoring text to prevent duplication.');
      effectiveText = null;
    }
    
    // CRITICAL FIX: Ignore any hardcoded channel that doesn't match current context
    // (This happens when the LLM hallucinates channel IDs)
    let channelId;
    if (args.channel && context?.channelId && args.channel !== context.channelId) {
      // Channel mismatch - log warning and use context channel instead
      console.log(`⚠️ WARNING: Ignoring mismatched channel ID "${args.channel}" - using context channel "${context.channelId}" instead`);
      channelId = context.channelId;
    } else {
      // Use channel from args, or fall back to context
      channelId = args.channel || context?.channelId;
    }
    
    // CRITICAL FIX: Ignore any hardcoded threadTs that doesn't match current context
    // (This happens when the LLM hallucinates thread timestamps)
    let threadTimestamp;
    if (args.threadTs && context?.threadTs && args.threadTs !== context.threadTs) {
      // Thread timestamp mismatch - log warning and use context threadTs instead
      console.log(`⚠️ WARNING: Ignoring mismatched thread timestamp "${args.threadTs}" - using context timestamp "${context.threadTs}" instead`);
      threadTimestamp = context.threadTs;
    } else {
      // Use threadTs from args, or fall back to context
      threadTimestamp = args.threadTs || context?.threadTs;
    }
    
    // Validate channel
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    // Debug the message about to be sent
    console.log(`Sending message to channel: ${channelId}`);
    console.log(`Message content: ${effectiveText ? (effectiveText.length > 100 ? effectiveText.substring(0, 100) + '...' : effectiveText) : 'No text'}`);
    console.log(`Title: ${title || 'No title'}`);
    console.log(`Color: ${color || 'default'}`);
    console.log(`Using text for fallback only, content will be displayed in blocks inside attachment`);
    if (threadTimestamp) {
      console.log(`Replying in thread: ${threadTimestamp}`);
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Normalize the color value
    const formattedColor = normalizeColor(color);
    console.log(`Using color: ${formattedColor}`);
    
    // Use Block Kit blocks directly in the message
    let messageOptions = {
      channel: channelId,
      text: "" // Empty string for fallback - CRITICAL: must be empty to prevent duplication in the UI
    };
    
    // Message structure for Slack API:
    // 1. empty text field to prevent duplication
    // 2. blocks go inside the colored attachment
    // 3. color goes on the attachment
    // This structure ensures we get the colored vertical bar and no duplicated content
    
    // Check which approach to use
    if (args.blockKit) {
      console.log('⚠️ DEPRECATED: Direct Block Kit JSON provided, this approach is discouraged.');
      // Still handle it for backward compatibility
      messageOptions = handleDirectBlocks(args, channelId);
    } else if (simpleBlocks && Array.isArray(simpleBlocks) && simpleBlocks.length > 0) {
      // Use our simplified blocks approach
      console.log('Using simplified blocks approach');
      
      // Note: We're not using convertSimpleBlocks here anymore because
      // Slack's API has different requirements for blocks in attachments vs. top-level blocks
      // We need to ensure all blocks in attachments have simple text structures
      
      // Initialize duplication check variables
      let skipTitle = false;
      
      // Check if the first block is a header and we also have a title
      // to prevent duplication
      if (title && simpleBlocks.length > 0 && 
          simpleBlocks[0].type === 'header' && 
          simpleBlocks[0].text && 
          simpleBlocks[0].text.text === title) {
        console.log('⚠️ Detected duplicate title in header block. Will skip adding title separately.');
        skipTitle = true;
      }
      
      // Handle Slack's limitation - blocks in attachments have different requirements
      // Cannot use certain block types directly in attachments
      // Convert complex block structures to simpler text-based blocks
      const simplifiedBlocks = [];
      
      // Process each block to ensure compatibility with attachments
      for (const block of simpleBlocks) {
        if (block.type === 'header') {
          // Convert header blocks to section blocks with bold text
          simplifiedBlocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${block.text?.text || 'Header'}*`
            }
          });
        } else if (block.type === 'divider') {
          // Special handling for divider blocks - keep them as is
          simplifiedBlocks.push({
            type: 'divider'
          });
        } else if (block.type === 'context' && block.elements) {
          // Handle context blocks directly
          const contextElements = [];
          
          // Process each element in the context block
          for (const element of block.elements) {
            if (typeof element === 'string') {
              contextElements.push({
                type: 'mrkdwn',
                text: element
              });
            } else if (element.type === 'mrkdwn' || element.type === 'plain_text') {
              contextElements.push(element);
            } else {
              // Convert unknown element types to text
              contextElements.push({
                type: 'mrkdwn',
                text: typeof element.text === 'string' ? element.text : JSON.stringify(element)
              });
            }
          }
          
          // Push the context block with processed elements
          simplifiedBlocks.push({
            type: 'context',
            elements: contextElements
          });
        } else if (block.type === 'image' && block.image_url) {
          // Handle image blocks by converting to a section with a markdown image link
          // (Since images in attachments can be problematic in Slack)
          simplifiedBlocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${block.image_url}|${block.alt_text || 'Image'}>`
            }
          });
        } else if (block.type === 'section' && block.text) {
          // Ensure section blocks have the right structure
          simplifiedBlocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: typeof block.text === 'string' ? block.text : 
                    (block.text.text || block.text.mrkdwn || 'Text content')
            }
          });
        } else {
          // For other block types, convert to a simple section if needed
          if (typeof block === 'object' && block !== null) {
            let text = '';
            if (typeof block.text === 'string') {
              text = block.text;
            } else if (block.text && typeof block.text.text === 'string') {
              text = block.text.text;
            } else if (block.text && typeof block.text.mrkdwn === 'string') {
              text = block.text.mrkdwn;
            } else {
              // This is where objects were being stringified incorrectly
              // Instead, handle unknown block types more gracefully
              if (block.type) {
                console.log(`⚠️ Unsupported block type '${block.type}' in attachment. Converting to text.`);
              }
              text = JSON.stringify(block);
            }
            
            simplifiedBlocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: text
              }
            });
          } else {
            // Handle primitive values
            simplifiedBlocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: String(block)
              }
            });
          }
        }
      }
      
      // FIX: Place blocks inside the attachment with color instead of directly in the message
      // This ensures the colored vertical bar appears with the content
      messageOptions.attachments = [{
        color: formattedColor,
        blocks: simplifiedBlocks, 
        fallback: title || effectiveText || "Message from bot"
      }];
    } else {
      // Use our new rich text approach
      console.log('Using rich text approach');
      
      // Initialize duplication check variables
      let skipTitle = false;
      
      // Start with blocks from rich text parsing
      const textBlocks = parseRichText(effectiveText);
      
      // Check if the first block contains the title to prevent duplication
      if (title && textBlocks.length > 0) {
        // Check header blocks
        if (textBlocks[0].type === 'header' && 
            textBlocks[0].text && 
            textBlocks[0].text.text === title) {
          console.log('⚠️ Detected duplicate title in header block. Will skip adding title separately.');
          skipTitle = true;
        }
        // Check section blocks that might have the title as bold text
        else if (textBlocks[0].type === 'section' && 
                 textBlocks[0].text && 
                 textBlocks[0].text.text && 
                 textBlocks[0].text.text.replace(/\*/g, '') === title) {
          console.log('⚠️ Detected title in first section block. Will skip adding title separately.');
          skipTitle = true;
        }
      }
      
      // Add a header as a section with bold text, not a header block
      // since header blocks in attachments aren't supported the same way
      if (title && !skipTitle) {
        textBlocks.unshift({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${title}*`
          }
        });
      }
      
      // Add fields block if fields are provided
      const fieldsBlock = createFieldsBlock(fields);
      if (fieldsBlock) {
        textBlocks.push(fieldsBlock);
      }
      
      // Add image blocks if images are provided
      if (images && Array.isArray(images)) {
        images.forEach(image => {
          if (typeof image === 'string') {
            textBlocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `<${image}|Image>` // Convert to a link instead of image block
              }
            });
          } else if (image && typeof image === 'object') {
            textBlocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `<${image.url || image.image_url}|${image.alt_text || 'Image'}>`
              }
            });
          }
        });
      }
      
      // Add buttons block if buttons are provided
      const buttonsBlock = createButtonsBlock(buttons);
      if (buttonsBlock) {
        // Convert button actions to text links for compatibility
        const buttonLinks = buttonsBlock.elements.map(btn => {
          const btnText = btn.text.text;
          return btn.url ? 
            `<${btn.url}|${btnText}>` : 
            `[${btnText}]`;
        }).join(' | ');
        
        textBlocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: buttonLinks
          }
        });
      }
      
      // FIX: Place blocks inside the attachment with color instead of directly in the message
      // This ensures the colored vertical bar appears with the content
      messageOptions.attachments = [{
        color: formattedColor,
        blocks: textBlocks,
        fallback: title || effectiveText || "Message from bot"
      }];
    }
    
    // Add thread_ts if we have a valid thread timestamp
    if (threadTimestamp) {
      messageOptions.thread_ts = threadTimestamp;
    }
    
    // Log the full message structure for debugging
    console.log('OUTGOING MESSAGE - Message structure:');
    console.log(JSON.stringify({
      hasText: !!messageOptions.text,
      textLength: messageOptions.text?.length,
      hasBlocks: !!messageOptions.blocks && messageOptions.blocks.length > 0,
      blockCount: messageOptions.blocks?.length || 0,
      hasAttachments: !!messageOptions.attachments && messageOptions.attachments.length > 0,
      attachmentCount: messageOptions.attachments?.length || 0,
      threadTs: messageOptions.thread_ts || null
    }, null, 2));
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageOptions);
    
    // Structured response for the LLM
    return {
      messageTs: response.ts,
      channelId: response.channel,
      metadata: {
        userId: context?.userId,
        threadTs: threadTimestamp
      }
    };
  } catch (error) {
    logError('Error posting message to Slack', error, { args });
    throw error;
  }
}

/**
 * Handles direct Block Kit format for advanced usage
 * @deprecated Use simplified blocks parameter instead of direct Block Kit
 * 
 * @param {Object} args - Message arguments
 * @param {string} channel - Channel ID
 * @returns {Object} - Formatted message options for Slack API
 */
function handleDirectBlocks(args, channel) {
  console.log('⚠️ DEPRECATED: HANDLING DIRECT BLOCKS - Use simplified blocks parameter instead');
  console.log(JSON.stringify({
    hasText: !!args.text,
    textLength: args.text?.length,
    blocksType: typeof args.blockKit,
    isBlocksArray: Array.isArray(args.blockKit),
    blocksLength: Array.isArray(args.blockKit) ? args.blockKit.length : 
                  (typeof args.blockKit === 'string' ? args.blockKit.length : 'N/A')
  }, null, 2));

  let formattedBlocks = args.blockKit;
  
  // Normalize the color value
  const formattedColor = normalizeColor(args.color);
  console.log(`Using color: ${formattedColor}`);
  
  // If blocks is a string, try to parse it as JSON, otherwise use formatSlackMessage
  if (typeof args.blockKit === 'string') {
    // Try to parse it first as JSON
    try {
      // Check if it looks like JSON (starts with [ or {)
      if (args.blockKit.trim().startsWith('[') || args.blockKit.trim().startsWith('{')) {
        formattedBlocks = JSON.parse(args.blockKit);
      } else {
        // Not JSON, use it as text in a section block
        formattedBlocks = [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: args.blockKit
            }
          }
        ];
      }
    } catch (parseError) {
      console.log(`Error parsing blocks JSON: ${parseError.message}. Using as plain text.`);
      // If parsing fails, use it as text in a section block
      formattedBlocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: args.blockKit
          }
        }
      ];
    }
  }
  
  // Ensure blocks is an array if present
  if (formattedBlocks && !Array.isArray(formattedBlocks)) {
    console.log(`Blocks is not an array: ${typeof formattedBlocks}. Converting to array.`);
    formattedBlocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: String(formattedBlocks)
        }
      }
    ];
  }
  
  // Return message options with blocks directly and an attachment just for the color
  return {
    channel,
    text: "", // Empty string for fallback, content will be in blocks
    blocks: formattedBlocks,
    attachments: [{
      color: formattedColor,
      // Note: We're intentionally not putting blocks in the attachment here
      // because Slack has stricter requirements for block structure in attachments
      fallback: args.text || args.title || "Message from assistant"
    }]
  };
}

module.exports = {
  postMessage,
  parseRichText,
  createButtonsBlock,
  createFieldsBlock,
  handleDirectBlocks,
  normalizeColor
}; 