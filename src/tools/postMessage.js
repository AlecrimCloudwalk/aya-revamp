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
  
  // First, normalize any improper format like <@|USER_ID> to proper format
  text = text.replace(/<@\|([A-Z0-9]+)>/g, '<@$1>');
  
  // Skip processing if the text already has properly formatted mentions
  // This prevents double-processing of already correct mentions
  if (/<@[A-Z0-9]+>/.test(text)) {
    return text;
  }
  
  // Convert plain @USER_ID to proper Slack mention format <@USER_ID>
  text = text.replace(/@([A-Z0-9]+)\b/g, '<@$1>');
  
  // Ensure any standalone USER_ID that looks like a user ID is properly formatted
  // This matches word boundaries to avoid capturing parts of other words/IDs
  text = text.replace(/\b([A-Z][A-Z0-9]{7,})\b/g, (match, userId) => {
    // Only convert if it looks like a Slack user ID (starts with U or W typically)
    if (/^[UW][A-Z0-9]{8,}$/.test(userId)) {
      return `<@${userId}>`;
    }
    return match; // Return unchanged if not a likely user ID
  });
  
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
      
      // Simple and direct approach - split by commas and create context elements
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
      
      // Create elements array for the context block
      const elements = [];
      
      // Process each user ID or name (up to 10 to prevent overflow)
      const displayUsers = userIds.slice(0, 10);
      displayUsers.forEach(userId => {
        console.log(`  - Processing user reference: "${userId}"`);
        
        // Directly use the text as provided - if it's already a mention, Slack will render it properly
        // If it's a user ID without the mention format, add the mention format
        let formattedMention = userId;
        
        // Check if it already has mention formatting
        if (!userId.startsWith('<@') && !userId.endsWith('>')) {
          // Check if it looks like a raw user ID (starts with U and has uppercase/numbers)
          if (/^U[A-Z0-9]+$/i.test(userId)) {
            formattedMention = `<@${userId}>`;
            console.log(`  - Added mention formatting: ${formattedMention}`);
          } else {
            // Just use the name directly for display
            console.log(`  - Using name as-is: ${userId}`);
          }
        }
        
        elements.push({
          type: 'mrkdwn',
          text: formattedMention
        });
      });
      
      // Show if more users were truncated
      if (userIds.length > 10) {
        elements.push({
          type: 'mrkdwn',
          text: `_and ${userIds.length - 10} more_`
        });
      }
      
      // Create and add the context block
      blocks.push({
        type: 'context',
        elements: elements
      });
      
      console.log(`✅ Created user context block with ${elements.length} elements`);
      return;
    } else if (trimmedParagraph.startsWith('!image:')) {
      // Image (!image:url:alt_text)
      const imageString = trimmedParagraph.substring(7);
      const firstColonIndex = imageString.indexOf(':');
      
      if (firstColonIndex > 0) {
        const imageUrl = imageString.substring(0, firstColonIndex);
        const altText = imageString.substring(firstColonIndex + 1) || 'Image';
        
        // Don't use image blocks in attachments as they may not work well
        // Instead use a simple link with an emoji indicator
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🖼️ <${imageUrl}|${altText}>`
          }
        });
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
    return `!image:${url}:${alt || 'Image'}`;
  });
  
  // For backward compatibility, also handle square bracket format
  formattedText = formattedText.replace(/\[image:(.*?)(?::(.*?))?\]/g, (match, url, alt) => {
    return `!image:${url}:${alt || 'Image'}`;
  });
  
  // Restore placeholders in code blocks
  formattedText = formattedText.replace(/{{LEFT_PAREN}}/g, '(').replace(/{{RIGHT_PAREN}}/g, ')');
  
  console.log('💬 Text after BBCode parsing:', formattedText.substring(0, 100) + (formattedText.length > 100 ? '...' : ''));
  
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
 * Posts a message to a channel
 * @param {Object} args - The arguments for the message
 * @param {string} args.text - The text content of the message
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
    // Handle potential nested parameters structure (for direct tool invocation)
    // This allows LLM to pass parameters directly within a parameters object
    // Instead of following the outer structure precisely
    if (args.parameters && !args.text) {
      console.log('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }

    // Fix for unescaped parentheses in BBCode - preprocess text parameter
    if (args.text && typeof args.text === 'string') {
      // Replace literal newline strings with actual newlines
      args.text = args.text.replace(/\\n/g, '\n');
      console.log('🔄 Replaced literal newline strings with actual newlines');
      
      // Check for BBCode-style parentheses that might cause issues
      const hasBBCodeParentheses = /\([a-z]+\).*?\(![a-z]+\)/i.test(args.text);
      
      if (hasBBCodeParentheses) {
        console.log('⚠️ Detected potential BBCode parentheses in text, ensuring proper escaping');
        console.log('BBCode parentheses format will be correctly parsed by parseBBCode');
      }
      
      // Check for user context formatting
      if (args.text.includes('(usercontext)') || args.text.includes('[usercontext]')) {
        console.log('👤 Detected user context formatting in message, will preserve exact formatting');
      }
      
      // Check for divider
      if (args.text.includes('(divider)') || args.text.includes('[divider]') || args.text.includes('---')) {
        console.log('📏 Detected divider in message, will ensure proper splitting');
      }
    }

    // Extract the top-level reasoning (no need to filter it out)
    const reasoning = args.reasoning;

    // Filter out non-standard fields that shouldn't be sent to Slack
    // Note: reasoning is now expected at the top level, not in parameters
    const validFields = [
      'text', 'color', 'buttons', 'fields', 
      'images', 'blocks', 'attachments', 'channel', 'threadTs'
    ];
    
    const filteredArgs = {};
    for (const key of validFields) {
      if (args[key] !== undefined) {
        filteredArgs[key] = args[key];
      }
    }
    
    // Log any filtered fields for debugging (excluding reasoning which we expect at top level)
    const filteredKeys = Object.keys(args)
      .filter(key => !validFields.includes(key) && key !== 'reasoning');
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
      color = 'good',
      buttons,
      fields,
      images,
      blocks: simpleBlocks
    } = args;
    
    // Process BBCode formatting in text if present
    const processedText = text ? parseBBCode(text) : text;
    
    // Process user mentions to ensure proper formatting
    const textWithMentions = processedText ? processUserMentions(processedText) : processedText;
    
    // Prevent duplication - if blocks are provided, they take precedence over text
    // This helps avoid the issue where similar content appears twice
    let effectiveText = textWithMentions;
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
    let threadTs;
    if (args.threadTs && context?.threadTs && args.threadTs !== context.threadTs) {
      // Thread timestamp mismatch - log warning and use context threadTs instead
      console.log(`⚠️ WARNING: Ignoring mismatched thread timestamp "${args.threadTs}" - using context timestamp "${context.threadTs}" instead`);
      threadTs = context.threadTs;
    } else {
      // Use threadTs from args, or fall back to context
      threadTs = args.threadTs || context?.threadTs;
    }
    
    // Validate channel
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    // Debug the message about to be sent
    console.log(`Sending message to channel: ${channelId}`);
    console.log(`Message content: ${effectiveText ? (effectiveText.length > 100 ? effectiveText.substring(0, 100) + '...' : effectiveText) : 'No text'}`);
    console.log(`Color: ${color || 'default'}`);
    console.log(`Using text for fallback only, content will be displayed in blocks inside attachment`);
    if (threadTs) {
      console.log(`Replying in thread: ${threadTs}`);
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Normalize the color value
    const formattedColor = normalizeColor(color);
    console.log(`Using color: ${formattedColor}`);
    
    // Message structure for Slack API:
    // 1. MANDATORY: empty text field to prevent duplication
    // 2. MANDATORY: blocks go inside the colored attachment
    // 3. MANDATORY: color goes on the attachment
    // This structure ensures we get the colored vertical bar appears with the content
    
    // Prepare message options using attachments for color bar
    let messageOptions = {
      channel: channelId,
      text: "", // MANDATORY: Empty string to prevent duplication in the UI
      attachments: [{
        color: formattedColor,
        blocks: simpleBlocks,
        fallback: effectiveText || "Message from bot"
      }]
    };
    
    // Check which approach to use
    if (args.blockKit) {
      console.log('⚠️ DEPRECATED: Direct Block Kit JSON provided, this approach is discouraged.');
      // Still handle it for backward compatibility
      messageOptions = handleDirectBlocks(args, channelId);
      
      // CRITICAL FIX: Ensure the text field is empty even with direct Block Kit
      messageOptions.text = "";
    } else if (simpleBlocks && Array.isArray(simpleBlocks) && simpleBlocks.length > 0) {
      // Use our simplified blocks approach
      console.log('Using simplified blocks approach');
      
      // Note: We're not using convertSimpleBlocks here anymore because
      // Slack's API has different requirements for blocks in attachments vs. top-level blocks
      // We need to ensure all blocks in attachments have simple text structures
      
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
              // For other block types, convert to a simple section if needed
              if (typeof element === 'object' && element !== null) {
                let text = '';
                if (typeof element.text === 'string') {
                  text = processUserMentions(element.text);
                } else if (element.text && typeof element.text.text === 'string') {
                  text = processUserMentions(element.text.text);
                } else if (element.text && typeof element.text.mrkdwn === 'string') {
                  text = processUserMentions(element.text.mrkdwn);
                } else {
                  // This is where objects were being stringified incorrectly
                  // Instead, handle unknown block types more gracefully
                  if (element.type) {
                    console.log(`⚠️ Unsupported block type '${element.type}' in attachment. Converting to text.`);
                  }
                  text = JSON.stringify(element);
                }
                
                contextElements.push({
                  type: 'mrkdwn',
                  text: text
                });
              } else {
                // Handle primitive values
                contextElements.push({
                  type: 'mrkdwn',
                  text: processUserMentions(String(element))
                });
              }
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
              text = processUserMentions(block.text);
            } else if (block.text && typeof block.text.text === 'string') {
              text = processUserMentions(block.text.text);
            } else if (block.text && typeof block.text.mrkdwn === 'string') {
              text = processUserMentions(block.text.mrkdwn);
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
                text: processUserMentions(String(block))
              }
            });
          }
        }
      }
      
      // CRITICAL: Ensure blocks are inside the attachment with color
      messageOptions.attachments = [{
        color: formattedColor,
        blocks: simplifiedBlocks, 
        fallback: effectiveText || "Message from bot"
      }];
      messageOptions.text = ""; // MANDATORY: Empty string
    } else {
      // Use our new rich text approach
      console.log('Using rich text approach');
      
      // Start with blocks from our new BBCode parser
      const textBlocks = parseBBCodeToBlocks(effectiveText);
      
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
      
      // CRITICAL: Ensure blocks are inside the attachment with color
      messageOptions.attachments = [{
        color: formattedColor,
        blocks: textBlocks,
        fallback: effectiveText || "Message from bot"
      }];
      messageOptions.text = ""; // MANDATORY: Empty string
    }
    
    // Add thread_ts if we have a valid thread timestamp
    if (threadTs) {
      messageOptions.thread_ts = threadTs;
    }
    
    // Debug logging
    console.log('MESSAGE - Message structure:');
    console.log(JSON.stringify({
      hasText: !!messageOptions.text,
      textLength: messageOptions.text?.length || 0,
      hasBlocks: !!messageOptions.blocks && messageOptions.blocks.length > 0,
      blockCount: messageOptions.blocks?.length || 0,
      hasAttachments: !!messageOptions.attachments && messageOptions.attachments.length > 0,
      attachmentCount: messageOptions.attachments?.length || 0,
      threadTs: messageOptions.thread_ts || null
    }, null, 2));
    
    // Try sending the message, with detailed error logging
    let response;
    try {
      console.log('Attempting to post message to Slack...');
      response = await slackClient.chat.postMessage(messageOptions);
      console.log('✅ Message sent successfully with main format!');
      console.log(`Response timestamp: ${response.ts}`);
    } catch (postError) {
      console.log(`❌ Error posting message: ${postError.message}`);
      console.log('Error details:', postError);
      
      // Try simplified format if the first attempt fails
      try {
        // Create a simplified message with just the text and blocks, no attachments
        // Get blocks from the first attempt or generate simple ones
        const fallbackBlocks = messageOptions.attachments?.[0]?.blocks || [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: effectiveText || 'Message content'
          }
        }];
        
        const simpleOptions = {
          channel: channelId,
          text: "", // MANDATORY: Keep empty to prevent duplication
          attachments: [{
            color: formattedColor,
            blocks: fallbackBlocks,
            fallback: "Message from bot"
          }]
        };
        
        if (threadTs) {
          simpleOptions.thread_ts = threadTs;
        }
        
        console.log('Trying simplified message format...');
        response = await slackClient.chat.postMessage(simpleOptions);
        console.log('✅ Message sent successfully with simplified format!');
      } catch (simpleError) {
        console.log(`❌ Simplified format also failed: ${simpleError.message}`);
        
        // Last resort - try text-only message
        try {
          console.log('Trying text-only message as last resort...');
          const textOnlyOptions = {
            channel: channelId,
            text: effectiveText || "Message from bot" // Only use text here as absolute last resort
          };
          
          if (threadTs) {
            textOnlyOptions.thread_ts = threadTs;
          }
          
          const simpleResponse = await slackClient.chat.postMessage(textOnlyOptions);
          console.log('✅ Text-only message sent successfully!');
          response = simpleResponse;
        } catch (textOnlyError) {
          console.log(`❌ Even text-only message failed: ${textOnlyError.message}`);
          throw new Error(`Failed to post any message to Slack: ${textOnlyError.message}`);
        }
      }
    }
    
    if (!response) {
      throw new Error('No response received from Slack API');
    }

    // Debug the response
    console.log('Message posted successfully:', response.ok === true);
    console.log('Message timestamp:', response.ts);
    
    // Format the final message to include in the thread state
    if (threadState && typeof threadState.addMessage === 'function') {
      try {
        // Add a record of this message to our thread state
        threadState.addMessage({
          text: effectiveText,
          isUser: false,
          timestamp: response.ts,
          threadTs: threadTs || response.ts
        });
      } catch (error) {
        console.log('Error adding message to thread state:', error.message);
      }
    }
    
    // Return relevant information about the message
    return {
      ts: response.ts,
      channel: response.channel,
      text: effectiveText,
      blocks: messageOptions.attachments?.[0]?.blocks?.length || 0,
      threadTs: threadTs || response.ts,
      messageUrl: `https://slack.com/archives/${response.channel}/p${response.ts.replace('.', '')}`
    };
  } catch (error) {
    logError('Error posting message to Slack', error, { args });
    throw error;
  }
}

// Export the postMessage function
module.exports = {
  postMessage
};