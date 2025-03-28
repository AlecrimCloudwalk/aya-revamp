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
  
  // Skip processing if the text contains our special directives
  // This prevents accidental processing of !usercontext: markers
  if (text.includes('!usercontext:') || text.includes('!context!')) {
    console.log('🔍 Skipping user mention processing for text with special directives');
    return text;
  }
  
  // Handle (usercontext) format which is our new preferred format
  if (text.includes('(usercontext)')) {
    console.log('🔍 Text contains usercontext format, keeping as is for block processing');
    return text;
  }
  
  // First, normalize any improper format like <@|USER_ID> to proper format
  text = text.replace(/<@\|([A-Z0-9]+)>/g, '<@$1>');
  
  // Skip processing if the text already has properly formatted mentions
  // This prevents double-processing of already correct mentions
  if (/<@[A-Z0-9]+>/.test(text)) {
    return text;
  }
  
  // Skip processing URLs in angle brackets
  // This ensures URLs like <https://example.com> remain intact
  let processedText = '';
  let currentPos = 0;
  const urlRegex = /<(https?:\/\/[^>]+)>/g;
  let match;
  
  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before the URL
    processedText += processMentionsInSegment(text.substring(currentPos, match.index));
    // Add the URL as is
    processedText += match[0];
    currentPos = match.index + match[0].length;
  }
  
  // Process the remaining text
  if (currentPos < text.length) {
    processedText += processMentionsInSegment(text.substring(currentPos));
  }
  
  return processedText || text;
}

/**
 * Helper function to process mentions in a text segment
 * @param {string} segment - Text segment to process
 * @returns {string} - Processed text segment
 */
function processMentionsInSegment(segment) {
  // Convert plain @USER_ID to proper Slack mention format <@USER_ID>
  segment = segment.replace(/@([A-Z0-9]+)\b/g, '<@$1>');
  
  // Ensure any standalone USER_ID that looks like a user ID is properly formatted
  // This matches word boundaries to avoid capturing parts of other words/IDs
  segment = segment.replace(/\b([A-Z][A-Z0-9]{7,})\b/g, (match, userId) => {
    // Only convert if it looks like a Slack user ID (starts with U or W typically)
    if (/^[UW][A-Z0-9]{8,}$/.test(userId)) {
      return `<@${userId}>`;
    }
    return match; // Return unchanged if not a likely user ID
  });
  
  return segment;
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
      const parts = trimmedParagraph.substring(19).split(':');
      if (parts.length >= 3) {
        const imageUrl = parts[0];
        const altText = parts[1];
        // Join the rest of the parts back together (in case the content itself contains colons)
        const content = parts.slice(2).join(':');
        
        // Create a section block with text and image accessory
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: content
          },
          accessory: {
            type: 'image',
            image_url: imageUrl,
            alt_text: altText
          }
        });
      } else {
        // Malformed section with image, treat as regular text
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: trimmedParagraph.substring(19) // Remove the prefix
          }
        });
      }
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
      const contextText = trimmedParagraph.substring(9).trim();
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: processUserMentions(contextText)
          }
        ]
      });
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
        const imagePattern = /^\(image:(.*?)(?::(.*?))?\)$/;
        const imageMatch = trimmedParagraph.match(imagePattern);
        
        if (imageMatch) {
          const imageUrl = imageMatch[1];
          const altText = imageMatch[2] || 'Image';
          
          // Create an actual image block
          blocks.push({
            type: 'image',
            image_url: imageUrl,
            alt_text: altText
          });
          
          console.log(`🖼️ Added image block with URL: ${imageUrl} and alt text: ${altText}`);
        } else {
          // If it doesn't match the exact pattern, treat as regular text
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: processUserMentions(trimmedParagraph)
            }
          });
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
    console.log(`🖼️ Converting markdown image to Slack image block: "${match}" => "${alt}" -> "${url}"`);
    // Create a special marker that will be processed later to create an image block
    // We'll use !image-block: prefix to distinguish from regular hyperlinks
    return `!image-block:${url}:${alt || 'Image'}`;
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
  formattedText = formattedText.replace(/\(context\)(.*?)\(!context\)/g, '!context! $1');
  formattedText = formattedText.replace(/\(context\)(.*?)\(\/context\)/g, '!context! $1'); // Old format
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[context\](.*?)\[!context\]/g, '!context! $1');
  formattedText = formattedText.replace(/\[context\](.*?)\[\/context\]/g, '!context! $1');
  
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
    return `!section-with-image:${url}:${alt || 'Image'}:${content}`;
  });
  formattedText = formattedText.replace(/\(section:(.*?)(?::(.*?))?\)([\s\S]*?)\(\/section\)/g, (match, url, alt, content) => {
    return `!section-with-image:${url}:${alt || 'Image'}:${content}`;
  });
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[section:(.*?)(?::(.*?))?\]([\s\S]*?)\[!section\]/g, (match, url, alt, content) => {
    return `!section-with-image:${url}:${alt || 'Image'}:${content}`;
  });
  formattedText = formattedText.replace(/\[section:(.*?)(?::(.*?))?\]([\s\S]*?)\[\/section\]/g, (match, url, alt, content) => {
    return `!section-with-image:${url}:${alt || 'Image'}:${content}`;
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
  formattedText = formattedText.replace(/\(image:(.*?)(?::(.*?))?\)/g, (match, url, alt) => {
    debugLog(`🔄 Processing image tag with URL: ${url}`);
    // Convert directly to Slack hyperlink format instead of !image: marker
    return `<${url}|${alt || 'Image'}>`;
  });
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[image:(.*?)(?::(.*?))?\]/g, (match, url, alt) => {
    debugLog(`🔄 Processing image tag with square brackets: ${url}`);
    // Convert directly to Slack hyperlink format instead of !image: marker
    return `<${url}|${alt || 'Image'}>`;
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
  const paragraphs = text.split(/\n{2,}/);
  console.log(`🔢 Processing ${paragraphs.length} paragraphs`);
  
  // Process each paragraph
  paragraphs.forEach((paragraph, index) => {
    const content = paragraph.trim();
    if (!content) return; // Skip empty paragraphs
    
    console.log(`📝 Processing paragraph #${index + 1}:`, content.substring(0, 50) + (content.length > 50 ? '...' : ''));
    
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
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: contextMatch[1]
          }
        ]
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
          
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: sectionText.trim()
            },
            accessory: {
              type: 'image',
              image_url: imageUrl,
              alt_text: altText
            }
          });
          return;
        }
      }
    }
    
    // 5. Check for header: (header)text(!header)
    const headerMatch = content.match(/^\(header\)(.*?)(?:\(!header\)|$)/s);
    if (headerMatch) {
      console.log('🔖 Adding header block');
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: headerMatch[1],
          emoji: true
        }
      });
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
  
  console.log(`✅ Created ${blocks.length} blocks`);
  
  // Debug logs to show image blocks
  const imageBlocks = blocks.filter(block => block.type === 'image');
  if (imageBlocks.length > 0) {
    console.log(`🖼️ Found ${imageBlocks.length} image blocks:`);
    imageBlocks.forEach((block, index) => {
      console.log(`  Image block #${index + 1}: ${block.image_url.substring(0, 50)}... (alt: ${block.alt_text})`);
    });
  } else {
    console.log('⚠️ No image blocks were created');
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
 * Posts a message to Slack with formatting options
 * @param {Object} args - Message arguments from the LLM
 * @param {Object} threadState - State of the current thread context
 * @returns {Object} - Result of the operation
 */
async function postMessage(args, threadState) {
  try {
    const startTime = Date.now();
    console.log('📣 postMessage tool called with args:', JSON.stringify(args, null, 2));
    
    // Additional pre-processing for text that might contain markdown links
    if (args.text && typeof args.text === 'string') {
      // Pre-process any markdown links before JSON parsing
      // This helps prevent issues with JSON parsing of markdown links
      console.log('💬 Preprocessing text for markdown links:', args.text.substring(0, 100) + (args.text.length > 100 ? '...' : ''));
      
      // Handle markdown image syntax ![alt](url) before any other processing
      args.text = args.text.replace(/!\[(.*?)\]\((https?:\/\/[^)]+)\)/g, 
        (match, alt, url) => {
          console.log(`🖼️ Pre-processing Markdown image format: "${match}" => "${alt}" -> "${url}"`);
          return `(image:${url}:${alt || 'Image'})`;
        }
      );
      
      // Handle markdown links specifically for avatar links
      if (args.text.includes('[Click here to view your avatar]')) {
        console.log('🔗 Found avatar link in markdown format, pre-processing...');
        
        // Use a targeted replacement for this specific pattern
        args.text = args.text.replace(/\[Click here to view your avatar\]\((https?:\/\/[^)]+)\)/g, 
          (match, url) => {
            console.log(`🔗 Converting avatar link: "${url}"`);
            return `<${url}|Click here to view your avatar>`;
          }
        );
      }
    }
    
    // Disable detailed threadState logging to keep console cleaner
    if (process.env.DEBUG_THREAD_STATE !== 'true') {
      // Skip detailed thread state logging unless explicitly enabled
    } else {
      // Add even more detailed debugging logs to inspect threadState
      console.log("postMessage called with threadState:", {
        threadStateType: typeof threadState,
        threadStateKeys: threadState ? Object.keys(threadState) : 'null',
        channelProperty: threadState ? threadState.channel : 'null',
        channelIdProperty: threadState ? threadState.channelId : 'null',
        hasGetChannelMethod: threadState ? typeof threadState.getChannel === 'function' : 'null',
        // Log more potential places where channel info might be stored
        threadId: threadState?.threadId,
        metadataKeys: threadState?.metadata ? Object.keys(threadState.metadata) : 'no metadata',
        metadata: threadState?.metadata ? JSON.stringify(threadState.metadata) : 'no metadata',
        messagesCount: threadState?.messages ? threadState.messages.length : 0,
        firstMessageSample: threadState?.messages && threadState.messages.length > 0 ? 
          JSON.stringify(threadState.messages[0], null, 2) : 'no messages'
      });
    }

    // Extract channel directly from the console output if needed
    const consoleData = threadState ? JSON.stringify(threadState) : '';
    const channelMatch = consoleData.match(/Channel:([CD][0-9A-Z]+)/);
    let extractedChannel = channelMatch ? channelMatch[1] : null;
    if (extractedChannel && process.env.DEBUG_THREAD_STATE === 'true') {
      console.log("Extracted channel from thread state console representation:", extractedChannel);
    }

    const { text, blocks = null, color = "#0000FF", ephemeral = false, attachments = null, threadTs, reasoning } = args;
    
    // If no blocks or text provided, return error
    if (!text && !blocks && !attachments) {
      return { error: "No message content (text or blocks) provided" };
    }

    try {
      // Get channel from threadState
      let channel = extractedChannel; // Use our extracted channel as default
      
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
              const slack = getSlackClient();
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
      
      // Parse the text to blocks
      const parsedBlocks = parseTextToBlocks(processedText);
      
      // Set up the message options
      const messageOptions = {
        text: '', // Empty string for the main text field (all content goes in attachments)
        channel: channel,
      };
      
      // Check if there are any image blocks that need special handling
      const imageBlocks = parsedBlocks.filter(block => block.type === 'image');
      const nonImageBlocks = parsedBlocks.filter(block => block.type !== 'image');
      
      // If there are image blocks, we need to keep them in the main blocks array
      if (imageBlocks.length > 0) {
        console.log(`📸 Found ${imageBlocks.length} image blocks that need special handling`);
        messageOptions.blocks = parsedBlocks;
        
        // For styling, we'll add a color attachment, but without the blocks
        messageOptions.attachments = [{
          color: processedColor,
          fallback: processedText || "Message from bot"
        }];
      } 
      // If there are no user context blocks and no image blocks, use attachments for color
      else if (!parsedBlocks.some(block => 
          block.type === 'context' && 
          block.elements?.some(el => 
            // Check if this is one of our user context elements (user mention)
            el.type === 'mrkdwn' && el.text?.includes('<@') && el.text?.includes('>')
          )
      )) {
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
      
      // Now send the message to Slack
      let slack;
      try {
        // Try to get the Slack client from threadState
        if (typeof threadState.getSlack === 'function') {
          slack = threadState.getSlack();
        } else {
          // Fallback to importing directly
          const { getSlackClient } = require('../slackClient.js');
          slack = getSlackClient();
        }
      } catch (slackError) {
        console.error("Error getting Slack client:", slackError);
        return { error: `Error getting Slack client: ${slackError.message}` };
      }
      
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
    // Get Slack client
    const { getSlackClient } = require('../slackClient.js');
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