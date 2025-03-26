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
 * @param {Array} options.elements - Rich message elements (optional)
 * @param {Array} options.context - Context elements for showing status text (optional)
 * @param {Object} options.richHeader - Enhanced header with icon/emoji (optional)
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
    elements = [],
    attachments = [],
    context = [],
    richHeader = null
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
    elementsCount: elements.length,
    attachmentsCount: attachments.length,
    hasRichHeader: !!richHeader
  }, null, 2));
  
  // If we have a richHeader, add it with icon/emoji
  if (richHeader) {
    blocks.push(createRichHeader(richHeader));
  }
  // If we have a regular title, add it as a header block
  else if (title) {
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
            
          // New element types
          case 'table':
            blocks.push(...createTableBlocks(element));
            break;
            
          case 'column':
            blocks.push(...createColumnBlocks(element));
            break;
            
          case 'accordion':
            blocks.push(...createAccordionBlocks(element));
            break;
            
          case 'timeline':
            blocks.push(...createTimelineBlocks(element));
            break;
            
          case 'info':
            blocks.push(createInfoBlock(element));
            break;
            
          case 'warning':
            blocks.push(createAlertBlock(element, 'warning'));
            break;
            
          case 'error':
            blocks.push(createAlertBlock(element, 'error'));
            break;
            
          case 'success':
            blocks.push(createAlertBlock(element, 'success'));
            break;
        }
      }
    }
  }
  
  // Add action buttons if provided
  if (actions && actions.length > 0) {
    const buttonElements = buildButtons(actions);
    
    // Only add if we have valid buttons
    if (buttonElements.length > 0) {
      blocks.push({
        type: 'actions',
        elements: buttonElements
      });
    }
  }
  
  // Prepare attachment array for response
  let formattedAttachments = [...attachments];
  
  // Create a primary attachment with color if we have any content above
  if (color && (title || text || fields.length > 0)) {
    const primaryAttachment = {
      color,
      fallback: title || text || 'Message from bot',
    };
    
    // If we have blocks, attach them to this attachment
    if (blocks.length > 0) {
      primaryAttachment.blocks = blocks;
    }
    
    // Add to beginning of attachments
    formattedAttachments.unshift(primaryAttachment);
  } else if (formattedAttachments.length === 0) {
    // If no color but we have blocks, create an attachment without color
    formattedAttachments.push({
      blocks: blocks,
      fallback: title || text || 'Message from bot'
    });
  }
  
  // Ensure all attachments have color if not specified
  formattedAttachments.forEach(attachment => {
    if (!attachment.color) {
      attachment.color = color || '#0078D7';
    }
  });
  
  // Prepare response message structure
  const response = {
    blocks: [], // Usually empty, blocks go into attachments
    attachments: formattedAttachments,
    text: title || text || '' // Fallback for notifications/previews
  };
  
  console.log('SLACK FORMAT - Final message structure:');
  console.log(JSON.stringify({
    hasBlocks: response.blocks.length > 0,
    blockCount: response.blocks.length,
    hasAttachments: response.attachments.length > 0,
    attachmentCount: response.attachments.length,
    hasText: !!response.text
  }, null, 2));
  
  return response;
}

/**
 * Checks if a given block structure is valid
 * @param {Object} block - The block to validate
 * @returns {boolean} - True if valid, false otherwise
 */
function isValidBlock(block) {
  return block && typeof block === 'object' && block.type;
}

/**
 * Builds button elements for an actions block
 * @param {Array} options - Array of button configurations
 * @returns {Array} - Formatted button elements
 */
function buildButtons(options) {
  if (!options || !Array.isArray(options) || options.length === 0) {
    return [];
  }
  
  // Map button configs to Slack button elements
  return options
    .filter(option => option && (option.text || option.value))
    .map(option => {
      // Create button element
      const buttonElement = {
        type: 'button',
        text: {
          type: 'plain_text',
          text: option.text || option.value || 'Button',
          emoji: true
        },
        value: option.value || option.text || 'button_value'
      };
      
      // Add style if specified
      if (option.style) {
        buttonElement.style = option.style === 'primary' ? 'primary' : 
                              option.style === 'danger' ? 'danger' : undefined;
      }
      
      // Add URL for link buttons
      if (option.url) {
        buttonElement.url = option.url;
      }
      
      // Add confirm dialog if configured
      if (option.confirm) {
        buttonElement.confirm = {
          title: {
            type: 'plain_text',
            text: option.confirm.title || 'Are you sure?'
          },
          text: {
            type: 'mrkdwn',
            text: option.confirm.text || 'This cannot be undone.'
          },
          confirm: {
            type: 'plain_text',
            text: option.confirm.ok || 'Confirm'
          },
          deny: {
            type: 'plain_text',
            text: option.confirm.cancel || 'Cancel'
          }
        };
      }
      
      return buttonElement;
    });
}

/**
 * Creates a section block with text
 * @param {string} text - The text to include in the section
 * @returns {Object} - Formatted section
 */
function createSection(text) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: text
    }
  };
}

/**
 * Creates a header block
 * @param {string} text - The text to include in the header
 * @returns {Object} - Formatted header
 */
function createHeader(text) {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text: text,
      emoji: true
    }
  };
}

/**
 * Creates a divider block
 * @returns {Object} - Formatted divider
 */
function createDivider() {
  return { type: 'divider' };
}

/**
 * Creates a context block for small text
 * @param {string} text - The text to include in the context
 * @returns {Object} - Formatted context block
 */
function createContext(text) {
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: text
      }
    ]
  };
}

/**
 * Creates a rich header with icon or emoji
 * @param {Object} options - Header options
 * @param {string} options.text - Header text
 * @param {string} options.emoji - Emoji to show (e.g., ":rocket:")
 * @param {string} options.icon - Icon URL to show
 * @returns {Object} - Rich header block
 */
function createRichHeader(options) {
  const headerBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${options.text}*`
    }
  };
  
  // Add accessory for icon or emoji
  if (options.emoji) {
    headerBlock.accessory = {
      type: 'plain_text',
      text: options.emoji,
      emoji: true
    };
  } else if (options.icon) {
    headerBlock.accessory = {
      type: 'image',
      image_url: options.icon,
      alt_text: 'Icon'
    };
  }
  
  return headerBlock;
}

/**
 * Creates a table from data
 * @param {Object} tableData - Table configuration
 * @param {Array} tableData.headers - Table header row
 * @param {Array} tableData.rows - Table data rows
 * @returns {Array} - Array of blocks representing a table
 */
function createTableBlocks(tableData) {
  const blocks = [];
  
  // Handle both formats (direct table object or element with table data)
  const headers = tableData.headers || (tableData.table ? tableData.table.headers : []);
  const rows = tableData.rows || (tableData.table ? tableData.table.rows : []);
  
  if (!headers || !rows || !Array.isArray(headers) || !Array.isArray(rows)) {
    return [createSection('Invalid table data')];
  }
  
  // Add table header
  const headerRow = headers.map(header => `*${header}*`).join(' | ');
  blocks.push(createSection(headerRow));
  
  // Add divider
  blocks.push(createDivider());
  
  // Add data rows
  rows.forEach(row => {
    if (Array.isArray(row)) {
      const rowText = row.join(' | ');
      blocks.push(createSection(rowText));
    }
  });
  
  return blocks;
}

/**
 * Creates a multi-column layout
 * @param {Object} columnData - Column configuration
 * @param {Array} columnData.columns - Column contents
 * @returns {Array} - Array of blocks representing columns
 */
function createColumnBlocks(columnData) {
  const blocks = [];
  
  // Handle both formats
  const columns = columnData.columns || [];
  
  if (!columns || !Array.isArray(columns) || columns.length === 0) {
    return [createSection('Invalid column data')];
  }
  
  // Create a section with fields for the columns
  const sectionBlock = {
    type: 'section',
    fields: []
  };
  
  // Add each column as a field
  columns.forEach(column => {
    sectionBlock.fields.push({
      type: 'mrkdwn',
      text: typeof column === 'string' ? column : column.text || ''
    });
  });
  
  blocks.push(sectionBlock);
  return blocks;
}

/**
 * Creates an accordion-like expandable section
 * @param {Object} accordionData - Accordion configuration
 * @param {Array} accordionData.sections - Accordion sections
 * @returns {Array} - Array of blocks representing an accordion
 */
function createAccordionBlocks(accordionData) {
  const blocks = [];
  
  // Handle both formats
  const sections = accordionData.sections || [];
  
  if (!sections || !Array.isArray(sections) || sections.length === 0) {
    return [createSection('Invalid accordion data')];
  }
  
  // Add each accordion section
  sections.forEach((section, index) => {
    // Add section title
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*▼ ${section.title || `Section ${index + 1}`}*`
      }
    });
    
    // Add section content
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: section.content || ''
      }
    });
    
    // Add divider except for last section
    if (index < sections.length - 1) {
      blocks.push(createDivider());
    }
  });
  
  return blocks;
}

/**
 * Creates a timeline or step indicator
 * @param {Object} timelineData - Timeline configuration
 * @param {Array} timelineData.steps - Timeline steps
 * @returns {Array} - Array of blocks representing a timeline
 */
function createTimelineBlocks(timelineData) {
  const blocks = [];
  
  // Handle both formats
  const steps = timelineData.steps || [];
  
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return [createSection('Invalid timeline data')];
  }
  
  // Create timeline visualization
  const timelineText = steps.map((step, index) => {
    const stepNumber = index + 1;
    const status = step.status || 'pending';
    
    let indicator;
    if (status === 'completed') {
      indicator = '✅';
    } else if (status === 'current') {
      indicator = '🔷';
    } else if (status === 'error') {
      indicator = '❌';
    } else {
      indicator = '⚪';
    }
    
    return `${indicator} *Step ${stepNumber}:* ${step.title || `Step ${stepNumber}`}\n${step.description || ''}`;
  }).join('\n\n');
  
  blocks.push(createSection(timelineText));
  return blocks;
}

/**
 * Creates an info block with special formatting
 * @param {Object} infoData - Info block data
 * @returns {Object} - Formatted info block
 */
function createInfoBlock(infoData) {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `ℹ️ *${infoData.title || 'Information'}*\n${infoData.text || ''}`
    }
  };
}

/**
 * Creates an alert block (warning, error, success)
 * @param {Object} alertData - Alert data
 * @param {string} alertType - Type of alert (warning, error, success)
 * @returns {Object} - Formatted alert block
 */
function createAlertBlock(alertData, alertType = 'warning') {
  let icon = '⚠️';
  if (alertType === 'error') icon = '🚫';
  if (alertType === 'success') icon = '✅';
  
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${icon} *${alertData.title || alertType.toUpperCase()}*\n${alertData.text || ''}`
    }
  };
}

/**
 * Converts an array of simplified block definitions to proper Block Kit format
 * 
 * @param {Array} simpleBlocks - Array of simplified block definitions
 * @returns {Array} - Array of properly formatted Block Kit blocks
 */
function convertSimpleBlocks(simpleBlocks) {
  if (!simpleBlocks || !Array.isArray(simpleBlocks)) {
    return [];
  }
  
  const blockKitBlocks = [];
  
  for (const block of simpleBlocks) {
    let blockKitBlock = null;
    
    if (typeof block === 'string') {
      // If block is just a string, treat it as a section with text
      blockKitBlock = createSection(block);
    } else if (block && typeof block === 'object') {
      // Process based on block type
      switch (block.type) {
        case 'section':
          blockKitBlock = createSectionBlock(block);
          break;
          
        case 'divider':
          blockKitBlock = createDivider();
          break;
          
        case 'context':
          blockKitBlock = createContextBlock(block);
          break;
          
        case 'actions':
          blockKitBlock = createActionsBlock(block);
          break;
          
        case 'header':
          blockKitBlock = createHeaderBlock(block);
          break;
          
        case 'image':
          blockKitBlock = createImageBlock(block);
          break;
          
        default:
          // For unknown types, try to use it directly if it has a type property
          if (block.type) {
            blockKitBlock = block;
          }
      }
    }
    
    if (blockKitBlock) {
      blockKitBlocks.push(blockKitBlock);
    }
  }
  
  return blockKitBlocks;
}

/**
 * Creates a section block with text and optional fields/accessory
 * 
 * @param {Object} block - Section block configuration
 * @param {string} block.text - Text for the section
 * @param {Array} block.fields - Optional fields for the section
 * @param {Object} block.accessory - Optional accessory for the section
 * @returns {Object} - Formatted section block
 */
function createSectionBlock(block) {
  const sectionBlock = {
    type: 'section'
  };
  
  // Handle text
  if (block.text) {
    sectionBlock.text = {
      type: block.text_type || 'mrkdwn',
      text: block.text
    };
  }
  
  // Handle fields
  if (block.fields && Array.isArray(block.fields)) {
    sectionBlock.fields = block.fields.map(field => {
      if (typeof field === 'string') {
        return {
          type: 'mrkdwn',
          text: field
        };
      } else if (field && typeof field === 'object') {
        return {
          type: field.type || 'mrkdwn',
          text: field.text || '',
          emoji: field.type === 'plain_text' ? true : undefined
        };
      }
      return null;
    }).filter(Boolean);
  }
  
  // Handle accessory
  if (block.accessory && typeof block.accessory === 'object') {
    sectionBlock.accessory = block.accessory;
  }
  
  return sectionBlock;
}

/**
 * Creates a context block with elements
 * 
 * @param {Object} block - Context block configuration
 * @param {Array} block.elements - Elements for the context block
 * @returns {Object} - Formatted context block
 */
function createContextBlock(block) {
  const contextBlock = {
    type: 'context',
    elements: []
  };
  
  // Handle elements
  if (block.elements && Array.isArray(block.elements)) {
    contextBlock.elements = block.elements.map(element => {
      if (typeof element === 'string') {
        return {
          type: 'mrkdwn',
          text: element
        };
      } else if (element && typeof element === 'object') {
        if (element.type === 'image') {
          return {
            type: 'image',
            image_url: element.image_url || element.url,
            alt_text: element.alt_text || 'Image'
          };
        } else {
          return {
            type: element.type || 'mrkdwn',
            text: element.text || '',
            emoji: element.type === 'plain_text' ? true : undefined
          };
        }
      }
      return null;
    }).filter(Boolean);
  } else if (block.text) {
    // Simplified case - just a text string
    contextBlock.elements = [
      {
        type: 'mrkdwn',
        text: block.text
      }
    ];
  }
  
  return contextBlock;
}

/**
 * Creates an actions block with interactive elements
 * 
 * @param {Object} block - Actions block configuration
 * @param {Array} block.elements - Elements for the actions block
 * @returns {Object} - Formatted actions block
 */
function createActionsBlock(block) {
  const actionsBlock = {
    type: 'actions',
    elements: []
  };
  
  // Add block_id if provided
  if (block.block_id) {
    actionsBlock.block_id = block.block_id;
  }
  
  // Handle elements
  if (block.elements && Array.isArray(block.elements)) {
    actionsBlock.elements = block.elements.map(element => {
      if (!element || typeof element !== 'object') {
        return null;
      }
      
      // Process specific element types
      switch (element.type) {
        case 'button':
          return createButtonElement(element);
        case 'datepicker':
          return createDatepickerElement(element);
        case 'overflow':
          return createOverflowElement(element);
        case 'select':
        case 'static_select':
          return createSelectElement(element);
        default:
          // For other types, use directly if it has a type property
          return element.type ? element : null;
      }
    }).filter(Boolean);
  }
  
  return actionsBlock;
}

/**
 * Creates a button element for actions block
 * 
 * @param {Object} element - Button element configuration
 * @returns {Object} - Formatted button element
 */
function createButtonElement(element) {
  const buttonElement = {
    type: 'button',
    text: {
      type: 'plain_text',
      text: element.text || 'Button',
      emoji: true
    }
  };
  
  // Add optional properties
  if (element.action_id) {
    buttonElement.action_id = element.action_id;
  }
  
  if (element.value) {
    buttonElement.value = element.value;
  }
  
  if (element.url) {
    buttonElement.url = element.url;
  }
  
  if (element.style && ['primary', 'danger'].includes(element.style)) {
    buttonElement.style = element.style;
  }
  
  return buttonElement;
}

/**
 * Creates a datepicker element for actions block
 * 
 * @param {Object} element - Datepicker element configuration
 * @returns {Object} - Formatted datepicker element
 */
function createDatepickerElement(element) {
  const datepickerElement = {
    type: 'datepicker',
    action_id: element.action_id || 'datepicker_action'
  };
  
  // Add optional properties
  if (element.initial_date) {
    datepickerElement.initial_date = element.initial_date;
  }
  
  if (element.placeholder) {
    datepickerElement.placeholder = {
      type: 'plain_text',
      text: typeof element.placeholder === 'string' ? element.placeholder : 'Select a date',
      emoji: true
    };
  }
  
  return datepickerElement;
}

/**
 * Creates an overflow menu element for actions block
 * 
 * @param {Object} element - Overflow element configuration
 * @returns {Object} - Formatted overflow element
 */
function createOverflowElement(element) {
  const overflowElement = {
    type: 'overflow',
    action_id: element.action_id || 'overflow_action'
  };
  
  // Add options
  if (element.options && Array.isArray(element.options)) {
    overflowElement.options = element.options.map(option => {
      return {
        text: {
          type: 'plain_text',
          text: option.text || '',
          emoji: true
        },
        value: option.value || option.text || ''
      };
    });
  }
  
  return overflowElement;
}

/**
 * Creates a select menu element for actions block
 * 
 * @param {Object} element - Select element configuration
 * @returns {Object} - Formatted select element
 */
function createSelectElement(element) {
  const selectElement = {
    type: 'static_select',
    action_id: element.action_id || 'select_action'
  };
  
  // Add placeholder
  if (element.placeholder) {
    selectElement.placeholder = {
      type: 'plain_text',
      text: typeof element.placeholder === 'string' ? element.placeholder : 'Select an option',
      emoji: true
    };
  }
  
  // Add options
  if (element.options && Array.isArray(element.options)) {
    selectElement.options = element.options.map(option => {
      return {
        text: {
          type: 'plain_text',
          text: option.text || '',
          emoji: true
        },
        value: option.value || option.text || ''
      };
    });
  }
  
  return selectElement;
}

/**
 * Creates a header block
 * 
 * @param {Object} block - Header block configuration
 * @param {string} block.text - Text for the header
 * @returns {Object} - Formatted header block
 */
function createHeaderBlock(block) {
  return {
    type: 'header',
    text: {
      type: 'plain_text',
      text: block.text || '',
      emoji: true
    }
  };
}

/**
 * Creates an image block
 * 
 * @param {Object} block - Image block configuration
 * @param {string} block.image_url - URL of the image
 * @param {string} block.alt_text - Alt text for the image
 * @returns {Object} - Formatted image block
 */
function createImageBlock(block) {
  const imageBlock = {
    type: 'image',
    image_url: block.image_url || block.url,
    alt_text: block.alt_text || 'Image'
  };
  
  // Add title if provided
  if (block.title) {
    imageBlock.title = {
      type: 'plain_text',
      text: block.title,
      emoji: true
    };
  }
  
  return imageBlock;
}

module.exports = {
  formatSlackMessage,
  createSection,
  createHeader,
  createDivider,
  createContext,
  createRichHeader,
  createTableBlocks,
  createColumnBlocks,
  createAccordionBlocks,
  createTimelineBlocks,
  createInfoBlock,
  createAlertBlock,
  convertSimpleBlocks,
  createSectionBlock,
  createContextBlock,
  createActionsBlock,
  createHeaderBlock,
  createImageBlock
}; 