// Utilities for formatting Slack messages with consistent styling

/**
 * Creates a Slack message with blocks format
 * @param {Object} params - Message parameters
 * @param {string} params.title - Main title text
 * @param {string} [params.subtitle] - Optional subtitle text
 * @param {string} [params.text] - Main message text (markdown supported)
 * @param {string} [params.color] - Color for the message (hex code or named color)
 * @param {Array} [params.fields] - Optional array of field objects {title, value, short}
 * @param {Array} [params.actions] - Optional array of action buttons
 * @param {Array} [params.blocks] - Optional custom blocks to append to the message
 * @returns {Object} - Formatted Slack message object with blocks
 */
function formatSlackMessage({ 
  title, 
  subtitle, 
  text, 
  color = '#0078D7', 
  fields = [],
  actions = [],
  blocks = [] 
}) {
  // Default blocks with a header
  const messageBlocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: title,
        emoji: true
      }
    }
  ];

  // Add subtitle if provided
  if (subtitle) {
    messageBlocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: subtitle
        }
      ]
    });
  }

  // Add divider
  messageBlocks.push({
    type: 'divider'
  });

  // Add main text section if provided
  if (text) {
    messageBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: text
      }
    });
  }

  // Add fields if provided
  if (fields.length > 0) {
    // Group fields in sections of 2 for better layout
    for (let i = 0; i < fields.length; i += 2) {
      const fieldGroup = fields.slice(i, i + 2).map(field => ({
        type: 'mrkdwn',
        text: `*${field.title}*\n${field.value}`
      }));

      messageBlocks.push({
        type: 'section',
        fields: fieldGroup
      });
    }
  }

  // Add action buttons if provided
  if (actions.length > 0) {
    const actionElements = actions.map(action => ({
      type: 'button',
      text: {
        type: 'plain_text',
        text: action.text,
        emoji: true
      },
      value: action.value,
      action_id: action.action_id
    }));

    messageBlocks.push({
      type: 'actions',
      elements: actionElements
    });
  }

  // Add any custom blocks
  if (blocks.length > 0) {
    messageBlocks.push(...blocks);
  }

  // Return the formatted message
  return {
    blocks: messageBlocks,
    // For legacy clients and notifications
    text: title + (subtitle ? ` - ${subtitle}` : ''),
    // For attachment style, if desired
    attachments: [
      {
        color,
        blocks: messageBlocks
      }
    ]
  };
}

/**
 * Creates a Slack message with simple attachment
 * @param {Object} params - Message parameters
 * @param {string} params.title - Message title
 * @param {string} [params.text] - Message text (markdown supported)
 * @param {string} [params.color] - Attachment color
 * @returns {Object} - Formatted Slack message with attachment
 */
function formatSimpleAttachment({ title, text, color = '#0078D7' }) {
  return {
    text: title,
    attachments: [
      {
        color,
        text: text || ''
      }
    ]
  };
}

/**
 * Creates a message for error scenarios
 * @param {string} title - Error title
 * @param {string} errorMessage - Error details
 * @param {string} [suggestion] - Optional suggested actions
 * @returns {Object} - Formatted error message
 */
function formatErrorMessage({ title, errorMessage, suggestion }) {
  return formatSlackMessage({
    title: `❌ ${title}`,
    text: errorMessage + (suggestion ? `\n\n_Suggestion: ${suggestion}_` : ''),
    color: '#E81123'
  });
}

module.exports = {
  formatSlackMessage,
  formatSimpleAttachment,
  formatErrorMessage
}; 