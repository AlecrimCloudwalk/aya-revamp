/**
 * Shared utilities for Slack message formatting
 * Used by postMessage and updateMessage tools
 */
const { parseMessage, cleanForSlackApi, processUserMentions } = require('./blockBuilder');
const { formatSlackMessage } = require('../slackFormat.js');
const logger = require('./logger');

/**
 * Convert color values to properly formatted hex values
 * @param {string} color - The color hex value
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
  
  // If it's not a valid hex color, return default
  return '#0078D7';
}

/**
 * Properly unescape newlines in text content
 * This fixes the issue where newlines are showing as "\n" in messages
 * @param {string} text - The text to process
 * @returns {string} - Text with properly unescaped newlines
 */
function unescapeNewlines(text) {
  if (!text) return text;
  
  // Replace escaped newlines with actual newlines
  // This handles the double-escaped case: "\\n" → "\n" → actual newline
  return text.replace(/\\n/g, '\n');
}

/**
 * Process blocks for Slack API, including user mentions and header cleaning
 * @param {Array} blocks - Array of blocks to process
 * @returns {Array} - Processed blocks
 */
function processBlocks(blocks) {
  if (!blocks || !Array.isArray(blocks)) return blocks;
  
  return blocks.map(block => {
    // Process text fields
    if (block.text && typeof block.text.text === 'string') {
      // Process user mentions and emoji
      block.text.text = processUserMentions(block.text.text);
      
      // Properly unescape newlines in all text fields
      block.text.text = unescapeNewlines(block.text.text);
      
      // Clean newlines in header blocks (after unescaping)
      if (block.type === 'header') {
        block.text.text = block.text.text.replace(/\n/g, ' ').trim();
      }
    }
    
    // Process fields in section blocks
    if (block.type === 'section' && block.fields && Array.isArray(block.fields)) {
      block.fields = block.fields.map(field => {
        if (field && typeof field.text === 'string') {
          field.text = processUserMentions(field.text);
          field.text = unescapeNewlines(field.text);
        }
        return field;
      });
    }
    
    // Process elements in context blocks
    if (block.type === 'context' && block.elements && Array.isArray(block.elements)) {
      block.elements = block.elements.map(element => {
        if (element && element.type === 'mrkdwn' && typeof element.text === 'string') {
          element.text = processUserMentions(element.text);
          element.text = unescapeNewlines(element.text);
        }
        return element;
      });
    }
    
    return block;
  });
}

/**
 * Process text with BlockBuilder or standard formatting based on content
 * @param {string} text - Message text to format
 * @returns {Promise<Object>} - Formatted message with blocks/attachments
 */
async function formatMessageText(text) {
  if (!text) {
    return { blocks: [] };
  }
  
  // Check if message has block syntax markers
  const hasBlockSyntax = text.includes('#') || text.includes('(usercontext)');
  
  if (hasBlockSyntax) {
    logger.info('Using BlockBuilder format for message');
    return await parseMessage(text);
  } else {
    // Use standard message formatting
    const formatted = formatSlackMessage(text);
    logger.info('Using standard message format');
    return formatted;
  }
}

/**
 * Clean and process an entire message for Slack API
 * @param {Object} messageParams - Message parameters to process
 * @returns {Object} - Processed message parameters
 */
function cleanAndProcessMessage(messageParams) {
  const result = { ...messageParams };
  
  // Always set text to a space to prevent duplication issues
  result.text = " ";
  
  // Clean and process blocks if they exist
  if (result.blocks) {
    result.blocks = cleanForSlackApi(result.blocks);
    result.blocks = processBlocks(result.blocks);
  }
  
  // Clean and process attachments if they exist
  if (result.attachments) {
    result.attachments = cleanForSlackApi(result.attachments);
    
    // Process blocks inside attachments
    result.attachments.forEach(attachment => {
      if (attachment.blocks) {
        attachment.blocks = processBlocks(attachment.blocks);
      }
    });
  }
  
  // Log final structure
  logMessageStructure(result, 'PROCESSED');
  
  return result;
}

/**
 * Gets a color for a message based on the type or purpose
 * @param {string} type - The message type or purpose
 * @returns {string} - Hex color code
 */
function getColorForMessageType(type) {
    // Define standard colors for consistency
    const colors = {
        primary: '#4A154B',    // Primary Slack purple
        success: '#007a5a',    // Green for success messages
        warning: '#daa038',    // Orange/yellow for warnings
        error: '#e01e5a',      // Red for errors
        info: '#1264a3',       // Blue for informational messages
        neutral: '#404040',    // Dark gray for neutral messages
        system: '#8d8d8d',     // Light gray for system messages
        highlight: '#ECB22E'   // Yellow for highlights
    };
    
    // Map message types to colors
    switch (type?.toLowerCase()) {
        case 'error':
            return colors.error;
            
        case 'warning':
            return colors.warning;
            
        case 'success':
            return colors.success;
            
        case 'info': 
        case 'information':
            return colors.info;
            
        case 'highlight':
            return colors.highlight;
            
        case 'system': 
        case 'admin':
            return colors.system;
            
        case 'primary':
        case 'main':
            return colors.primary;
            
        default:
            return colors.primary; // Default to primary color
    }
}

/**
 * Helper to format fields for Slack messages
 * @param {Array} fields - Array of field objects 
 * @returns {Array} - Formatted fields
 */
function formatFields(fields) {
    if (!fields || !Array.isArray(fields)) {
        return [];
    }
    
    // Format each field and flatten
    const formattedFields = [];
    
    for (const field of fields) {
        if (!field || typeof field !== 'object') {
            continue;
        }
        
        // Get title and value with defaults
        const title = field.title || field.name || '';
        const value = field.value || field.text || '';
        const short = field.short === undefined ? true : !!field.short;
        
        // Add the field if it has content
        if (title || value) {
            formattedFields.push({
                type: 'mrkdwn',
                text: `*${title}*\n${value}`
            });
        }
    }
    
    return formattedFields;
}

/**
 * Creates blocks for a message
 * @param {Object} args - Arguments for blocks
 * @returns {Array} - Blocks array
 */
function createMessageBlocks(args) {
    if (!args) return [];
    
    const blocks = [];
    
    // If text is provided, add it as a section
    if (args.text) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: args.text
            }
        });
    }
    
    // If header is provided, add it as a header block at the beginning
    if (args.header) {
        blocks.unshift({
            type: 'header',
            text: {
                type: 'plain_text',
                text: args.header,
                emoji: true
            }
        });
    }
    
    // If fields are provided, add them as a section with fields
    if (args.fields && Array.isArray(args.fields) && args.fields.length > 0) {
        const formattedFields = formatFields(args.fields);
        
        // Add as many field sections as needed (Slack limits fields per section)
        if (formattedFields.length > 0) {
            // Add fields to sections (max 10 per section)
            const maxFieldsPerSection = 10;
            
            for (let i = 0; i < formattedFields.length; i += maxFieldsPerSection) {
                const sectionFields = formattedFields.slice(i, i + maxFieldsPerSection);
                
                blocks.push({
                    type: 'section',
                    fields: sectionFields
                });
            }
        }
    }
    
    // Add a context block if footer is provided
    if (args.footer) {
        blocks.push({
            type: 'context',
            elements: [{
                type: 'mrkdwn',
                text: args.footer
            }]
        });
    }
    
    // Add a divider if requested
    if (args.divider) {
        blocks.push({ type: 'divider' });
    }
    
    // Add image if provided
    if (args.image_url) {
        const imageBlock = {
            type: 'image',
            image_url: args.image_url,
            alt_text: args.alt_text || 'Image'
        };
        
        if (args.image_title) {
            imageBlock.title = {
                type: 'plain_text',
                text: args.image_title
            };
        }
        
        blocks.push(imageBlock);
    }
    
    return blocks;
}

/**
 * Gets channel ID from args or thread context 
 * @param {Object} args - Tool arguments
 * @param {Object} threadContext - Thread context with metadata access
 * @returns {string} - Channel ID
 */
function getChannelId(args, threadContext) {
    // First try to get from args directly
    if (args && args.channel) {
        return args.channel;
    }
    
    // Then try to get from thread context
    if (threadContext) {
        // Check if it's direct property
        if (threadContext.channelId) {
            return threadContext.channelId;
        }
        
        // Check if it's in context metadata
        if (threadContext.getMetadata) {
            const context = threadContext.getMetadata('context');
            if (context && context.channelId) {
                return context.channelId;
            }
        }
    }
    
    // Fallback to empty
    return null;
}

/**
 * Gets thread TS from args or thread context
 * @param {Object} args - Tool arguments
 * @param {Object} threadContext - Thread context with metadata access
 * @returns {string} - Thread TS
 */
function getThreadTs(args, threadContext) {
    // First try to get from args directly
    if (args && args.thread_ts) {
        return args.thread_ts;
    }
    
    // Then try to get from thread context
    if (threadContext) {
        // Check if it's direct property
        if (threadContext.threadTs) {
            return threadContext.threadTs;
        }
        
        // Check if it's in context metadata
        if (threadContext.getMetadata) {
            const context = threadContext.getMetadata('context');
            if (context && context.threadTs) {
                return context.threadTs;
            }
        }
    }
    
    // Fallback to empty
    return null;
}

/**
 * Logs the structure of a message for debugging
 * @param {Object} messageParams - Message parameters
 * @param {string} label - Label for the log entry
 */
function logMessageStructure(messageParams, label = 'MESSAGE') {
  // Delegate to our new logger
  logger.logMessageStructure(messageParams, label);
  return messageParams;
}

/**
 * Merges attachments with the same color into single attachments
 * This reduces the number of vertical colored bars displayed in Slack
 * @param {Array} attachments - Array of Slack message attachments
 * @returns {Array} - New array with merged attachments
 */
function mergeAttachmentsByColor(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length <= 1) {
    return attachments; // Return as is if no merging needed
  }
  
  logger.info(`Merging ${attachments.length} attachments by color`);
  
  // Group attachments by color
  const colorGroups = {};
  
  attachments.forEach(attachment => {
    const color = attachment.color || 'default';
    
    if (!colorGroups[color]) {
      colorGroups[color] = [];
    }
    
    colorGroups[color].push(attachment);
  });
  
  // Create new merged attachments array
  const mergedAttachments = [];
  
  Object.keys(colorGroups).forEach(color => {
    const attachmentsWithSameColor = colorGroups[color];
    
    // If only one attachment with this color, keep as is
    if (attachmentsWithSameColor.length === 1) {
      mergedAttachments.push(attachmentsWithSameColor[0]);
      return;
    }
    
    // Create a single merged attachment for this color
    const mergedAttachment = {
      color: color === 'default' ? null : color,
      blocks: [],
      fallback: attachmentsWithSameColor[0].fallback || 'Message from bot'
    };
    
    // Merge blocks from all attachments with this color
    attachmentsWithSameColor.forEach(attachment => {
      if (attachment.blocks && Array.isArray(attachment.blocks)) {
        mergedAttachment.blocks.push(...attachment.blocks);
      }
    });
    
    mergedAttachments.push(mergedAttachment);
    logger.info(`Merged ${attachmentsWithSameColor.length} attachments with color ${color}`);
  });
  
  logger.info(`After merging: ${mergedAttachments.length} attachments`);
  return mergedAttachments;
}

/**
 * Calculate text similarity ratio between two strings
 * @param {string} str1 - First string to compare
 * @param {string} str2 - Second string to compare
 * @returns {number} Similarity ratio between 0 and 1
 */
function calculateTextSimilarity(str1, str2) {
    if (!str1 && !str2) return 1; // Both empty means identical
    if (!str1 || !str2) return 0; // One empty means completely different
    
    // Quick comparison for exact match cases
    if (str1 === str2) return 1; // Exact match
    
    // If the length difference is significant, they are likely different messages
    const lengthDiff = Math.abs(str1.length - str2.length);
    const longerLength = Math.max(str1.length, str2.length);
    
    // If length difference is more than 30% of the longer string, consider them different
    if (lengthDiff > (longerLength * 0.3)) {
        return 0.5; // Return moderate similarity to allow for some difference
    }
    
    // Normalize strings - only remove excess whitespace, preserve case for better differentiation
    const normalizedStr1 = str1.replace(/\s+/g, ' ').trim();
    const normalizedStr2 = str2.replace(/\s+/g, ' ').trim();
    
    if (normalizedStr1 === normalizedStr2) return 1; // Exact match after normalization
    
    // Check for significant semantic differences by looking for unique keywords
    // Examples: different URLs, code blocks, numbers, or key identifiers
    const uniquePatterns = [
        /https?:\/\/\S+/g,     // URLs
        /```[\s\S]*?```/g,     // Code blocks
        /`[^`]+`/g,            // Inline code
        /\d{3,}/g,             // Numbers with 3+ digits
        /#[a-zA-Z0-9_-]+/g,    // Hashtags or HTML IDs
        /@[a-zA-Z0-9_-]+/g     // Mentions
    ];
    
    for (const pattern of uniquePatterns) {
        const matches1 = normalizedStr1.match(pattern) || [];
        const matches2 = normalizedStr2.match(pattern) || [];
        
        // If the count of these elements differs significantly, they're different messages
        if (Math.abs(matches1.length - matches2.length) > 1) {
            return 0.5; // Consider them moderately similar
        }
        
        // Check if specific elements are different
        for (const match of matches1) {
            if (!matches2.includes(match)) {
                return 0.5; // Different specific elements means different message
            }
        }
    }
    
    // For longer texts, use a more sophisticated comparison
    // Levenshtein distance calculation
    const longer = normalizedStr1.length > normalizedStr2.length ? normalizedStr1 : normalizedStr2;
    const shorter = normalizedStr1.length > normalizedStr2.length ? normalizedStr2 : normalizedStr1;
    
    // If the longer string is empty, similarity is 0
    if (longer.length === 0) return 1.0;
    
    // Calculate edit distance using levenshtein
    const editDistance = levenshteinDistance(longer, shorter);
    
    // Convert edit distance to similarity
    return (longer.length - editDistance) / parseFloat(longer.length);
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string 
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    
    const costs = new Array();
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) {
            costs[s2.length] = lastValue;
        }
    }
    
    return costs[s2.length];
}

module.exports = {
  normalizeColor,
  processBlocks,
  formatMessageText,
  cleanAndProcessMessage,
  getColorForMessageType,
  formatFields,
  createMessageBlocks,
  getChannelId,
  getThreadTs,
  logMessageStructure,
  unescapeNewlines,
  mergeAttachmentsByColor,
  calculateTextSimilarity,
  levenshteinDistance
}; 