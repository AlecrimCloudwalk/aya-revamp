// Posts messages to Slack
// 
// MANDATORY RULES:
// 1. The text field outside of blocks and attachments MUST ALWAYS be empty ("") to prevent duplicate text
// 2. All message content MUST be placed inside an attachments block to ensure proper vertical colored bar display
// 3. Never place content directly in blocks at the top level, always use attachments with blocks inside
//
const { formatSlackMessage } = require('../slackFormat.js');
const { logError } = require('../errors.js');
const { getSlackClient } = require('../slackClient.js');
const { parseMessage } = require('./blockBuilder');

/**
 * Conditionally log messages based on environment variables
 * @param {string} message - The message to log
 * @param {Object} [data] - Optional data to log
 */
function debugLog(message, data) {
  if (process.env.DEBUG === 'true' || process.env.DEBUG_SLACK === 'true') {
    if (data) {
      console.log(message, data);
    } else {
      console.log(message);
    }
  }
}

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
  
  // If text already contains properly formatted user mentions, don't double process
  if (text.includes('<@U') || text.includes('<@W')) {
    // Check if any mentions need to be fixed
    return fixMalformedMentions(text);
  }
  
  console.log('👤 Processing text for user mentions:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
  
  // First, normalize any improper format like <@|USER_ID> to proper format
  text = text.replace(/<@\|([A-Z0-9]+)>/g, '<@$1>');
  
  // Convert @USER_ID format to <@USER_ID>
  text = text.replace(/@([A-Z0-9]{8,})\b/g, '<@$1>');
  
  // For non-@ prefixed IDs, more carefully convert only those that match Slack ID patterns
  text = text.replace(/\b([UW][A-Z0-9]{8,})\b/g, (match, userId) => {
    console.log(`👤 Converting user ID to mention: ${userId}`);
    return `<@${userId}>`;
  });
  
  return text;
}

/**
 * Fix any malformed user mentions in text
 * @param {string} text - The text to process
 * @returns {string} - Text with fixed user mentions
 */
function fixMalformedMentions(text) {
  if (!text) return text;
  
  // Fix cases where the mention format is broken like "<@USER_ID" (missing closing >)
  text = text.replace(/<@([UW][A-Z0-9]{8,})(?!\>)/g, (match, userId) => {
    console.log(`🔧 Fixing malformed user mention: ${match}`);
      return `<@${userId}>`;
  });
  
  // Fix cases with extra spaces in mentions like "< @USER_ID>"
  text = text.replace(/< ?@([UW][A-Z0-9]{8,}) ?>/g, '<@$1>');
  
  return text;
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
        
        // Use an actual image block to display the image
        blocks.push({
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        });
        
        // Add a clickable link below the image using a section block
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<${imageUrl}|${altText}>`
          }
        });
        
        console.log(`🖼️ Added image block with URL: ${imageUrl} and alt text: ${altText}`);
      } else {
        // If there's no colon after the URL, use the entire string as the URL
        const imageUrl = imageString.trim();
        if (imageUrl) {
          blocks.push({
            type: 'image',
            image_url: imageUrl,
            alt_text: 'Image'
          });
          
          // Add a clickable link below the image
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${imageUrl}|View Image>`
            }
          });
          
          console.log(`🖼️ Added image block with URL: ${imageUrl} (no alt text provided)`);
        }
      }
    } else if (trimmedParagraph.startsWith('!emojis:')) {
      // Emoji showcase (!emojis:basketball,snowboarder,checkered_flag)
      const emojiString = trimmedParagraph.substring(8).trim();
      const emojiNames = emojiString.split(',').map(e => e.trim());
      
      // Convert to simple text with emoji codes
      const emojiText = emojiNames.map(name => `:${name}:`).join(' ');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: emojiText
        }
      });
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
 * Process raw user IDs from text to extract valid Slack user IDs
 * @param {string} rawUserIds - Raw text containing user IDs/mentions
 * @returns {Array} - Array of validated user IDs
 */
function extractUserIds(rawUserIds) {
  if (!rawUserIds) return [];
  
  console.log(`🧩 Extracting user IDs from: "${rawUserIds}"`);
  
  // First check if this looks like a formatted Slack user ID already
  if (rawUserIds.startsWith('U') && /^U[A-Z0-9]{6,}$/.test(rawUserIds)) {
    console.log(`✅ Direct Slack user ID detected: ${rawUserIds}`);
    return [rawUserIds];
  }
  
  // Try to handle various user ID formats
  // 1. Plain user ID: UF8TSTK9A
  // 2. @ mention: @UF8TSTK9A
  // 3. Slack format: <@UF8TSTK9A>
  // 4. Display name with spaces: @ᴀ ʟ ᴇ ᴄ ʀ ɪ ᴍ
  
  // Check for Slack format mentions
  const slackMentionRegex = /<@([A-Z0-9]+)>/g;
  const slackMatches = Array.from(rawUserIds.matchAll(slackMentionRegex), m => m[1]);
  if (slackMatches.length > 0) {
    console.log(`✅ Found ${slackMatches.length} Slack-formatted mentions`);
    return slackMatches;
  }
  
  // Split by commas if multiple users might be present
  return rawUserIds.split(',')
    .map(part => {
      let id = part.trim();
      console.log(`🔍 Processing user ID part: "${id}"`);
      
      // Remove @ prefix if present
      if (id.startsWith('@')) {
        id = id.substring(1);
        console.log(`  - Removed @ prefix: "${id}"`);
      }
      
      // Handle Slack's special mention format
      if (id.startsWith('<@') && id.endsWith('>')) {
        id = id.substring(2, id.length - 1);
        console.log(`  - Extracted from Slack mention: "${id}"`);
      }
      
      // Try to extract a user ID if it looks like one is embedded in the text
      const userIdMatch = id.match(/\b(U[A-Z0-9]{6,})\b/);
      if (userIdMatch) {
        console.log(`  - Extracted user ID from text: "${userIdMatch[1]}"`);
        return userIdMatch[1];
      }
      
      // If we can't find a user ID, try to normalize the text
      // to remove special characters and spaces, in case it's a username format
      const normalized = id.replace(/[\s\u0080-\uFFFF]/g, '');
      
      // Check if, after normalization, it looks like a user ID
      if (/^U[A-Z0-9]{6,}$/.test(normalized)) {
        console.log(`  - Extracted normalized user ID: "${normalized}"`);
        return normalized;
      }
      
      // If it's not empty, pass through the normalized version as best effort
      if (normalized) {
        console.log(`  - Using normalized text as best effort: "${normalized}"`);
        return normalized;
      }
      
      console.log(`  - Could not extract a valid user ID`);
      return ''; // Return empty if we can't extract anything useful
    })
    .filter(id => id); // Filter out empty strings
}

/**
 * Parse the text with potential BBCode to generate blocks
 * Replaces parseRichText to better handle BBCode
 * @param {string} text - Text with BBCode-style formatting
 * @returns {Array} - Array of Block Kit blocks
 */
function parseBBCodeToBlocks(text) {
  if (!text) return [];
  
  console.log('🔍 Converting BBCode text to blocks:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
  
  // First, convert BBCode to Slack markdown where possible
  const markdownText = parseBBCode(text);
  
  // Now parse the blocks using strategies from both BBCode and rich text
  const blocks = [];
  
  // Special handling for dividers - extract them before paragraph splitting
  // This ensures dividers always create a proper divider block, even if they're in the middle
  // of other content

  // First capture all standalone '---' dividers with proper spacing
  let processedText = markdownText;
  if (processedText.includes('---')) {
    console.log('📏 Detected horizontal divider markers in text, ensuring proper parsing');
    
    // Handle divider at the very beginning of the text
    if (processedText.trim().startsWith('---')) {
      console.log('📏 Detected divider at start of text');
      processedText = processedText.replace(/^---/, '!@#DIVIDER#@!');
    }
    
    // Handle divider at the very end of the text
    if (processedText.trim().endsWith('---')) {
      console.log('📏 Detected divider at end of text');
      processedText = processedText.replace(/---$/, '!@#DIVIDER#@!');
    }
    
    // Replace standalone dividers with a special marker that won't be lost in splitting
    processedText = processedText.replace(/\n---\n/g, '\n!@#DIVIDER#@!\n');
    
    // Also handle cases where dividers might be inline within a paragraph
    processedText = processedText.replace(/([\w\s]+)---+([\w\s]+)/g, (match, before, after) => {
      console.log('📏 Detected inline divider, splitting into separate blocks');
      return `${before.trim()}\n\n!@#DIVIDER#@!\n\n${after.trim()}`;
    });
  }
  
  // Split text by double newlines to create sections
  const paragraphs = processedText.split(/\n{2,}/);
  
  console.log(`🔢 Processing ${paragraphs.length} paragraphs`);
  
  paragraphs.forEach((paragraph, index) => {
    // Check for special markers
    const trimmedParagraph = paragraph.trim();
    
    console.log(`📝 Processing paragraph #${index + 1}:`, trimmedParagraph.substring(0, 50) + (trimmedParagraph.length > 50 ? '...' : ''));
    
    // Handle our special divider marker
    if (trimmedParagraph === '!@#DIVIDER#@!') {
      console.log('➖ Processing standalone divider');
      blocks.push({ type: 'divider' });
      return;
    }
    
    // Handle plain divider markers
    if (trimmedParagraph === '---' || 
        trimmedParagraph === '!divider!' || 
        trimmedParagraph === '[divider]' ||
        trimmedParagraph === '(divider)') {
      // Divider
      console.log('➖ Processing divider marker:', trimmedParagraph);
      blocks.push({ type: 'divider' });
      return;
    }
    
    // Handle code blocks with triple backticks
    if (trimmedParagraph.startsWith('```')) {
      // This is a code block - extract the language and content
      const codeBlockRegex = /^```(?:([a-zA-Z0-9+#]+)?\n)?([\s\S]*?)```$/;
      const match = codeBlockRegex.exec(trimmedParagraph);
      
      if (match) {
        const language = match[1] || '';
        const code = match[2] || '';
        
        // Use a section block with preformatted text for code blocks
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '```' + language + '\n' + code + '\n```'
          }
        });
      } else {
        // Malformed code block, treat as regular text
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: trimmedParagraph
          }
        });
      }
      return; // Skip further processing for this paragraph
    }
    
    // Handle section with image accessory
    if (trimmedParagraph.startsWith('!section-with-image:')) {
      console.log('🔍 Processing section with image format:', trimmedParagraph.substring(0, 50) + '...');
      
      // Be more flexible with parsing this format
      // Format: !section-with-image:URL:ALT:CONTENT or !section-with-image:URL:ALT TEXT:CONTENT
      const fullString = trimmedParagraph.substring('!section-with-image:'.length);
      
      // First, extract the URL (which might contain colons in https://)
      let imageUrl = '';
      let altText = 'Image';
      let content = '';
      
      if (fullString.startsWith('http')) {
        // URL starts with http, find the next colon after the protocol part
        const protocolEnd = fullString.indexOf('://') + 3;
        const nextColon = fullString.indexOf(':', protocolEnd);
        
        if (nextColon !== -1) {
          // Found a colon after the protocol part
          imageUrl = fullString.substring(0, nextColon);
          
          // Find the next colon to separate alt from content
          const contentStart = fullString.indexOf(':', nextColon + 1);
          
          if (contentStart !== -1) {
            altText = fullString.substring(nextColon + 1, contentStart);
            content = fullString.substring(contentStart + 1);
          } else {
            // No second colon found, assume the rest is content
            content = fullString.substring(nextColon + 1);
          }
        } else {
          // No colon after protocol, use the entire string as URL
          imageUrl = fullString;
        }
      } else {
        // Non-http URL, simple format
        const parts = fullString.split(':');
        if (parts.length >= 3) {
          imageUrl = parts[0];
          altText = parts[1];
          content = parts.slice(2).join(':');
        } else if (parts.length === 2) {
          imageUrl = parts[0];
          content = parts[1];
        } else {
          imageUrl = parts[0];
        }
      }
      
      console.log(`🖼️ Section with image: URL=${imageUrl}, ALT=${altText}, Content Length=${content.length}`);
      
      // Check if we should use accessory format (image inside section) or separate blocks
      // Look for keywords in the format that indicate accessory style
      const useAccessory = content.toLowerCase().includes('as-accessory') || 
                          content.toLowerCase().includes('accessory') || 
                          content.toLowerCase().includes('inside-section') || 
                          content.toLowerCase().includes('in-section');
      
      if (useAccessory) {
        // Remove the accessory keyword from the content if present
        const cleanContent = content
          .replace(/as-accessory/i, '')
          .replace(/accessory/i, '')
          .replace(/inside-section/i, '')
          .replace(/in-section/i, '')
          .trim();
          
        console.log('🖼️ Using accessory format (image inside section)');
        
        // Create a section block with text and image accessory
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: cleanContent || 'Image Section'
          },
          accessory: {
            type: 'image',
            image_url: imageUrl,
            alt_text: altText
          }
        });
      } else {
        console.log('🖼️ Using separate blocks format (image followed by section)');
        
        // Create separate image and section blocks
        // First the image
        blocks.push({
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        });
        
        // Then the text section, but only if there's content
        if (content.trim()) {
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: content
            }
          });
        }
      }
      
      return; // Skip further processing for this paragraph
    }
    
    // Now add a handler for the special accessory format
    else if (trimmedParagraph.startsWith('!section-with-image-accessory:')) {
      console.log('🔍 Processing section with image as accessory format:', trimmedParagraph.substring(0, 50) + '...');
      
      // Format: !section-with-image-accessory:URL:ALT:CONTENT
      const fullString = trimmedParagraph.substring('!section-with-image-accessory:'.length);
      
      // Parse using the same URL extraction logic as !section-with-image
      let imageUrl = '';
      let altText = 'Image';
      let content = '';
      
      // Extract the URL, alt text, and content
      if (fullString.startsWith('http')) {
        // URL starts with http, find the next colon after the protocol part
        const protocolEnd = fullString.indexOf('://') + 3;
        const nextColon = fullString.indexOf(':', protocolEnd);
        
        if (nextColon !== -1) {
          imageUrl = fullString.substring(0, nextColon);
          const contentStart = fullString.indexOf(':', nextColon + 1);
          
          if (contentStart !== -1) {
            altText = fullString.substring(nextColon + 1, contentStart);
            content = fullString.substring(contentStart + 1);
          } else {
            content = fullString.substring(nextColon + 1);
          }
        } else {
          imageUrl = fullString;
        }
      } else {
        // Non-http URL, simple format
        const parts = fullString.split(':');
        if (parts.length >= 3) {
          imageUrl = parts[0];
          altText = parts[1];
          content = parts.slice(2).join(':');
        } else if (parts.length === 2) {
          imageUrl = parts[0];
          content = parts[1];
        } else {
          imageUrl = parts[0];
        }
      }
      
      console.log(`🖼️ Section with image accessory: URL=${imageUrl}, ALT=${altText}, Content Length=${content.length}`);
      
      // Create a section block with text and image accessory
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: content || 'Image Section'
        },
        accessory: {
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        }
      });
      
      return; // Skip further processing for this paragraph
    }
    
    // Handle various divider formats
    if (trimmedParagraph.startsWith('#') && !trimmedParagraph.startsWith('##')) {
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
      // Quote block (> Quote text)
      const quoteText = trimmedParagraph.substring(2).trim();
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: trimmedParagraph
        }
      });
    } else if (trimmedParagraph.startsWith('!context!')) {
      // Context block (!context! Context text) - true Slack context block with smaller text
      const contextText = trimmedParagraph.substring('!context!'.length).trim();
      console.log(`ℹ️ Processing context block: "${contextText.substring(0, 30)}${contextText.length > 30 ? '...' : ''}"`);
      
      // Handle potential multi-line content in context blocks
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: processUserMentions(contextText)
          }
        ]
      });
      
      return; // Skip further processing
    } else if (trimmedParagraph.startsWith('!usercontext:')) {
      // User context block with user mentions (!usercontext:user1,user2,user3)
      const userIdsText = trimmedParagraph.substring(13).trim();
      
      console.log(`👤 Processing user context with text: "${userIdsText}"`);
      
      // Extract user IDs from the raw string
      const userIds = userIdsText.split(',')
        .map(id => id.trim())
        .filter(id => id);
      
      console.log(`👥 Found ${userIds.length} user IDs or names: ${userIds.join(', ')}`);
      
      if (userIds.length === 0) {
        // No valid text provided
        console.log('⚠️ No user IDs or names found, using fallback message');
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: 'No users specified'
          }]
        });
        return;
      }
      
      // Create elements for the context block
      const userElements = [];
      
      // Get workspace ID for profile images
      const workspaceId = getWorkspaceId();

      // Add user elements for each valid user ID
      for (const userId of userIds) {
        if (userId && userId.match(/^[UW][A-Z0-9]+$/)) {
          // Use user mentions directly which will show avatars in Slack
          userElements.push({
            type: "mrkdwn",
            text: `<@${userId}>`
          });
          console.log(`  - Added user mention for ID: ${userId}`);
        } else {
          console.warn(`⚠️ Invalid user ID format: ${userId}`);
        }
      }
      
      // If we have description text, add it after the users
      if (userContextData.description && userContextData.description.trim().length > 0) {
        const descriptionText = userContextData.description.trim();
        // Add the description as mrkdwn text element
        userElements.push({
          type: "mrkdwn",
          text: descriptionText
        });
        console.log(`📝 Adding description text: "${descriptionText}"`);
      }
      
      // Only add the block if we have elements
      if (userElements.length > 0) {
        console.log(`👥 Adding context block with ${userElements.length} user mentions`);
        
        // For a user context block, we want to show the mentions AND add a message
        // First, create the block with user mentions only
        const contextBlock = {
          type: 'context',
          elements: userElements
        };
        
        blocks.push(contextBlock);
      } else {
        console.log('⚠️ No valid user IDs found in usercontext block');
      }
      
      return;
    } else if (trimmedParagraph.startsWith('!image-block:')) {
      // Handle Markdown image syntax converted to image block
      const imageString = trimmedParagraph.substring(13);
      const firstColonIndex = imageString.indexOf(':');
      
      if (firstColonIndex > 0) {
        const imageUrl = imageString.substring(0, firstColonIndex);
        const altText = imageString.substring(firstColonIndex + 1) || 'Image';
        
        // Create a proper image block (will appear as an embedded image in Slack)
        blocks.push({
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        });
        
        console.log(`🖼️ Added image block from Markdown syntax with URL: ${imageUrl} and alt text: ${altText}`);
      } else {
        // If there's no colon after the URL, use the entire string as the URL
        const imageUrl = imageString.trim();
        if (imageUrl) {
          blocks.push({
            type: 'image',
            image_url: imageUrl,
            alt_text: 'Image'
          });
          
          console.log(`🖼️ Added image block from Markdown syntax with URL: ${imageUrl} (no alt text provided)`);
        }
      }
      return; // Skip further processing for this paragraph
    } else if (trimmedParagraph.startsWith('!image:')) {
      // Image (!image:url:alt_text)
      const imageString = trimmedParagraph.substring(7);
      const firstColonIndex = imageString.indexOf(':');
      
      if (firstColonIndex > 0) {
        const imageUrl = imageString.substring(0, firstColonIndex);
        const altText = imageString.substring(firstColonIndex + 1) || 'Image';
        
        // Use an actual image block to display the image
        blocks.push({
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        });
        
        // Add a clickable link below the image using a section block
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `<${imageUrl}|${altText}>`
          }
        });
        
        console.log(`🖼️ Added image block with URL: ${imageUrl} and alt text: ${altText}`);
      } else {
        // If there's no colon after the URL, use the entire string as the URL
        const imageUrl = imageString.trim();
        if (imageUrl) {
          blocks.push({
            type: 'image',
            image_url: imageUrl,
            alt_text: 'Image'
          });
          
          // Add a clickable link below the image
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `<${imageUrl}|View Image>`
            }
          });
          
          console.log(`🖼️ Added image block with URL: ${imageUrl} (no alt text provided)`);
        }
      }
    } else if (trimmedParagraph.startsWith('!emojis:')) {
      // Emoji showcase (!emojis:basketball,snowboarder,checkered_flag)
      const emojiString = trimmedParagraph.substring(8).trim();
      const emojiNames = emojiString.split(',').map(e => e.trim());
      
      // Convert to simple text with emoji codes
      const emojiText = emojiNames.map(name => `:${name}:`).join(' ');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: emojiText
        }
      });
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
      // Check if the text contains special formatting directives that should be preserved
      if (trimmedParagraph.includes('!usercontext:') || trimmedParagraph.includes('!context!')) {
        // Create a special block that preserves the formatting directives exactly
        console.log('📝 Preserving special formatting directives in text');
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: trimmedParagraph // Use directly without processing mentions
          }
        });
      } else if (trimmedParagraph.startsWith('(image:')) {
        // Handle image syntax: (image:URL:alt_text)
        console.log('🖼️ Processing image tag in paragraph');
        console.log('🔬 RAW IMAGE STRING:', trimmedParagraph);
        
        // Use a simple extraction technique to avoid regex complexity with URLs that have special chars
        const content = trimmedParagraph.substring(7, trimmedParagraph.length - 1); // Remove '(image:' and ')'
        console.log('🔬 EXTRACTED CONTENT:', content);
        
        // Check if there's a colon for alt text
        const colonIndex = content.lastIndexOf(':');
        
        if (colonIndex !== -1) {
          const imageUrl = content.substring(0, colonIndex);
          const altText = content.substring(colonIndex + 1) || 'Image';
          
          console.log(`🔬 PARSED URL: "${imageUrl}"`);
          console.log(`🔬 PARSED ALT TEXT: "${altText}"`);
          
          blocks.push({
            type: 'image',
            image_url: imageUrl,
            alt_text: altText
          });
          
          console.log('🔬 IMAGE BLOCK CREATED WITH TYPE:', blocks[blocks.length-1].type);
        } else {
          // No alt text
          const imageUrl = content;
          
          console.log(`🔬 PARSED URL (NO ALT): "${imageUrl}"`);
          
          blocks.push({
            type: 'image',
            image_url: imageUrl,
            alt_text: 'Image'
          });
          
          console.log('🔬 IMAGE BLOCK CREATED WITH TYPE:', blocks[blocks.length-1].type);
        }
      } else {
        // Regular section with normal user mention processing
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: processUserMentions(trimmedParagraph)
          }
        });
      }
    }
  });
  
  return blocks;
}

/**
 * Processes BBCode-style formatting tags
 * @param {string} text - Input text with BBCode formatting
 * @returns {string} - Processed text for Slack
 * 
 * IMAGE SYNTAX OPTIONS:
 * 1. Standalone image: (image:URL:alt_text)
 * 2. Section with image as accessory: (section:URL:alt_text)Text with the image as accessory(!section)
 *    - To ensure image is used as accessory, include "as-accessory" or "inside-section" in the text
 * 3. Context with image: (context)Text (ctx-image:URL:alt_text)(!context)
 *    - Multiple ctx-image tags can be included for multiple images in one context block
 */
function parseBBCode(text) {
  if (!text) return text;
  
  console.log('💬 Original text before BBCode parsing:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
  
  let formattedText = text;
  
  // First, replace special characters in pre-formatted code blocks
  // to prevent them from being processed as formatting tags
  formattedText = formattedText.replace(/```([\s\S]*?)```/g, (match, code) => {
    // Replace ( with a temporary placeholder that won't be processed as BBCode
    return '```' + code.replace(/\(/g, '{{LEFT_PAREN}}').replace(/\)/g, '{{RIGHT_PAREN}}') + '```';
  });
  
  // Do the same for inline code
  formattedText = formattedText.replace(/`([^`]+)`/g, (match, code) => {
    return '`' + code.replace(/\(/g, '{{LEFT_PAREN}}').replace(/\)/g, '{{RIGHT_PAREN}}') + '`';
  });
  
  // Process Markdown image syntax ![alt](url) to a special image marker that will be converted to blocks
  formattedText = formattedText.replace(/!\[(.*?)\]\((https?:\/\/[^()]+)\)/g, (match, alt, url) => {
    console.log(`🖼️ Pre-processing Markdown image format: "${match.substring(0, 40)}${match.length > 40 ? '...' : ''}" => "${alt}" -> "${url.substring(0, 40)}${url.length > 40 ? '...' : ''}"`);
    
    // Check if URL is properly formed
    if (!url.startsWith('http')) {
      console.log('⚠️ WARNING: URL does not start with http:', url);
    }
    
    // Convert to a format that will be processed to create an image block
    const result = `(image:${url}:${alt || 'Image'})`;
    console.log('🔄 Converted to image tag format:', result);
    return result;
  });
  
  // Headers - (header)text(!header) or (h1)text(!h1)
  formattedText = formattedText.replace(/\(header\)(.*?)\(!header\)/g, '*$1*');
  formattedText = formattedText.replace(/\(h1\)(.*?)\(!h1\)/g, '*$1*');
  formattedText = formattedText.replace(/\(header\)(.*?)\(\/header\)/g, '*$1*'); // Old format
  formattedText = formattedText.replace(/\(h1\)(.*?)\(\/h1\)/g, '*$1*'); // Old format
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[header\](.*?)\[!header\]/g, '*$1*');
  formattedText = formattedText.replace(/\[h1\](.*?)\[!h1\]/g, '*$1*');
  formattedText = formattedText.replace(/\[header\](.*?)\[\/header\]/g, '*$1*');
  formattedText = formattedText.replace(/\[h1\](.*?)\[\/h1\]/g, '*$1*');
  
  // Smaller helpers - (context)text(!context)
  formattedText = formattedText.replace(/\(context\)([\s\S]*?)\(!context\)/g, '!context! $1');
  formattedText = formattedText.replace(/\(context\)([\s\S]*?)\(\/context\)/g, '!context! $1'); // Old format
  
  // Fix for the context block issue: Handle the format from the example message
  // Add more flexible pattern that can capture content correctly
  formattedText = formattedText.replace(/\(context\)([\s\S]*?)(?=$|\n\n|\(!context\)|\(\/context\))/g, (match, content) => {
    console.log('🔄 Processing context block with flexible pattern:', content.substring(0, 30) + '...');
    return `!context! ${content}`;
  });
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[context\]([\s\S]*?)\[!context\]/g, '!context! $1');
  formattedText = formattedText.replace(/\[context\]([\s\S]*?)\[\/context\]/g, '!context! $1');
  
  // User context - (usercontext)user1,user2,user3(!usercontext)
  formattedText = formattedText.replace(/\(usercontext\)(.*?)\(!usercontext\)/g, (match, content) => {
    console.log('🔄 Processing usercontext with parentheses:', content);
    // Pass the content through directly without modification
    return `!usercontext:${content}`;
  });
  formattedText = formattedText.replace(/\(usercontext\)(.*?)\(\/usercontext\)/g, (match, content) => {
    console.log('🔄 Processing usercontext with old parentheses format:', content);
    return `!usercontext:${content}`;
  }); // Old format
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[usercontext\](.*?)\[!usercontext\]/g, (match, content) => {
    console.log('🔄 Processing usercontext with square brackets:', content);
    return `!usercontext:${content}`;
  });
  formattedText = formattedText.replace(/\[usercontext\](.*?)\[\/usercontext\]/g, (match, content) => {
    console.log('🔄 Processing usercontext with old square bracket format:', content);
    return `!usercontext:${content}`;
  });
  
  // Section with image - (section:url:alt_text)text(!section)
  formattedText = formattedText.replace(/\(section:(.*?)(?::(.*?))?\)([\s\S]*?)\(!section\)/g, (match, url, alt, content) => {
    console.log('🔍 Processing section with image BBCode format');
    // Process user mentions directly in the content before returning
    const processedContent = processUserMentions(content);
    
    // Check if this section should use accessory format based on content
    const useAccessory = content.toLowerCase().includes('as-accessory') || 
                        content.toLowerCase().includes('accessory') || 
                        content.toLowerCase().includes('inside-section') || 
                        content.toLowerCase().includes('in-section');
    
    if (useAccessory) {
      console.log('🔍 Using accessory format for section with image');
      // For accessory format, include the accessory flag in the special tag
      return `!section-with-image-accessory:${url}:${alt || 'Image'}:${processedContent}`;
    } else {
      // Regular section with image
      return `!section-with-image:${url}:${alt || 'Image'}:${processedContent}`;
    }
  });

  // Also handle the format without the closing tag, which is seen in the example
  formattedText = formattedText.replace(/\(section:(.*?)(?::(.*?))?\)([\s\S]*?)(?=$|\n\n|\(context|\(image:|\(section:)/g, (match, url, alt, content) => {
    // Only process if not already processed
    if (match.includes('!section-with-image')) return match;
    
    console.log('🔍 Processing section with image without closing tag');
    const processedContent = processUserMentions(content);
    return `!section-with-image:${url}:${alt || 'Image'}:${processedContent}`;
  });

  // Legacy formats
  formattedText = formattedText.replace(/\(section:(.*?)(?::(.*?))?\)([\s\S]*?)\(\/section\)/g, (match, url, alt, content) => {
    console.log('🔍 Processing section with image BBCode format (legacy format)');
    // Process user mentions directly in the content before returning
    const processedContent = processUserMentions(content);
    return `!section-with-image:${url}:${alt || 'Image'}:${processedContent}`;
  });

  // Square bracket formats for backward compatibility
  formattedText = formattedText.replace(/\[section:(.*?)(?::(.*?))?\]([\s\S]*?)\[!section\]/g, (match, url, alt, content) => {
    console.log('🔍 Processing section with image square bracket format');
    // Process user mentions directly in the content before returning
    const processedContent = processUserMentions(content);
    return `!section-with-image:${url}:${alt || 'Image'}:${processedContent}`;
  });
  formattedText = formattedText.replace(/\[section:(.*?)(?::(.*?))?\]([\s\S]*?)\[\/section\]/g, (match, url, alt, content) => {
    console.log('🔍 Processing section with image square bracket format (legacy format)');
    // Process user mentions directly in the content before returning
    const processedContent = processUserMentions(content);
    return `!section-with-image:${url}:${alt || 'Image'}:${processedContent}`;
  });
  
  // Lists - (list)items(!list)
  formattedText = formattedText.replace(/\(list\)([\s\S]*?)\(!list\)/g, '$1');
  formattedText = formattedText.replace(/\(list\)([\s\S]*?)\(\/list\)/g, '$1'); // Old format
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[list\]([\s\S]*?)\[!list\]/g, '$1');
  formattedText = formattedText.replace(/\[list\]([\s\S]*?)\[\/list\]/g, '$1');
  
  // Dividers - (divider)
  formattedText = formattedText.replace(/\(divider\)/g, (match) => {
    console.log('🔄 Processing divider with parentheses');
    // Ensure divider has newlines before and after
    return '\n---\n';
  });
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[divider\]/g, (match) => {
    console.log('🔄 Processing divider with square brackets');
    // Ensure divider has newlines before and after
    return '\n---\n';
  });
  
  // Image references - (image:url:alt_text)
  // Use the replacement function to handle missing alt text
  formattedText = formattedText.replace(/\(image:(https?:\/\/[^)]+?)(?::([^)]+?))?\)/g, (match, url, alt) => {
    debugLog(`🔄 Processing image tag with URL: ${url}`);
    // For images, we want to create a special marker that will be processed later to create an image block
    return `!image-block:${url}:${alt || 'Image'}`;
  });
  
  // Fallback for general image format that doesn't match the more specific pattern
  formattedText = formattedText.replace(/\(image:([^:)]+)(?::([^)]+))?\)/g, (match, url, alt) => {
    if (!url.startsWith('http')) {
      // Skip if already processed
      if (match.includes('!image-block:')) return match;
      
      debugLog(`🔄 Processing non-http image URL: ${url}`);
      return `!image-block:${url}:${alt || 'Image'}`;
    }
    return match; // Skip if it's an http URL (should be caught by previous regex)
  });
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[image:(https?:\/\/[^]]+?)(?::([^]]+?))?\]/g, (match, url, alt) => {
    debugLog(`🔄 Processing image tag with square brackets: ${url}`);
    // For images, we want to create a special marker that will be processed later to create an image block
    return `!image-block:${url}:${alt || 'Image'}`;
  });
  
  // Process links with format [title](url) to Slack format <url|title>
  formattedText = formattedText.replace(/\[(.*?)\]\((https?:\/\/[^()]+)\)/g, (match, title, url) => {
    console.log(`🔄 Converting markdown link to Slack format: "${match}" => "${title}" -> "${url}"`);
    // Ensure URL is properly formatted for Slack
    const cleanUrl = url.trim().replace(/[<>]/g, '');
    const slackFormat = `<${cleanUrl}|${title}>`;
    console.log(`   Result: "${slackFormat}"`);
    // Mark processed links to avoid double processing
    return `__PROCESSED_LINK__${slackFormat}`;
  });
  
  // Process plain URLs that aren't already in <>
  formattedText = formattedText.replace(/(^|[^<])(https?:\/\/[^\s<>]+)/g, (match, prefix, url) => {
    // Only process if not already inside < >
    if (match.indexOf('<') === -1) {
      console.log(`🔄 Converting plain URL to Slack format: "${url}"`);
      const slackFormat = `${prefix}<${url}>`;
      console.log(`   Result: "${slackFormat}"`);
      return slackFormat;
    }
    return match;
  });
  
  // Restore placeholders in code blocks
  formattedText = formattedText.replace(/{{LEFT_PAREN}}/g, '(').replace(/{{RIGHT_PAREN}}/g, ')');
  
  console.log('💬 Text after BBCode parsing:', formattedText.substring(0, 100) + (formattedText.length > 100 ? '...' : ''));
  
  // Additional fallback for markdown links that the first regex didn't catch
  // This is a more relaxed version that captures more complex URLs
  formattedText = formattedText.replace(/\[(.*?)\]\(([^()]*(?:\/|\.)[^()]*)\)/g, (match, title, url) => {
    // Skip if it doesn't look like a URL or if it was already processed
    if (match.includes('__PROCESSED_LINK__') || 
        (!url.match(/^https?:\/\//) && !url.match(/^www\./))) {
      return match;
    }
    
    console.log(`🔄 Converting complex markdown link to Slack format: "${match}"`);
    
    // Ensure URL has http/https
    let cleanUrl = url.trim().replace(/[<>]/g, '');
    if (cleanUrl.startsWith('www.')) {
      cleanUrl = 'https://' + cleanUrl;
    }
    
    const slackFormat = `<${cleanUrl}|${title}>`;
    console.log(`   Result: "${slackFormat}"`);
    return `__PROCESSED_LINK__${slackFormat}`;
  });
  
  // Remove the processing markers
  formattedText = formattedText.replace(/__PROCESSED_LINK__/g, '');
  
  return formattedText;
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
 * Ensures text is safely formatted for display in Slack
 * @param {string} text - Raw text to format
 * @returns {string} Safely formatted text
 */
function safeSlackText(text) {
  if (!text) return '';
  
  // Replace characters that might cause issues in Slack formatting
  return text
    .replace(/&/g, '&amp;')  // Ampersands -> HTML entity
    .replace(/</g, '&lt;')   // Less than -> HTML entity
    .replace(/>/g, '&gt;')   // Greater than -> HTML entity
    .replace(/"/g, '&quot;') // Double quotes -> HTML entity
    .replace(/'/g, '&#39;'); // Single quotes -> HTML entity
}

/**
 * Direct parser that converts BBCode style tags to appropriate Slack blocks
 * @param {string} text - Input text with BBCode-style formatting
 * @returns {Array} - Array of Block Kit blocks
 */
function parseTextToBlocks(text) {
  if (!text) return [];

  console.log('🔍 Parsing text to blocks:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
  
  // Replace literal newline strings with actual newlines
  text = text.replace(/\\n/g, '\n');
  
  // Pre-process for user context blocks anywhere in the text
  // This helps handle cases where usercontext appears in the middle of paragraphs
  const userContextRegex = /\(usercontext\)(.*?)(?:\|([^!]*))?(?:\(!usercontext\)|$)/g;
  let userContextMatches = [];
  let match;
  
  while ((match = userContextRegex.exec(text)) !== null) {
    userContextMatches.push({
      fullMatch: match[0],
      usersText: match[1],
      description: match[2] || '',  // Capture the description after the pipe if it exists
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
    console.log(`🔎 Found user context block: ${match[0]} at position ${match.index}`);
    if (match[2]) {
      console.log(`🔎 With description: "${match[2]}"`);
    }
  }
  
  if (userContextMatches.length > 0) {
    console.log(`👥 Found ${userContextMatches.length} user context blocks to process`);
    // Sort by position in reverse order so we can replace without affecting other positions
    userContextMatches.sort((a, b) => b.startIndex - a.startIndex);
    
    // Create a special marker that won't interfere with other processing
    userContextMatches.forEach(ctx => {
      // Replace the usercontext tag with a special marker
      const marker = `__USER_CONTEXT_MARKER_${Date.now()}_${Math.random().toString(36).substring(2, 10)}__`;
      text = text.substring(0, ctx.startIndex) + marker + text.substring(ctx.endIndex);
      ctx.marker = marker;
    });
  }
  
  // Array to hold our blocks
  const blocks = [];
  
  // Split text by double newlines to create sections
  // More flexible paragraph splitting to handle various formats
  const paragraphs = [];
  const tempParagraphs = text.split(/\n{2,}/);

  console.log(`🔢 Initial paragraph split: ${tempParagraphs.length} paragraphs`);

  // Process each paragraph to further split special blocks that might not be separated by double newlines
  tempParagraphs.forEach(para => {
    const paraContent = para.trim();
    if (!paraContent) return; // Skip empty paragraphs
    
    // Check if paragraph contains special blocks that should be processed separately
    const specialBlocks = [
      { pattern: /\(section:.*?\).*?(?:\(!section\)|\(\/section\))/gs, type: 'section-with-image' },
      { pattern: /\(context\).*?(?:\(!context\)|\(\/context\))/gs, type: 'context' },
      { pattern: /\(usercontext\).*?(?:\(!usercontext\)|\(\/usercontext\))/gs, type: 'user-context' },
      { pattern: /\(image:.*?\)/gs, type: 'image' }
    ];
    
    let hasSpecialBlock = false;
    for (const block of specialBlocks) {
      if (paraContent.match(block.pattern)) {
        hasSpecialBlock = true;
        console.log(`🔍 Found ${block.type} block in paragraph, processing separately`);
        
        // Split content before, within, and after the special block
        let remaining = paraContent;
        let results = [];
        let match;
        
        while ((match = block.pattern.exec(remaining)) !== null) {
          const beforeBlock = remaining.substring(0, match.index).trim();
          if (beforeBlock) results.push(beforeBlock);
          
          results.push(match[0]);
          
          // Update remaining text
          remaining = remaining.substring(match.index + match[0].length).trim();
        }
        
        // Add any remaining content
        if (remaining) results.push(remaining);
        
        // Add the split parts to our paragraphs
        paragraphs.push(...results.filter(p => p.trim()));
        break;
      }
    }
    
    // If no special blocks were found, add the whole paragraph
    if (!hasSpecialBlock) {
      paragraphs.push(paraContent);
    }
  });

  console.log(`🔢 After special block processing: ${paragraphs.length} paragraphs`);

  // Process each paragraph
  paragraphs.forEach((paragraph, index) => {
    const content = paragraph.trim();
    if (!content) return; // Skip empty paragraphs
    
    console.log(`📝 Processing paragraph #${index + 1}:`, content.substring(0, 50) + (content.length > 50 ? '...' : ''));
    
    // IMPROVED IMAGE DETECTION: Check if this paragraph is just an image tag
    // This more generous check will catch many more valid image formats
    if (content.includes('(image:') && content.includes(')')) {
      console.log('🖼️ IMPROVED DETECTION: Paragraph contains image syntax, attempting to extract');
      
      // Extract the image URL
      const startIdx = content.indexOf('(image:') + 7;
      const endIdx = content.indexOf(')', startIdx);
      
      if (startIdx > 6 && endIdx > startIdx) { // valid indices
        let imageContent = content.substring(startIdx, endIdx);
        console.log('🖼️ IMPROVED DETECTION: Extracted image content:', imageContent);
        
        // Check if there's a colon for alt text
        const colonIndex = imageContent.lastIndexOf(':');
        
        let imageUrl, altText;
        if (colonIndex !== -1) {
          imageUrl = imageContent.substring(0, colonIndex);
          altText = imageContent.substring(colonIndex + 1) || 'Image';
        } else {
          imageUrl = imageContent;
          altText = 'Image';
        }
        
        console.log(`🖼️ IMPROVED DETECTION: Creating image block with URL: ${imageUrl} and alt text: ${altText}`);
        
        // Create a standalone image block
        blocks.push({
          type: 'image',
          image_url: imageUrl,
          alt_text: altText
        });
        
        console.log('🖼️ IMPROVED DETECTION: Image block added successfully');
        return; // Skip further processing for this paragraph
      }
    }
    
    // Check for the special image block marker we created in parseBBCode
    if (content.startsWith('!image-block:')) {
      console.log('🖼️ Processing special !image-block marker:', content);
      
      // Simple string-based extraction to avoid regex issues
      const markerPrefix = '!image-block:';
      const markerContent = content.substring(markerPrefix.length);
      const colonIndex = markerContent.lastIndexOf(':');
      
      let imageUrl, altText;
      if (colonIndex !== -1) {
        imageUrl = markerContent.substring(0, colonIndex);
        altText = markerContent.substring(colonIndex + 1) || 'Image';
      } else {
        imageUrl = markerContent;
        altText = 'Image';
      }
      
      console.log(`🖼️ Creating image block from marker with URL: ${imageUrl} and alt text: ${altText}`);
      
      blocks.push({
        type: 'image',
        image_url: imageUrl,
        alt_text: altText
      });
      
      console.log('🖼️ Special marker image block added successfully');
      return; // Skip further processing for this paragraph
    }
    
    // Check if this paragraph contains a usercontext marker
    let hasUserContextMarker = false;
    let userContextData = null;
    
    if (userContextMatches.length > 0) {
      userContextData = userContextMatches.find(ctx => content.includes(ctx.marker));
      hasUserContextMarker = !!userContextData;
    }
    
    if (hasUserContextMarker) {
      console.log(`👥 Processing paragraph with user context marker: ${userContextData.marker}`);
      
      // Extract user IDs from the raw string
      const userIds = userContextData.usersText.split(',')
        .map(id => id.trim())
        .filter(id => id);
      
      console.log(`👥 Creating user context block with ${userIds.length} users:`, userIds);
      
      // Create elements for the context block
      const userElements = [];
      
      // Add user elements for each valid user ID
      for (const userId of userIds) {
        if (userId && userId.match(/^[UW][A-Z0-9]+$/)) {
          // Use user mentions directly which will show avatars in Slack
          userElements.push({
            type: "mrkdwn",
            text: `<@${userId}>`
          });
          console.log(`  - Added user mention for ID: ${userId}`);
        } else {
          console.warn(`⚠️ Invalid user ID format: ${userId}`);
        }
      }
      
      // If we have description text, add it after the users
      if (userContextData.description && userContextData.description.trim().length > 0) {
        const descriptionText = userContextData.description.trim();
        // Add the description as mrkdwn text element
        userElements.push({
          type: "mrkdwn",
          text: descriptionText
        });
        console.log(`📝 Adding description text: "${descriptionText}"`);
      }
      
      // Only add the block if we have elements
      if (userElements.length > 0) {
        console.log(`👥 Adding context block with ${userElements.length} user mentions`);
        
        // For a user context block, we want to show the mentions AND add a message
        // First, create the block with user mentions only
        const contextBlock = {
          type: 'context',
          elements: userElements
        };
        
        blocks.push(contextBlock);
      } else {
        console.log('⚠️ No valid user IDs found in usercontext block');
      }
      
      // Get the rest of the content
      const contentBefore = content.substring(0, content.indexOf(userContextData.marker)).trim();
      const contentAfter = content.substring(content.indexOf(userContextData.marker) + userContextData.marker.length).trim();
      
      // Add content before user context if it exists
      if (contentBefore) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: contentBefore
          }
        });
      }
      
      // Add content after user context if it exists
      if (contentAfter) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: contentAfter
          }
        });
      }
      
      return;
    }
    
    // Check for special block types
    
    // 1. Check for divider: (divider)
    if (content === '(divider)') {
      console.log('➖ Adding divider block');
      blocks.push({ type: 'divider' });
      return;
    }
    
    // 2. Check for user context: (usercontext)USER1,USER2(!usercontext)
    const userContextMatch = content.match(/^\(usercontext\)(.*?)(?:\|([^!]*))?(?:\(!usercontext\)|$)/);
    if (userContextMatch) {
      const userIdsRaw = userContextMatch[1];
      const description = userContextMatch[2] || '';
      console.log(`👥 Processing user context block with raw IDs: ${userIdsRaw}`);
      if (description) {
        console.log(`👥 With description: "${description}"`);
      }
      
      // Extract user IDs from the raw string
      const userIds = userIdsRaw.split(',')
        .map(id => id.trim())
        .filter(id => id);
      
      console.log(`👥 Creating user context block with ${userIds.length} users:`, userIds);
      
      // Create elements for the context block
      const userElements = [];
      
      // Get workspace ID for profile images
      const workspaceId = getWorkspaceId();

      // Add user elements for each valid user ID
      for (const userId of userIds) {
        if (userId && userId.match(/^[UW][A-Z0-9]+$/)) {
          // Use user mentions directly which will show avatars in Slack
          userElements.push({
            type: "mrkdwn",
            text: `<@${userId}>`
          });
          console.log(`  - Added user mention for ID: ${userId}`);
        } else {
          console.warn(`⚠️ Invalid user ID format: ${userId}`);
        }
      }
      
      // If we have description text, add it after the users
      if (description && description.trim().length > 0) {
        const descriptionText = description.trim();
        // Add the description as mrkdwn text element
        userElements.push({
          type: "mrkdwn",
          text: descriptionText
        });
        console.log(`📝 Adding description text: "${descriptionText}"`);
      }
      
      // Only add the block if we have elements
      if (userElements.length > 0) {
        console.log(`👥 Adding context block with ${userElements.length} user mentions`);
        
        // For a user context block, we want to show the mentions AND add a message
        // First, create the block with user mentions only
        const contextBlock = {
          type: 'context',
          elements: userElements
        };
        
        blocks.push(contextBlock);
      } else {
        console.log('⚠️ No valid user IDs found in usercontext block');
      }
      return;
    }
    
    // 3. Check for context blocks: (context)text(!context)
    const contextMatch = content.match(/^\(context\)(.*?)(?:\(!context\)|$)/s);
    if (contextMatch) {
      console.log('ℹ️ Adding context block');
      
      // Process user mentions in the context text
      const contextText = processUserMentions(contextMatch[1]);
      
      // Check if we also have image URLs to add to the context
      // Format: (context)Text with image: (ctx-image:URL:alt_text)(!context)
      const contextImages = [];
      
      // Detect context images using pattern: (ctx-image:URL:alt_text)
      const ctxImagePattern = /\(ctx-image:(https?:\/\/[^:)]+)(?::([^)]+))?\)/g;
      let ctxImgMatch;
      let textWithoutImages = contextText;
      
      while ((ctxImgMatch = ctxImagePattern.exec(contextText)) !== null) {
        const imgUrl = ctxImgMatch[1];
        const imgAlt = ctxImgMatch[2] || 'Image';
        
        contextImages.push({ 
          url: imgUrl, 
          alt: imgAlt,
          fullMatch: ctxImgMatch[0]
        });
        
        // Remove the image tag from the text
        textWithoutImages = textWithoutImages.replace(ctxImgMatch[0], '');
      }
      
      console.log(`📷 Found ${contextImages.length} image tags in context block`);
      
      // Create the context block elements
      const contextElements = [
        {
          type: 'mrkdwn',
          text: textWithoutImages.trim() || 'Context'
        }
      ];
      
      // Add the images to the context elements
      contextImages.forEach(img => {
        contextElements.push({
          type: 'image',
          image_url: img.url,
          alt_text: img.alt
        });
      });
      
      // Create the context block
      blocks.push({
        type: 'context',
        elements: contextElements
      });
      
      return;
    }
    
    // 4. Check for section with image: (section:URL)Content(!section) or (section:URL:ALT_TEXT)Content(!section)
    // First, try to detect if there's a section block but handle URLs specially
    if (content.startsWith('(section:')) {
      console.log('🖼️ Detected section with potential image');
      
      // Extract URL and content more carefully
      const sectionStartRe = /^\(section:(.*?)\)/;
      const sectionStart = content.match(sectionStartRe);
      
      if (sectionStart) {
        let urlAndAlt = sectionStart[1];
        let altText = 'Image';
        let imageUrl = '';
        
        // Check if we have both URL and alt text (separated by : not in URL)
        // URLs may contain : (e.g., https://) so we need to be careful with the split
        // First check if there's a protocol with ://
        if (urlAndAlt.includes('://')) {
          // If it includes ://, find any colon that appears after that
          const protocolEndIndex = urlAndAlt.indexOf('://') + 3;
          const postProtocolString = urlAndAlt.substring(protocolEndIndex);
          const colonInPostProtocol = postProtocolString.indexOf(':');
          
          if (colonInPostProtocol !== -1) {
            // We found a colon after the protocol, this is likely separating URL and alt text
            imageUrl = urlAndAlt.substring(0, protocolEndIndex + colonInPostProtocol);
            altText = urlAndAlt.substring(protocolEndIndex + colonInPostProtocol + 1);
            console.log(`💬 Parsed URL with protocol "${imageUrl}" and alt text "${altText}"`);
          } else {
            // No additional colon found, the entire string is a URL
            imageUrl = urlAndAlt;
            console.log(`💬 Parsed URL with protocol "${imageUrl}" without alt text`);
          }
        } else {
          // No protocol found, try simple split by first colon
          const colonIndex = urlAndAlt.indexOf(':');
          if (colonIndex !== -1) {
            // We have both URL and alt text
            imageUrl = urlAndAlt.substring(0, colonIndex);
            altText = urlAndAlt.substring(colonIndex + 1);
            console.log(`💬 Parsed URL without protocol "${imageUrl}" and alt text "${altText}"`);
          } else {
            // Just URL, no alt text
            imageUrl = urlAndAlt;
            console.log(`💬 Parsed URL without protocol "${imageUrl}" without alt text`);
          }
        }
        
        // Get the section content (everything after the closing parenthesis until optional (!section))
        const closingParenPos = content.indexOf(')', '(section:'.length);
        let sectionText = '';
        
        if (closingParenPos !== -1) {
          // Extract text content after URL/alt text declaration
          const endMarker = content.indexOf('(!section)');
          if (endMarker !== -1) {
            sectionText = content.substring(closingParenPos + 1, endMarker);
          } else {
            sectionText = content.substring(closingParenPos + 1);
          }
          
          console.log('🖼️ Adding section with image:', imageUrl);
          
          // Process user mentions in the section text before creating the block
          const processedSectionText = processUserMentions(sectionText.trim());
          
          // Determine the block structure based on a special flag - allow both styles:
          // 1. Image as accessory (image appears inside the section, right-aligned)
          // 2. Separate blocks (image appears as a standalone block)
          
          // Check if there's a special directive for accessory style
          const useAccessory = content.includes('as-accessory') || 
                              content.includes('inside-section') || 
                              content.includes('in-section');
          
          if (useAccessory || !processedSectionText) {
            // Create a section with the image as an accessory (right-aligned image)
            console.log('🖼️ Adding image as an accessory within the section block');
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: processedSectionText || 'Image Section'
              },
              accessory: {
                type: 'image',
                image_url: imageUrl,
                alt_text: altText
              }
            });
          } else {
            // Create two separate blocks: an image block and a text section
            // This ensures the image is displayed correctly and the text can contain user mentions
            console.log('🖼️ Adding separate image block and section text block');
            
            // 1. First add the image as a standalone block
            blocks.push({
              type: 'image',
              image_url: imageUrl,
              alt_text: altText
            });
            
            // 2. Then add the section text
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: processedSectionText
              }
            });
          }
          
          console.log('🖼️ Section with image processing complete');
          return;
        }
      }
    }
    
    // 5. Check for header: (header)text(!header)
    const headerMatch = content.match(/^\(header\)(.*?)(?:\(!header\)|$)/s);
    if (headerMatch) {
      console.log('🔖 Adding header block');
      
      // For header blocks, we have two options:
      // 1. Use a plain_text header (official Slack format but doesn't support mentions)
      // 2. Use a section with bold formatting (supports mentions but isn't a true header)
      
      // Extract the header content
      const headerContent = headerMatch[1];
      
      // Check if the header contains user mentions or other markdown 
      const hasMentions = headerContent.includes('<@') || 
                          headerContent.includes('@U') || 
                          headerContent.match(/\b[UW][A-Z0-9]{8,}\b/);
      
      if (hasMentions) {
        console.log('👤 Header contains user mentions - using section with markdown formatting');
        
        // Process the mentions
        const processedHeaderText = processUserMentions(headerContent);
        
        // Create a section block with bold text to simulate a header
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${processedHeaderText}*` // Bold the text to make it look like a header
          }
        });
      } else {
        // Regular header without mentions - use the standard header block
        blocks.push({
          type: 'header',
          text: {
            type: 'plain_text',
            text: headerContent,
            emoji: true
          }
        });
      }
      return;
    }
    
    // Default: Regular section with markdown
    console.log('📄 Adding regular section');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: content
      }
    });
  });
  
  // Debug log to show the complete block structure that was created
  const imageBlocks = blocks.filter(block => block.type === 'image');
  console.log(`📊 BLOCK SUMMARY: Created ${blocks.length} blocks total`);
  console.log(`📊 IMAGE BLOCKS: ${imageBlocks.length} image blocks found`);
  
  if (imageBlocks.length > 0) {
    console.log('📷 IMAGE BLOCKS DETAILS:');
    imageBlocks.forEach((block, index) => {
      console.log(`  [${index + 1}] URL: ${block.image_url.substring(0, 50)}... ALT: ${block.alt_text}`);
    });
  } else {
    console.log('⚠️ WARNING: No image blocks were created in parseTextToBlocks');
    console.log('📝 CONTENT ANALYZED:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));
    
    // Check for patterns that should have created image blocks
    if (text.includes('(image:') || text.includes('![') || text.includes('!image-block:')) {
      console.log('🔍 DETECTED IMAGE SYNTAX but no image blocks were created');
      if (text.includes('(image:')) {
        const imageTagIndex = text.indexOf('(image:');
        console.log('🔍 IMAGE TAG CONTEXT:', text.substring(Math.max(0, imageTagIndex - 20), 
                                                       Math.min(text.length, imageTagIndex + 100)));
      }
    }
  }
  
  return blocks;
}

/**
 * Get the current Slack workspace ID
 * @returns {string} The workspace ID or a default value
 */
function getWorkspaceId() {
  try {
    // Default to T02RAEMPK if we can't determine it (updated based on user's workspace)
    let workspaceId = 'T02RAEMPK';
    
    // Try to get the Slack client
    const { getSlackClient } = require('../slackClient.js');
    const slack = getSlackClient();
    
    // If we have access to team info, use that
    if (slack && slack.team && slack.team.id) {
      workspaceId = slack.team.id;
      console.log(`Using team ID from Slack client: ${workspaceId}`);
    }
    
    return workspaceId;
  } catch (error) {
    console.warn('⚠️ Could not determine workspace ID, using default:', error.message);
    return 'T02RAEMPK';
  }
}

/**
 * Post a message to Slack with rich formatting options
 * @param {Object} args - Arguments for the message
 * @param {string} args.text - The text content of the message
 * @param {Array} [args.blocks] - Optional blocks to include in the message
 * @param {string} [args.color] - Color for the message (default: "good")
 * @param {boolean} [args.ephemeral] - Whether the message is ephemeral
 * @param {Array|Object} [args.attachments] - Optional attachments
 * @param {string} [args.channel] - Channel to post to (can be inferred from threadState)
 * @param {string} [args.threadTs] - Thread timestamp to reply to
 * @param {string} [args.reasoning] - Reasoning for this action (for debugging)
 * @param {Object} threadState - State of the current thread context
 * @returns {Object} - Result of the operation
 */
async function postMessage(args, threadState) {
  try {
    console.log('📣 postMessage tool called with args:', JSON.stringify(args, null, 2));
    
    // Get the Slack client for making API calls
    console.log('🔍 DEBUG: About to initialize slack client');
    const slack = getSlackClient();
    console.log('🔍 DEBUG: Slack client initialized successfully:', slack ? 'Client exists' : 'Client is null');
    
    // CRITICAL FIX: Special handling for Markdown image format
    if (args.text && args.text.includes('![') && args.text.includes('](')) {
      console.log('🖼️ CRITICAL FIX: Detected markdown image in text, preprocessing...');
      
      // Convert markdown images to our image tag format
      const markdownRegex = /!\[(.*?)\]\((https?:\/\/[^)]+)\)/g;
      let match;
      const markdownImages = [];
      
      while ((match = markdownRegex.exec(args.text)) !== null) {
        const altText = match[1] || 'Image';
        const imageUrl = match[2];
        console.log(`🖼️ CRITICAL FIX: Converting markdown image: alt=${altText}, url=${imageUrl}`);
        markdownImages.push({ altText, imageUrl, fullMatch: match[0] });
      }
      
      if (markdownImages.length > 0) {
        console.log(`🖼️ CRITICAL FIX: Found ${markdownImages.length} markdown images to convert`);
        
        // Create a modified text where each image is on its own paragraph
        let textParts = args.text.split('\n\n');
        
        // For each image we found
        markdownImages.forEach(image => {
          // Find which part contains this image
          for (let i = 0; i < textParts.length; i++) {
            if (textParts[i].includes(image.fullMatch)) {
              // Replace just this occurrence with our format
              textParts[i] = textParts[i].replace(
                image.fullMatch, 
                `\n\n(image:${image.imageUrl}:${image.altText})\n\n`
              );
              break;
            }
          }
        });
        
        // Reconstruct the text
        args.text = textParts.join('\n\n');
        console.log('🖼️ CRITICAL FIX: Preprocessed text:', args.text.substring(0, 120) + (args.text.length > 120 ? '...' : ''));
      }
    }
    
    // ENHANCEMENT: Add special handling for image URLs with text
    // Ensure images have proper newline separation for parsing into blocks
    if (args.text && args.text.includes('(image:')) {
      console.log('🖼️ ENHANCEMENT: Found (image:) tag in text, ensuring proper paragraph separation');
      
      // Extract all image tags
      const imageTagRegex = /\(image:(https?:\/\/[^)]+?)(?::([^)]+?))?\)/g;
      let match;
      const imageTags = [];
      
      while ((match = imageTagRegex.exec(args.text)) !== null) {
        imageTags.push({
          fullMatch: match[0],
          url: match[1],
          altText: match[2] || 'Image',
          position: match.index
        });
      }
      
      if (imageTags.length > 0) {
        console.log(`🖼️ ENHANCEMENT: Found ${imageTags.length} image tags, ensuring proper formatting`);
        
        // Check if each image tag is properly surrounded by newlines
        let newText = args.text;
        
        // Process in reverse order to avoid position changes
        imageTags.sort((a, b) => b.position - a.position).forEach(tag => {
          // Check if the tag is already properly surrounded by double newlines
          const beforeTag = newText.substring(Math.max(0, tag.position - 2), tag.position);
          const afterTagEnd = tag.position + tag.fullMatch.length;
          const afterTag = newText.substring(afterTagEnd, Math.min(newText.length, afterTagEnd + 2));
          
          const needsLeadingNewlines = !beforeTag.includes('\n\n');
          const needsTrailingNewlines = !afterTag.includes('\n\n');
          
          if (needsLeadingNewlines || needsTrailingNewlines) {
            console.log(`🖼️ ENHANCEMENT: Image tag needs newline adjustment: ${tag.fullMatch.substring(0, 40)}...`);
            
            // Replace the tag with properly formatted version
            const replacement = 
              (needsLeadingNewlines ? '\n\n' : '') + 
              tag.fullMatch + 
              (needsTrailingNewlines ? '\n\n' : '');
            
            // Replace just this occurrence
            newText = newText.substring(0, tag.position) + 
                      replacement + 
                      newText.substring(afterTagEnd);
          }
        });
        
        if (newText !== args.text) {
          console.log('🖼️ ENHANCEMENT: Updated text with proper image tag formatting');
          args.text = newText;
        }
      }
    }
    
    // Additional pre-processing for text that might contain markdown links
    if (args.text && args.text.includes('[') && args.text.includes(']') && args.text.includes('(')) {
      console.log('Preprocessing text for markdown links');
    }
    
    // Parse the arguments
    const { text, blocks = null, color = "good", ephemeral = false, attachments = null, threadTs, reasoning } = args;
    // ^ Using "good" as default which is green in Slack, but it will be overridden if user provides a color
    
    // Set default channel to the one in thread state if not provided
    let channel = args.channel;
    
    // If no channel specified, try to get it from thread state
    if (!channel && threadState) {
      if (typeof threadState.getChannel === 'function') {
        try {
          channel = threadState.getChannel();
          console.log(`🔍 Using channel from threadState.getChannel(): ${channel}`);
        } catch (e) {
          console.log('⚠️ Error getting channel from threadState.getChannel()', e.message);
        }
      } 
      else if (threadState.channel) {
        channel = threadState.channel;
        console.log(`🔍 Using channel from threadState.channel: ${channel}`);
      }
      else if (threadState.channelId) {
        channel = threadState.channelId;
        console.log(`🔍 Using channel from threadState.channelId: ${channel}`);
      }
      else if (threadState.metadata && threadState.metadata.channelId) {
        channel = threadState.metadata.channelId;
        console.log(`🔍 Using channel from threadState.metadata.channelId: ${channel}`);
      }
      else if (threadState.threadId && threadState.threadId.includes(':')) {
        const parts = threadState.threadId.split(':');
        if (parts.length > 0) {
          channel = parts[0];
          console.log(`🔍 Extracted channel from threadId: ${channel}`);
        }
      }
    }
    
    // Validate that we have all required parameters
    if (!text && !blocks && !attachments) {
      throw new Error('Missing required parameters: Either text, blocks, or attachments must be provided');
    }
    
    if (!channel) {
      throw new Error('Missing required parameter: channel (and could not determine from context)');
    }
    
    // If no blocks or text provided, return error
    if (!text && !blocks && !attachments) {
      return { error: "No message content (text or blocks) provided" };
    }

    try {
      // Get channel from threadState - we already have it from earlier code
      // No need to redefine channel variable here
      
      try {
        // Try other methods if we don't have the channel yet
        if (!channel) {
          // Check if we can find the channel in conversation context - this is most reliable for DMs
          if (threadState && typeof threadState._conversationContext === 'string') {
            // Extract channel from context like "User:UF8TSTK9A, Channel:D01D28456M9, Thread:1743090429.012529"
            const contextMatch = threadState._conversationContext.match(/Channel:([CD][0-9A-Z]+)/);
            if (contextMatch && contextMatch[1]) {
              channel = contextMatch[1];
              debugLog("Extracted channel from conversation context:", channel);
            }
          }
        }
        
        // Extract from thread messages if we have them
        if (!channel && threadState?.messages && threadState.messages.length > 0) {
          // Check the first message - might have user information
          const firstMsg = threadState.messages[0];
          if (firstMsg.text && typeof firstMsg.text === 'string') {
            // Try to extract from any text that might have channel info
            const channelInTextMatch = firstMsg.text.match(/([CD][0-9A-Z]+)/);
            if (channelInTextMatch) {
              channel = channelInTextMatch[1];
              debugLog("Found potential channel ID in message text:", channel);
            }
          }
        }
        
        // If still don't have a channel, try to extract from context metadata
        if (!channel && threadState?.metadata) {
          const contextMetadata = threadState.getMetadata ? threadState.getMetadata('context') : null;
          if (contextMetadata && contextMetadata.channelId) {
            channel = contextMetadata.channelId;
            debugLog("Found channel in context metadata:", channel);
          }
        }
        
        // If we couldn't get it from context, try other methods
        if (!channel) {
          // Try multiple methods to get the channel in order of preference
          if (typeof threadState.getChannel === 'function') {
            channel = threadState.getChannel();
            debugLog("Retrieved channel via getChannel() method:", channel);
          } else if (threadState.channel) {
            channel = threadState.channel;
            debugLog("Using threadState.channel property:", channel);
          } else if (threadState.channelId) {
            channel = threadState.channelId;
            debugLog("Using threadState.channelId property:", channel);
          } else if (threadState.event && threadState.event.channel) {
            channel = threadState.event.channel;
            debugLog("Using threadState.event.channel property:", channel);
          } 
          // Check in threadId which might be in format channel:timestamp
          else if (threadState.threadId && threadState.threadId.includes(':')) {
            channel = threadState.threadId.split(':')[0];
            debugLog("Extracted channel from threadId:", channel);
          } 
          // Non-colon threadId might already be a channel ID
          else if (threadState.threadId && (threadState.threadId.startsWith('C') || threadState.threadId.startsWith('D'))) {
            channel = threadState.threadId;
            debugLog("Using threadId as channel directly:", channel);
          }
          // Check in metadata
          else if (threadState.metadata && threadState.metadata.channel) {
            channel = threadState.metadata.channel;
            debugLog("Using threadState.metadata.channel:", channel);
          } 
          // Check in metadata channelId
          else if (threadState.metadata && threadState.metadata.channelId) {
            channel = threadState.metadata.channelId;
            debugLog("Using threadState.metadata.channelId:", channel);
          }
          // Check if direct message property contains channel
          else if (threadState.message && threadState.message.channel) {
            channel = threadState.message.channel;
            debugLog("Using threadState.message.channel:", channel);
          }
          // Try to extract from first message if available
          else if (threadState.messages && threadState.messages.length > 0) {
            const firstMessage = threadState.messages[0];
            if (firstMessage.channel) {
              channel = firstMessage.channel;
              debugLog("Extracted channel from first message.channel:", channel);
            } 
          }
        }
        
        // If still no channel, see if there's any D01D28456M9 pattern in the thread ID
        if (!channel && threadState && threadState.threadId) {
          const directChannelMatch = threadState.threadId.match(/([CD][0-9A-Z]+)/);
          if (directChannelMatch) {
            channel = directChannelMatch[1];
            console.log("Extracted possible channel directly from threadId text:", channel);
          }
        }
        
        // Final fallback - try to extract from the conversation details
        if (!channel && threadState && threadState.messages && threadState.messages.length > 0) {
          // This is our last resort - check for conversation context in other properties
          const message = threadState.messages[0];
          if (message.conversationContext && typeof message.conversationContext === 'string') {
            const contextMatch = message.conversationContext.match(/Channel:([CD][0-9A-Z]+)/);
            if (contextMatch && contextMatch[1]) {
              channel = contextMatch[1];
              console.log("Extracted channel from message conversation context:", channel);
            }
          }
          
          // Check if any log lines include the channel information
          if (!channel && message.text) {
            // Sometimes the channel is logged in the text as "Channel: D01D28456M9"
            const channelMatch = message.text.match(/Channel:\s*([CD][0-9A-Z]+)/);
            if (channelMatch && channelMatch[1]) {
              channel = channelMatch[1];
              console.log("Extracted channel from message text:", channel);
            }
          }
        }

        // Final fallback - if we have the userId in context, and this is a DM, we could use the openConversation API
        if (!channel && threadState?.getMetadata) {
          const context = threadState.getMetadata('context');
          if (context && context.userId && !context.threadTs) {
            // This looks like a direct message without a thread - we can try to open a conversation
            try {
              console.log("Attempting to open conversation with user:", context.userId);
              console.log('🔍 DEBUG: Using slack client for conversations.open. Client exists:', !!slack);
              const convo = await slack.conversations.open({ users: context.userId });
              if (convo.ok && convo.channel && convo.channel.id) {
                channel = convo.channel.id;
                console.log("Successfully opened conversation with channel:", channel);
              }
            } catch (err) {
              console.log("Failed to open conversation:", err.message);
            }
          }
        }
        
        if (!channel) {
          console.error("Unable to determine channel from threadState");
          return { error: "Could not determine channel to post message to" };
        }
      } catch (channelError) {
        console.error("Error trying to get channel:", channelError);
        return { error: `Error getting channel: ${channelError.message}` };
      }

      // Check if we have text to post
      if (!text) {
        return { 
          ok: false, 
          error: 'No text provided for message',
          reasoning
        };
      }
      
      // Format the color using the normalizeColor function
      const processedColor = normalizeColor(color);
      debugLog(`🎨 Using color: ${processedColor}`);
      
      // Replace literal newline strings with actual newlines
      const processedText = typeof text === 'string' ? text.replace(/\\n/g, '\n') : text;
      
      // Log the entire text for debugging
      console.log('💬 Preprocessing text for markdown links:', processedText ? (processedText.substring(0, 100) + (processedText.length > 100 ? '...' : '')) : 'No text provided');
      
      // Extra logging to see if image/markdown syntax is present
      if (processedText && (processedText.includes('![') || processedText.includes('(image:'))) {
        console.log('🔍 DETECTED IMAGE SYNTAX in input text');
        
        // Find and log all image markdown patterns
        const markdownMatches = processedText.match(/!\[.*?\]\(.*?\)/g);
        if (markdownMatches) {
          console.log(`🔍 Found ${markdownMatches.length} markdown image tags:`);
          markdownMatches.forEach((match, i) => {
            console.log(`  [${i+1}] ${match}`);
          });
        }
        
        // Find and log all image: patterns
        const imageTagMatches = processedText.match(/\(image:.*?\)/g);
        if (imageTagMatches) {
          console.log(`🔍 Found ${imageTagMatches.length} image tag patterns:`);
          imageTagMatches.forEach((match, i) => {
            console.log(`  [${i+1}] ${match}`);
          });
        }
      }
      
      // Check if the text contains our block builder syntax (#blockType:)
      if (processedText && processedText.includes('#') && /#\w+:/.test(processedText)) {
        console.log('🔍 DEBUG: Entering Block Builder parsing section');
        debugLog('🧩 Text contains Block Builder syntax, using BlockBuilder parser');
        
        try {
          // Use the Block Builder parser
          console.log('🔍 DEBUG: About to call parseMessage with text:', processedText.substring(0, 50) + '...');
          const result = parseMessage(processedText);
          console.log('🔍 DEBUG: parseMessage returned result with blocks:', result.blocks?.length || 0);
          console.log('🔍 DEBUG: parseMessage returned result with attachments:', result.attachments?.length || 0);
          
          // Set up the message with blocks and attachments from block builder
          const message = {
            channel,
            text: processedText.replace(/#\w+:[\s\S]*?(?=#\w+:|$)/g, '').trim() || 'Message with rich formatting',
            ...result
          };
          
          // Add thread_ts if we're in a thread
          if (typeof threadTs !== 'undefined' && threadTs) {
            message.thread_ts = threadTs;
          } else if (threadState && threadState.getMetadata && threadState.getMetadata('context') && threadState.getMetadata('context').threadTs) {
            // Fallback to threadState.context.threadTs
            message.thread_ts = threadState.getMetadata('context').threadTs;
          }
          
          // Only send if we have valid blocks or attachments
          if ((message.blocks && message.blocks.length > 0) || 
              (message.attachments && message.attachments.length > 0)) {
            // Send the message
            debugLog('📨 Sending message with Block Builder blocks:', JSON.stringify(message.blocks?.length || 0));
            debugLog('📨 Sending message with Block Builder attachments:', JSON.stringify(message.attachments?.length || 0));
            
            console.log('🔍 DEBUG: About to use slack client for postMessage. Is defined:', typeof slack !== 'undefined');
            
            try {
              // Explicitly verify we have a valid client
              if (typeof slack !== 'object' || slack === null) {
                throw new Error('Slack client is not a valid object');
              }
              
              const response = await slack.chat.postMessage(message);
              console.log('✅ Message posted with Block Builder format, timestamp:', response.ts);
              
              return {
                ok: true,
                ts: response.ts,
                channel: response.channel,
                message_format: 'block_builder',
                reasoning
              };
            } catch (slackApiError) {
              console.error('❌ Error calling Slack API:', slackApiError.message);
              // Continue with normal processing below as fallback
              console.log('⚠️ Falling back to standard message format after Slack API error');
            }
          } else {
            console.error('❌ No valid blocks or attachments found after Block Builder parsing');
            // Continue with normal processing below
          }
        } catch (blockBuilderError) {
          console.error('❌ Error using Block Builder:', blockBuilderError);
          debugLog('⚠️ Falling back to standard parser after Block Builder error');
          // Continue with normal processing below
        }
      }
      
      // Parse the text to blocks using standard parser as fallback
      const parsedBlocks = parseTextToBlocks(processedText);
      
      // Set up the message options
      const messageOptions = {
        text: '', // Empty string for the main text field (all content goes in attachments)
        channel: channel,
      };
      
      // Check if there are any image blocks that need special handling
      const imageBlocks = parsedBlocks.filter(block => block.type === 'image');
      const nonImageBlocks = parsedBlocks.filter(block => block.type !== 'image');
      
      console.log(`📦 MESSAGE STRUCTURE: ${parsedBlocks.length} total blocks, ${imageBlocks.length} image blocks`);
      
      // Log the actual types of all blocks for debugging
      console.log('📦 BLOCK TYPES:');
      parsedBlocks.forEach((block, index) => {
        console.log(`  [${index + 1}] Type: ${block.type}`);
        if (block.type === 'image') {
          console.log(`    URL: ${block.image_url.substring(0, 50)}...`);
        }
      });
      
      // If there are image blocks, we need to handle them specially
      if (imageBlocks.length > 0) {
        console.log(`📸 IMAGE BLOCKS DETECTED: Using modified structure to preserve color bar`);
        
        // Put text blocks in attachments for color and image blocks directly in blocks
        if (nonImageBlocks.length > 0) {
          // Keep the color bar on text content by using attachments
        messageOptions.attachments = [{
          color: processedColor,
            blocks: nonImageBlocks,
          fallback: processedText || "Message from bot"
        }];
          
          // Put image blocks directly in the main blocks array
          messageOptions.blocks = imageBlocks;
          
          console.log('🎨 Set up dual structure: image blocks in main blocks, text blocks in colored attachment');
          console.log(`🎨 Using color: ${processedColor} for attachment with ${nonImageBlocks.length} text blocks`);
          console.log(`🎨 Final message structure: ${imageBlocks.length} image blocks in main blocks, ${nonImageBlocks.length} blocks in colored attachment`);
        } else {
          // Only image blocks - still keep a color bar attachment but no blocks in it
          messageOptions.blocks = imageBlocks;
          messageOptions.attachments = [{
            color: processedColor,
            fallback: "Image message" 
          }];
          
          console.log('🎨 Only image blocks - keeping empty colored attachment');
          console.log(`🎨 Using color: ${processedColor} for empty attachment, with ${imageBlocks.length} image blocks in main blocks`);
        }
      } 
      // If there are no user context blocks and no image blocks, use attachments for color
      else if (!parsedBlocks.some(block => 
          block.type === 'context' && 
          block.elements?.some(el => 
            // Check if this is one of our user context elements (user mention)
            el.type === 'mrkdwn' && el.text?.includes('<@') && el.text?.includes('>')
          )
      )) {
        console.log('📦 NO IMAGE BLOCKS: Using standard attachment structure with blocks inside attachments');
        messageOptions.attachments = [{
          color: processedColor,
          blocks: parsedBlocks,
          fallback: processedText || "Message from bot"
        }];
      } else {
        console.log('⚠️ Message contains user context blocks, using direct blocks');
        messageOptions.blocks = parsedBlocks;
        
        // Add a colorful attachment without blocks for styling
        messageOptions.attachments = [{
          color: processedColor,
          fallback: processedText || "Message from bot"
        }];
      }
      
      // If blocks were provided directly in the args, use those instead
      if (blocks && Array.isArray(blocks)) {
        console.log('Using provided blocks array instead of parsed text');
        
        // Check if any of the provided blocks contain user context elements
        const hasUserContexts = blocks.some(block => 
          block.type === 'context' && 
          block.elements?.some(el => 
            // Check if this is one of our user context elements (either mention or profile image)
            (el.type === 'mrkdwn' && el.text?.includes('<@') && el.text?.includes('>')) ||
            (el.type === 'image' && el.image_url?.includes('slack-edge.com'))
          )
        );
        
        if (hasUserContexts) {
          // If we have user contexts, use blocks directly
          messageOptions.blocks = blocks;
          delete messageOptions.attachments;
          console.log('⚠️ Provided blocks contain user context elements, sending as direct blocks');
        } else {
          // Otherwise use attachments for the color
          if (messageOptions.attachments) {
            messageOptions.attachments[0].blocks = blocks;
          } else {
            messageOptions.attachments = [{
              color: processedColor,
              blocks: blocks,
              fallback: processedText || "Message from bot"
            }];
          }
          delete messageOptions.blocks;
        }
      }
      
      // If attachments were provided directly in the args, ensure proper structure
      if (attachments) {
        // First check if we have any user context blocks in the parsed blocks
        const hasUserContexts = parsedBlocks.some(block => 
          block.type === 'context' && 
          block.elements?.some(el => el.type === 'user')
        );
        
        if (hasUserContexts) {
          // If we have user contexts, keep using direct blocks instead of attachments
          console.log('⚠️ Message contains user context blocks, preserving direct blocks');
          // We still want to use the color from attachments if possible
          if (Array.isArray(attachments) && attachments.length > 0 && attachments[0].color) {
            console.log(`Using color ${attachments[0].color} from provided attachments`);
            // Add a divider block before any additional content from attachments
            messageOptions.blocks.push({ type: 'divider' });
            
            // Add any non-user blocks from attachments
            if (attachments[0].blocks) {
              const nonUserBlocks = attachments[0].blocks.filter(block => 
                !(block.type === 'context' && block.elements?.some(el => el.type === 'user'))
              );
              if (nonUserBlocks.length > 0) {
                messageOptions.blocks.push(...nonUserBlocks);
              }
            }
          }
        } else {
          // No user contexts, process attachments normally
          if (Array.isArray(attachments)) {
            // If attachments is an array, process each attachment
            messageOptions.attachments = attachments.map(attachment => {
              // Ensure each attachment has a color
              if (!attachment.color) {
                attachment.color = processedColor;
              }
              return attachment;
            });
          } else {
            // If attachments is a single object, wrap it in an array
            messageOptions.attachments = [{
              ...attachments,
              color: attachments.color || processedColor
            }];
          }
          // When using attachments, we don't need direct blocks
          delete messageOptions.blocks;
        }
      }
      
      // Add thread_ts if available
      if (threadTs) {
        messageOptions.thread_ts = threadTs;
      } else if (threadState && typeof threadState.getThreadTs === 'function') {
        try {
          const stateThreadTs = threadState.getThreadTs();
          if (stateThreadTs) {
            messageOptions.thread_ts = stateThreadTs;
          }
        } catch (threadTsError) {
          console.log("Error getting thread_ts, continuing without it:", threadTsError.message);
        }
      }
      // Direct threadTs property
      else if (threadState.threadTs) {
        messageOptions.thread_ts = threadState.threadTs;
        console.log("Using threadState.threadTs property:", messageOptions.thread_ts);
      }
      // Check for thread ID in threadState
      else if (threadState.threadId && threadState.threadId.includes(':')) {
        const parts = threadState.threadId.split(':');
        if (parts.length > 1) {
          messageOptions.thread_ts = parts[1];
          console.log("Extracted thread_ts from threadId:", messageOptions.thread_ts);
        }
      }
      // Check in metadata
      else if (threadState.metadata && threadState.metadata.threadTs) {
        messageOptions.thread_ts = threadState.metadata.threadTs;
        console.log("Using threadState.metadata.threadTs:", messageOptions.thread_ts);
      }
      // Check direct message property
      else if (threadState.message && threadState.message.ts) {
        messageOptions.thread_ts = threadState.message.ts;
        console.log("Using threadState.message.ts:", messageOptions.thread_ts);
      }
      // Try to extract from messages if available
      else if (threadState.messages && threadState.messages.length > 0) {
        const firstMessage = threadState.messages[0];
        // If first message has threadTs
        if (firstMessage.threadTs) {
          messageOptions.thread_ts = firstMessage.threadTs;
          console.log("Extracted thread_ts from first message threadTs:", messageOptions.thread_ts);
        }
        // Or if it has ts
        else if (firstMessage.ts) {
          messageOptions.thread_ts = firstMessage.ts;
          console.log("Extracted thread_ts from first message ts:", messageOptions.thread_ts);
        }
      }
      
      debugLog('📨 Sending message to Slack');
      debugLog('Channel:', messageOptions.channel);
      debugLog('Thread:', messageOptions.thread_ts || 'N/A');
      debugLog('Attachment color:', processedColor);
      debugLog('Block count:', parsedBlocks.length);
      
      // Final structure summary
      console.log('📋 FINAL MESSAGE STRUCTURE:');
      console.log(`  - Direct blocks: ${messageOptions.blocks ? messageOptions.blocks.length : 0}`);
      if (messageOptions.blocks) {
        console.log('  - Block types:');
        messageOptions.blocks.forEach((block, i) => {
          console.log(`    [${i+1}] ${block.type}`);
        });
      }
      
      console.log(`  - Attachments: ${messageOptions.attachments ? messageOptions.attachments.length : 0}`);
      if (messageOptions.attachments && messageOptions.attachments.length > 0) {
        messageOptions.attachments.forEach((attachment, i) => {
          console.log(`    [${i+1}] Color: ${attachment.color || 'none'}, Blocks: ${attachment.blocks ? attachment.blocks.length : 0}`);
        });
      }
      
      // Now send the message to Slack
      console.log('🔍 DEBUG: Using original slack client for standard message. Client exists:', !!slack);
      
      const result = await slack.chat.postMessage(messageOptions);
      
      // Log the success
      console.log(`✅ Message posted successfully (ts: ${result.ts})`);
      
      // Update the thread state with the new message if applicable
      if (threadState.isThreadUpdate && typeof threadState.addMessage === 'function') {
        console.log('📝 Updating thread state with the new message');
        
        try {
          threadState.addMessage({
            text: processedText,
            isUser: false,
            ts: result.ts,
            blocks: parsedBlocks
          });
        } catch (addMessageError) {
          console.log("Error adding message to thread state:", addMessageError.message);
        }
      }
      
      return {
        ok: true,
        ts: result.ts,
        channel: result.channel,
        message: result.message,
        reasoning
      };
      
    } catch (error) {
      console.error('❌ Error in postMessage:', error.message);
      console.error(error.stack);
      
      return {
        ok: false,
        error: error.message,
        reasoning: reasoning
      };
    }
  } catch (error) {
    console.error('❌ Error in postMessage:', error.message);
    console.error(error.stack);
    
    return {
      ok: false,
      error: error.message,
      reasoning: reasoning
    };
  }
}

/**
 * Get a user's profile picture URL from Slack API
 * @param {string} userId - The Slack user ID 
 * @returns {Promise<string>} - The profile picture URL
 */
async function getUserProfilePicture(userId) {
  try {
    // Get Slack client - use the already imported getSlackClient function
    const slack = getSlackClient();
    
    // Call users.info API to get user profile
    const result = await slack.users.info({ user: userId });
    
    if (result.ok && result.user && result.user.profile) {
      // Get the image_48 field from profile or fall back to image_24
      const imageUrl = result.user.profile.image_48 || result.user.profile.image_24;
      console.log(`✅ Retrieved profile picture for ${userId}: ${imageUrl}`);
      return imageUrl;
    } else {
      console.warn(`⚠️ Failed to get profile picture for ${userId}`);
      // Return default URL format 
      const workspaceId = getWorkspaceId();
      return `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-48`;
    }
  } catch (error) {
    console.warn(`⚠️ Error getting profile picture for ${userId}:`, error.message);
    // Return default URL format
    const workspaceId = getWorkspaceId();
    return `https://ca.slack-edge.com/${workspaceId}-${userId}-4c812ee43716-48`;
  }
}

// Export the postMessage function
module.exports = {
  postMessage,
  parseTextToBlocks  // Export the parsing function
};