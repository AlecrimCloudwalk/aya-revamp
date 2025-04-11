// Tool Registry - Maintains metadata about all available tools
const crypto = require('crypto');

// Import all tools
const { postMessage } = require('./postMessage.js');
const { finishRequest } = require('./finishRequest.js');
const getThreadHistoryTool = require('./getThreadHistory.js');
const { updateMessage } = require('./updateMessage.js');
const { createEmojiVote, getVoteResults } = require('./createEmojiVote.js');
const getUserAvatar = require('./getUserAvatar.js');
const { addReaction, availableEmojis } = require('./addReaction.js');
const { removeReaction } = require('./removeReaction.js');

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
        required: ['text', 'reasoning', 'color'],
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
            description: 'Optional summary of the completed task or final thoughts (optional)'
          },
          clearCache: {
            type: 'boolean',
            description: 'Whether to clear the thread history cache for this thread (optional, default: false)'
          },
          reasoning: {
            type: 'string',
            description: 'Explanation for why the conversation is being ended (optional)'
          }
        },
        required: ['summary', 'clearCache', 'reasoning'],
        additionalProperties: false
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
        required: ['limit', 'includeParent', 'order', 'forceRefresh', 'reasoning'],
        additionalProperties: false
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
        required: ['messageTs', 'text', 'reasoning', 'color', 'removeButtons'],
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
              required: ['text', 'emoji'],
              additionalProperties: false
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
        required: ['text', 'options', 'color', 'reasoning', 'threadTs'],
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
        required: ['reasoning', 'voteId', 'messageTs'],
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
        required: ['userId', 'reasoning', 'size'],
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
        required: ['emoji', 'reasoning', 'messageTs', 'message_ts', 'message_id', 'channel_id'],
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
        required: ['emoji', 'reasoning', 'messageTs', 'message_ts', 'message_id', 'channel_id'],
        additionalProperties: false
      },
      strict: true
    },
    implementation: removeReaction
  }
};

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
  
  // Add detailed logging for debugging
  console.log('DEBUG: canUseStrictMode check for schema:', JSON.stringify({
    properties: Object.keys(parameters.properties),
    required: parameters.required || []
  }));
  
  // Check if additionalProperties is already false
  const hasAdditionalPropsFalse = parameters.additionalProperties === false;
  
  // For OpenAI's strict mode, ALL properties must be in the required array
  // regardless of whether they're actually optional in the implementation
  const allPropsAreRequired = parameters.required && 
    Object.keys(parameters.properties).every(prop => parameters.required.includes(prop));
  
  console.log(`DEBUG: canUseStrictMode result: hasAdditionalPropsFalse=${hasAdditionalPropsFalse}, allPropsAreRequired=${allPropsAreRequired}`);
  
  return hasAdditionalPropsFalse && allPropsAreRequired;
}

/**
 * Creates a tool schema from a function and metadata
 * @param {Function} fn - The tool function
 * @param {Object} metadata - Tool metadata
 * @returns {Object} - Tool schema
 */
function createToolSchema(fn, metadata) {
  // Get function parameter names through reflection
  const fnStr = fn.toString();
  const paramMatch = fnStr.match(/\(([^)]*)\)/);
  const paramNames = paramMatch && paramMatch[1] ?
    paramMatch[1].split(',').map(p => p.trim()).filter(Boolean) :
    [];
  
  // Extract JSDoc if available
  const jsDocComment = extractJSDocComment(fnStr);
  const jsDocParams = parseJSDocParams(jsDocComment);
  
  // Create parameters schema
  const parametersSchema = {
    type: 'object',
    properties: {},
    required: []
  };
  
  // Process each parameter
  for (const paramName of paramNames) {
    // Skip the threadState/context parameter (usually last parameter)
    if (['threadState', 'context', 'threadContext'].includes(paramName)) {
      continue;
    }
    
    // Add to required parameters if not explicitly optional
    if (!paramName.startsWith('_') && !jsDocParams[paramName]?.optional) {
      parametersSchema.required.push(paramName);
    }
    
    // Add parameter to properties with documentation if available
    parametersSchema.properties[paramName] = {
      type: jsDocParams[paramName]?.type || 'string',
      description: jsDocParams[paramName]?.description || `Parameter ${paramName}`
    };
  }
  
  // Build final schema
  return {
    type: "function",
    function: {
      name: metadata.name || fn.name,
      description: metadata.description || extractJSDocDescription(jsDocComment) || `Tool ${fn.name}`,
      parameters: metadata.parameters || parametersSchema,
      strict: canUseStrictMode(parametersSchema)
    },
    implementation: fn
  };
}

/**
 * Extracts JSDoc comment from function string
 * @param {string} fnStr - Function as string
 * @returns {string|null} - JSDoc comment or null
 */
function extractJSDocComment(fnStr) {
  const jsDocMatch = fnStr.match(/\/\*\*([\s\S]*?)\*\//);
  return jsDocMatch ? jsDocMatch[1] : null;
}

/**
 * Extracts description from JSDoc comment
 * @param {string} jsDocComment - JSDoc comment
 * @returns {string|null} - Description or null
 */
function extractJSDocDescription(jsDocComment) {
  if (!jsDocComment) return null;
  
  // Get first paragraph before any @tags
  const descMatch = jsDocComment.match(/^\s*\*\s*([^@]*?)(?:\s*\*\s*@|$)/);
  if (descMatch && descMatch[1]) {
    return descMatch[1].replace(/\s*\*\s*/g, ' ').trim();
  }
  
  return null;
}

/**
 * Parses JSDoc @param tags
 * @param {string} jsDocComment - JSDoc comment
 * @returns {Object} - Map of parameter info
 */
function parseJSDocParams(jsDocComment) {
  if (!jsDocComment) return {};
  
  const result = {};
  const paramMatches = jsDocComment.matchAll(/\*\s*@param\s+(?:{([^}]*)})?\s*(?:\[([^\]]*)\]|(\S+))\s*-?\s*(.*?)(?=\*\s*@|\*\/|$)/g);
  
  for (const match of Array.from(paramMatches)) {
    const type = match[1] || 'string';
    const paramName = match[3] || match[2]?.replace(/[\[\]]/g, '');
    const description = match[4]?.trim();
    const optional = !!match[2]; // Parameter was in brackets
    
    if (paramName) {
      result[paramName] = { type, description, optional };
    }
  }
  
  return result;
}

/**
 * Registers a tool with optional metadata enhancement
 * @param {Function} fn - Tool function to register
 * @param {Object} metadata - Additional metadata
 * @returns {Object} - Registered tool info
 */
function registerTool(fn, metadata = {}) {
  // Create tool schema
  const schema = createToolSchema(fn, metadata);
  
  // Override with explicit metadata where provided
  if (metadata.parameters) {
    schema.function.parameters = metadata.parameters;
  }
  
  if (metadata.description) {
    schema.function.description = metadata.description;
  }
  
  // Register the tool in the registry
  toolRegistry[schema.function.name] = schema;
  
  // Return the registered info
  return {
    name: schema.function.name,
    schema
  };
}

// Register getUserAvatar with the new utility function
toolRegistry.getUserAvatar = createToolSchema(getUserAvatar, {
  name: 'getUserAvatar',
  description: 'Gets a user\'s avatar URL from their Slack user ID'
});

/**
 * Get a tool by name
 * @param {string} name - Name of the tool to get
 * @returns {Function} - The tool function
 */
function getTool(name) {
  if (!toolRegistry[name]) {
    return null;
  }
  
  return toolRegistry[name].implementation;
}

/**
 * Get all tools in LLM-compatible format
 * @returns {Array} - Array of tool schemas for the LLM
 */
function getToolsForLLM() {
  return Object.values(toolRegistry);
}

// Export utilities
module.exports = {
  getTool,
  getToolsForLLM,
  toolRegistry,
  availableEmojis,
  registerTool,
  createToolSchema,
  extractJSDocComment,
  extractJSDocDescription,
  parseJSDocParams
}; 