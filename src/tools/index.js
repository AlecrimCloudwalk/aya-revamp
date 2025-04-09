// Tool Registry - Maintains metadata about all available tools

// Import all tools
const { postMessage } = require('./postMessage.js');
const { finishRequest } = require('./finishRequest.js');
const getThreadHistoryTool = require('./getThreadHistory.js');
const { updateMessage } = require('./updateMessage.js');
const { createEmojiVote, getVoteResults } = require('./createEmojiVote.js');
const getUserAvatar = require('./getUserAvatar.js');
const { addReaction, availableEmojis } = require('./addReaction.js');
const { removeReaction } = require('./removeReaction.js');

/**
 * Check if a parameter schema can support strict mode
 * For strict mode, we need additionalProperties: false and all properties in required
 * @param {Object} parameters Schema object
 * @returns {boolean} Whether strict mode can be enabled
 */
function canUseStrictMode(parameters) {
  if (!parameters || parameters.type !== 'object' || !parameters.properties) {
    return false;
  }
  
  // Check if additionalProperties is already false
  const hasAdditionalPropsFalse = parameters.additionalProperties === false;
  
  // Check if all properties are in required array or if they support null values
  const allPropertiesHandled = parameters.required && 
    Object.keys(parameters.properties).every(prop => {
      const isRequired = parameters.required.includes(prop);
      const supportsNull = parameters.properties[prop].type && 
        (Array.isArray(parameters.properties[prop].type) && 
         parameters.properties[prop].type.includes('null'));
      
      return isRequired || supportsNull;
    });
  
  return hasAdditionalPropsFalse && allPropertiesHandled;
}

// Tool registry with metadata - Using modern OpenAI function format
const toolRegistry = {
  postMessage: {
    type: "function",
    function: {
      name: 'postMessage',
      description: 'Posts a message to Slack with rich formatting options. Always use this tool for all user responses. Use special block syntax within the text parameter for formatting.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Main message content with special formatting syntax. Use these block formats:\n#header: Title text\n#section: Regular text content\n#context: Smaller helper text\n#divider: (adds a line separator)\n#image: URL | altText:Description\n#contextWithImages: Text | images:[URL1|Alt text 1, URL2|Alt text 2]\n#userContext: <@USER_ID> <@USER_ID2> | description text\n#buttons: [Button 1|value1|primary, Button 2|value2|danger]\n#fields: [*Title 1*|Value 1, *Title 2*|Value 2]'
          },
          color: {
            type: 'string',
            description: 'Color for the message sidebar (optional, use hex code like #842BFF or named colors: good=green, warning=yellow, danger=red)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you are sending this message'
          }
        },
        required: ['text', 'reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    // Keep implementation reference for executing the tool
    implementation: postMessage
  },
  finishRequest: {
    type: "function",
    function: {
      name: 'finishRequest',
      description: 'Signals the end of processing for a user request',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Optional summary of the completed task or final thoughts'
          },
          clearCache: {
            type: 'boolean',
            description: 'Whether to clear the thread history cache for this thread (default: false)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why the conversation is being ended'
          }
        },
        required: []
      },
      strict: true
    },
    implementation: finishRequest
  },
  getThreadHistory: {
    type: "function",
    function: {
      name: 'getThreadHistory',
      description: 'Retrieves the conversation history from the current thread. Results are cached for 30 seconds to prevent redundant API calls.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'integer',
            description: 'Maximum number of messages to retrieve (default: 20)'
          },
          includeParent: {
            type: 'boolean',
            description: 'Whether to include the parent message (first message) in the thread (default: true)'
          },
          order: {
            type: 'string',
            description: 'Message ordering: "chronological" (oldest first) or "reverse_chronological" (newest first). Default is "chronological".',
            enum: ['chronological', 'reverse_chronological']
          },
          forceRefresh: {
            type: 'boolean',
            description: 'Force a refresh of thread history, ignoring cached results (default: false)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why thread history is needed'
          }
        },
        required: []
      },
      strict: true
    },
    implementation: getThreadHistoryTool
  },
  updateMessage: {
    type: "function",
    function: {
      name: 'updateMessage',
      description: 'Updates an existing message in Slack',
      parameters: {
        type: 'object',
        properties: {
          messageTs: {
            type: 'string',
            description: 'Timestamp of the message to update'
          },
          text: {
            type: 'string',
            description: 'New text content for the message with special formatting syntax. Use these block formats:\n#header: Title text\n#section: Regular text content\n#context: Smaller helper text\n#divider: (adds a line separator)\n#image: URL | altText:Description\n#contextWithImages: Text | images:[URL1|Alt text 1, URL2|Alt text 2]\n#userContext: <@USER_ID> <@USER_ID2> | description text\n#buttons: [Button 1|value1|primary, Button 2|value2|danger]\n#fields: [*Title 1*|Value 1, *Title 2*|Value 2]'
          },
          color: {
            type: 'string',
            description: 'Color for the message sidebar (optional, use hex code like #842BFF or named colors: good=green, warning=yellow, danger=red)'
          },
          removeButtons: {
            type: 'boolean',
            description: 'Whether to remove all buttons (optional)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you are updating this message'
          }
        },
        required: ['messageTs', 'text', 'reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: updateMessage
  },
  createEmojiVote: {
    type: "function",
    function: {
      name: 'createEmojiVote',
      description: 'Creates a message with emoji voting options',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Vote description/question with #header: for title'
          },
          options: {
            type: 'array',
            description: 'Array of emoji voting options with text and emoji properties',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                emoji: { type: 'string' }
              },
              required: ['text', 'emoji']
            }
          },
          color: {
            type: 'string',
            description: 'Color of the message sidebar (use hex code like #842BFF or named colors: good=green, warning=yellow, danger=red)'
          },
          threadTs: {
            type: 'string',
            description: 'Thread timestamp to reply in (optional)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you are creating this emoji vote'
          }
        },
        required: ['text', 'options', 'color', 'reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: createEmojiVote
  },
  getVoteResults: {
    type: "function",
    function: {
      name: 'getVoteResults',
      description: 'Gets the current results for an emoji vote',
      parameters: {
        type: 'object',
        properties: {
          voteId: {
            type: 'string',
            description: 'ID of the vote to get results for (optional if messageTs provided)'
          },
          messageTs: {
            type: 'string',
            description: 'Timestamp of the vote message (optional if voteId provided)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you are requesting vote results'
          }
        },
        required: ['reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: getVoteResults
  },
  getUserAvatar: {
    type: "function",
    function: {
      name: 'getUserAvatar',
      description: 'Gets a user\'s avatar URL from their Slack user ID',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'The Slack user ID to get avatar for (required)'
          },
          size: {
            type: 'string',
            description: 'Size of the avatar to return (24, 32, 48, 72, 192, 512, 1024, or "original", default: 192)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you need this user\'s avatar'
          }
        },
        required: ['userId', 'reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: getUserAvatar
  },
  addReaction: {
    type: "function",
    function: {
      name: 'addReaction',
      description: 'Adds an emoji reaction to a message',
      parameters: {
        type: 'object',
        properties: {
          emoji: {
            type: ['string', 'array'],
            description: 'Emoji name to add as reaction (without colons, e.g. "thumbsup") or array of emoji names',
            items: {
              type: 'string'
            }
          },
          messageTs: {
            type: 'string',
            description: 'Timestamp of the message to react to (optional)'
          },
          message_ts: {
            type: 'string',
            description: 'Alternative parameter name for messageTs (optional)'
          },
          message_id: {
            type: 'string',
            description: 'ID of the message to react to from the context (optional)'
          },
          channel_id: {
            type: 'string',
            description: 'Channel ID where the message is located (optional, will use current channel if not specified)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you are adding this reaction'
          }
        },
        required: ['emoji', 'reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: addReaction
  },
  removeReaction: {
    type: "function",
    function: {
      name: 'removeReaction',
      description: 'Removes an emoji reaction from a message',
      parameters: {
        type: 'object',
        properties: {
          emoji: {
            type: ['string', 'array'],
            description: 'Emoji name to remove (without colons, e.g. "thumbsup") or array of emoji names',
            items: {
              type: 'string'
            }
          },
          messageTs: {
            type: 'string',
            description: 'Timestamp of the message to remove reaction from (optional)'
          },
          message_ts: {
            type: 'string',
            description: 'Alternative parameter name for messageTs (optional)'
          },
          message_id: {
            type: 'string',
            description: 'ID of the message to remove reaction from (optional)'
          },
          channel_id: {
            type: 'string',
            description: 'Channel ID where the message is located (optional, will use current channel if not specified)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why you are removing this reaction'
          }
        },
        required: ['emoji', 'reasoning'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: removeReaction
  }
};

// For backwards compatibility, maintain these object structures
Object.keys(toolRegistry).forEach(key => {
  // Add legacy properties to each tool for backwards compatibility with existing code
  const tool = toolRegistry[key];
  tool.name = tool.function.name;
  tool.description = tool.function.description;
  tool.parameters = tool.function.parameters;
  tool.function = tool.implementation;
});

/**
 * Gets a tool by name
 * @param {string} name 
 * @returns {Function} - The tool function
 */
function getTool(name) {
  const tool = toolRegistry[name];
  if (!tool) {
    return null;
  }
  return tool.implementation;
}

/**
 * Gets all available tools formatted for the LLM
 * @returns {Array} - The available tools formatted for the LLM
 */
function getToolsForLLM() {
  try {
    // Return tools directly in the OpenAI format, which is how we now define them
    return Object.values(toolRegistry).map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.function?.strict || canUseStrictMode(tool.parameters)
      }
    }));
  } catch (error) {
    console.error('Error getting tools for LLM:', error);
    return [];
  }
}

// Export all tools and utility functions
module.exports = {
  getTool,
  getToolsForLLM,
  toolRegistry,
  availableEmojis,
  // Individual tool exports
  postMessage,
  finishRequest,
  getThreadHistoryTool,
  updateMessage,
  createEmojiVote,
  getVoteResults,
  getUserAvatar,
  addReaction,
  removeReaction
}; 