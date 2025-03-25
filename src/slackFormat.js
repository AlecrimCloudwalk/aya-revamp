// Handles formatting of messages for Slack

/**
 * Formats a message for Slack with consistent styling
 * 
 * @param {Object} options - Formatting options
 * @param {string} options.title - Message title (optional)
 * @param {string} options.text - Message text content (optional)
 * @param {string} options.color - Message color (optional)
 * @param {Array} options.fields - Message fields (optional)
 * @param {Array} options.actions - Message action buttons (optional)
 * @param {Array} options.sections - Additional sections (optional)
 * @param {Array} options.elements - Rich message elements (optional)
 * @param {Array} options.context - Context elements for showing status text (optional)
 * @returns {Object} - Formatted message with blocks
 */
function formatSlackMessage(options = {}) {
  const blocks = [];
  
  // Extract options with defaults
  const {
    title,
    text,
    subtitle,
    color = '#0078D7',
    fields = [],
    actions = [],
    sections = [],
    elements = [],
    attachments = [],
    context = []
  } = options;
  
  console.log('SLACK FORMAT - Received options:');
  console.log(JSON.stringify({
    hasTitle: !!title,
    titleLength: title?.length,
    hasText: !!text,
    textLength: text?.length,
    hasColor: !!color,
    fieldsCount: fields.length,
    actionsCount: actions.length,
    sectionsCount: sections.length,
    elementsCount: elements.length,
    attachmentsCount: attachments.length
  }, null, 2));
  
  // If we have a title, add it as a header block
  if (title) {
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: title,
        emoji: true
      }
    });
  }
  
  // If we have a subtitle, add it as context
  if (subtitle) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*${subtitle}*`
        }
      ]
    });
  }
  
  // If we have text content, add it as a section block
  if (text) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: text
      }
    });
  }
  
  // Add fields if provided
  if (fields.length > 0) {
    // Split fields into pairs for side-by-side layout
    for (let i = 0; i < fields.length; i += 2) {
      const fieldBlock = {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*${fields[i].title}*\n${fields[i].value}`
          }
        ]
      };
      
      // Add second field if it exists
      if (i + 1 < fields.length) {
        fieldBlock.fields.push({
          type: 'mrkdwn',
          text: `*${fields[i + 1].title}*\n${fields[i + 1].value}`
        });
      }
      
      blocks.push(fieldBlock);
    }
  }
  
  // Add context elements (like "Selected: Option A")
  if (context && context.length > 0) {
    const contextBlock = {
      type: 'context',
      elements: []
    };
    
    // Add each context item
    context.forEach(item => {
      contextBlock.elements.push({
        type: 'mrkdwn',
        text: item.text || item
      });
    });
    
    blocks.push(contextBlock);
  }
  
  // Add any additional sections
  if (sections && sections.length > 0) {
    // Process each section
    for (const section of sections) {
      if (typeof section === 'string') {
        // Simple string section
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: section
          }
        });
      } else if (typeof section === 'object') {
        // Object section, add directly if it has a type
        if (section.type) {
          blocks.push(section);
        }
      }
    }
  }
  
  // Process rich elements (higher level abstractions)
  if (elements && elements.length > 0) {
    for (const element of elements) {
      if (typeof element === 'string') {
        // Simple string is treated as a text section
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: element
          }
        });
      } else if (element.type) {
        // Process based on element type
        switch (element.type) {
          case 'divider':
            blocks.push({ type: 'divider' });
            break;
            
          case 'header':
            blocks.push({
              type: 'header',
              text: {
                type: 'plain_text',
                text: element.text,
                emoji: true
              }
            });
            break;
            
          case 'context':
            blocks.push({
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: element.text
                }
              ]
            });
            break;
            
          case 'bullet_list':
            if (element.items && Array.isArray(element.items)) {
              const bulletItems = element.items.map(item => `• ${item}`).join('\n');
              blocks.push({
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: bulletItems
                }
              });
            }
            break;
            
          case 'numbered_list':
            if (element.items && Array.isArray(element.items)) {
              const numberedItems = element.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
              blocks.push({
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: numberedItems
                }
              });
            }
            break;
            
          case 'quote':
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `>${element.text.replace(/\n/g, '\n>')}`
              }
            });
            break;
            
          case 'image':
            blocks.push({
              type: 'image',
              image_url: element.url,
              alt_text: element.alt || 'Image',
              title: element.title ? {
                type: 'plain_text',
                text: element.title,
                emoji: true
              } : undefined
            });
            break;
            
          case 'code':
            // Format code block with triple backticks
            blocks.push({
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `\`\`\`${element.language || ''}\n${element.code}\n\`\`\``
              }
            });
            break;
            
          default:
            // For any other type, add directly as a block
            if (isValidBlock(element)) {
              blocks.push(element);
            }
        }
      }
    }
  }
  
  // Add action buttons if provided
  if (actions && actions.length > 0) {
    blocks.push({
      type: 'actions',
      elements: actions.map((action, index) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: action.text,
          emoji: true
        },
        value: action.value || `value_${index}`,
        action_id: action.action_id || `action_${index}`
      }))
    });
  }
  
  // Add a divider at the end (optional but provides visual separation)
  if (blocks.length > 0) {
    blocks.push({
      type: 'divider'
    });
  }

  // Process any pre-existing attachments the user has provided
  const formattedAttachments = [...attachments];
  
  // IMPORTANT: Always use attachments with color to ensure vertical color bar
  // If blocks exist, add them to an attachment to ensure the color bar is shown
  if (blocks.length > 0) {
    // Create a primary attachment with the color
    const primaryAttachment = {
      color: color,
      blocks: blocks
    };
    
    // Add a fallback text for the attachment (required by Slack)
    primaryAttachment.fallback = title || text || "Message from the bot";
    
    // If there was existing text, add it to the attachment
    if (text) {
      primaryAttachment.text = text;
    }
    
    // Add the primary attachment
    formattedAttachments.unshift(primaryAttachment);
    
    // Since we're moving the blocks to the attachment, clear the blocks array
    blocks.length = 0;
  } else if (formattedAttachments.length === 0) {
    // No blocks or attachments were provided, create a minimal attachment to show the color bar
    formattedAttachments.push({
      color: color,
      text: text || "",
      fallback: title || text || "Message from the bot"
    });
  } else {
    // Ensure all attachments have a color
    formattedAttachments.forEach(attachment => {
      if (!attachment.color) {
        attachment.color = color;
      }
    });
  }
  
  // Build the final message
  const message = {
    blocks,
    attachments: formattedAttachments,
    text: " "  // Use a space character instead of duplicating content
  };
  
  console.log('SLACK FORMAT - Final message structure:');
  console.log(JSON.stringify({
    hasText: !!message.text,
    textLength: message.text?.length,
    hasBlocks: message.blocks?.length > 0,
    blockCount: message.blocks?.length || 0,
    hasAttachments: message.attachments?.length > 0,
    attachmentCount: message.attachments?.length || 0
  }, null, 2));
  
  return message;
}

/**
 * Checks if an object is a valid Slack block
 * 
 * @param {Object} block - The block to validate
 * @returns {boolean} - Whether the block appears valid
 */
function isValidBlock(block) {
  const validBlockTypes = [
    'section', 'divider', 'image', 'actions', 
    'context', 'header', 'input'
  ];
  
  return block && block.type && validBlockTypes.includes(block.type);
}

/**
 * Builds buttons for a Slack message
 * 
 * @param {Array} options - Button options
 * @returns {Array} - Formatted button elements
 */
function buildButtons(options) {
  if (!Array.isArray(options)) {
    return [];
  }
  
  return options.map(option => {
    // Handle string options
    if (typeof option === 'string') {
      return {
        type: 'button',
        text: {
          type: 'plain_text',
          text: option,
          emoji: true
        },
        value: option
      };
    }
    
    // Handle object options
    return {
      type: 'button',
      text: {
        type: 'plain_text',
        text: option.text || 'Button',
        emoji: true
      },
      value: option.value || option.text || 'button_value',
      action_id: option.action_id,
      style: option.style
    };
  });
}

/**
 * Creates a message section
 * 
 * @param {string} text - Section text
 * @returns {Object} - Formatted section
 */
function createSection(text) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text
    }
  };
}

/**
 * Creates a message header
 * 
 * @param {string} text - Header text
 * @returns {Object} - Formatted header
 */
function createHeader(text) {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text,
      emoji: true
    }
  };
}

/**
 * Creates a divider element
 * 
 * @returns {Object} - Divider block
 */
function createDivider() {
  return { type: 'divider' };
}

/**
 * Creates a context element
 * 
 * @param {string} text - Context text
 * @returns {Object} - Formatted context block
 */
function createContext(text) {
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text
      }
    ]
  };
}

module.exports = {
  formatSlackMessage,
  buildButtons,
  createSection,
  createHeader,
  createDivider,
  createContext
}; 