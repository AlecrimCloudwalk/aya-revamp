// Tool Registry - Maintains metadata about all available tools

// Import all tools
const { postMessage } = require('./postMessage.js');
const { finishRequest } = require('./finishRequest.js');
const { getThreadHistory } = require('./getThreadHistory.js');
const { updateMessage } = require('./updateMessage.js');
const { createEmojiVote, getVoteResults } = require('./createEmojiVote.js');
const getUserAvatar = require('./getUserAvatar.js');
const { addReaction, availableEmojis } = require('./addReaction.js');
const processLLMFeedback = require('./processLLMFeedback.js');
const { removeReaction } = require('./removeReaction.js');

// Tool registry with metadata
const toolRegistry = {
  postMessage: {
    name: 'postMessage',
    description: 'Posts a message to Slack with rich formatting options. Always use this tool for all user responses. Use special block syntax within the text parameter for formatting.',
    function: postMessage,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Main message content with special formatting syntax. Use these block formats:\n#header: Title text\n#section: Regular text content\n#context: Smaller helper text\n#divider: (adds a line separator)\n#image: URL | altText:Description\n#contextWithImages: Text | images:[URL1|Alt text 1, URL2|Alt text 2]\n#userContext: <@USER_ID> <@USER_ID2> | description text\n#buttons: [Button 1|value1|primary, Button 2|value2|danger]\n#fields: [*Title 1*|Value 1, *Title 2*|Value 2]'
        },
        color: {
          type: 'string',
          description: 'Color for the message sidebar (optional, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)'
        }
      },
      required: ['text']
    },
    isAsync: false,
    examples: [
      {
        description: 'Basic message with text',
        code: '{ text: "#header: Meeting Scheduled\\n\\n#section: Meeting scheduled for tomorrow at 2pm.", color: "#3AA3E3" }'
      },
      {
        description: 'Message with structured information',
        code: '{ text: "#header: Team Roster\\n\\n#section: *John* - Developer\\n*Sarah* - Designer\\n*Miguel* - Project Manager", color: "good" }'
      },
      {
        description: 'Interactive message with buttons',
        code: '{ text: "#header: Action Required\\n\\n#section: Please select an option:\\n\\n#buttons: [Approve|approve|primary, Reject|reject|danger]", color: "#E01E5A" }'
      },
      {
        description: 'Message with images and fields',
        code: '{ text: "#header: Project Status\\n\\n#section: Current progress\\n\\n#image: https://example.com/image.jpg | altText:Project dashboard\\n\\n#fields: [*Completion*|75%, *Due Date*|Tomorrow]", color: "#2EB67D" }'
      },
      {
        description: 'Message with user context',
        code: '{ text: "#header: Team Discussion\\n\\n#section: Let\'s discuss the project updates\\n\\n#userContext: <@U12345678> <@U87654321> | participating in this conversation", color: "#6FD36F" }'
      },
      {
        description: 'Message with multiple images',
        code: '{ text: "#header: Project Gallery\\n\\n#section: Here are some images from the project\\n\\n#contextWithImages: Project visuals | images:[https://example.com/image1.jpg|Dashboard view, https://example.com/image2.jpg|User flow diagram]", color: "#9733EE" }'
      }
    ]
  },
  finishRequest: {
    name: 'finishRequest',
    description: 'Signals the end of processing for a user request',
    function: finishRequest,
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of the completed action'
        }
      }
    },
    isAsync: false
  },
  getThreadHistory: {
    name: 'getThreadHistory',
    description: 'Retrieves and formats thread history from Slack',
    function: getThreadHistory,
    parameters: {
      type: 'object',
      properties: {
        threadTs: {
          type: 'string',
          description: 'Thread timestamp to retrieve history for'
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of messages to retrieve (optional)'
        },
        includeParent: {
          type: 'boolean',
          description: 'Whether to include the parent message (default: true)'
        }
      }
    },
    isAsync: false
  },
  updateMessage: {
    name: 'updateMessage',
    description: 'Updates an existing message in Slack',
    function: updateMessage,
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
          description: 'Color for the message sidebar (optional, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)'
        },
        removeButtons: {
          type: 'boolean',
          description: 'Whether to remove all buttons (optional)'
        }
      },
      required: ['messageTs', 'text']
    },
    isAsync: false
  },
  createEmojiVote: {
    name: 'createEmojiVote',
    description: 'Creates a message with emoji voting options',
    function: createEmojiVote,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Vote description/question with [header] for title'
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
          description: 'Color of the message sidebar (required, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)'
        },
        threadTs: {
          type: 'string',
          description: 'Thread timestamp to reply in (optional)'
        }
      }
    },
    isAsync: false
  },
  getVoteResults: {
    name: 'getVoteResults',
    description: 'Gets the current results for an emoji vote',
    function: getVoteResults,
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
        }
      }
    },
    isAsync: false
  },
  getUserAvatar: {
    name: 'getUserAvatar',
    description: 'Gets a user\'s avatar URL from their Slack user ID',
    function: getUserAvatar,
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
        }
      },
      required: ['userId']
    },
    isAsync: true,
    examples: [
      {
        description: 'Get user avatar with default size',
        code: '{ userId: "U12345678" }'
      },
      {
        description: 'Get user avatar with specific size',
        code: '{ userId: "U12345678", size: "512" }'
      },
      {
        description: 'Get user avatar and display it in a message (chain with postMessage)',
        code: '// First call:\n{ userId: "U12345678", size: "original" }\n\n// Then use the returned avatar_url in postMessage:\n// postMessage({ text: "#header: Your Avatar\\n\\nHere\'s your avatar URL: <" + avatar_url + ">\\n\\n#header: Your Profile Image\\n\\n#image: " + avatar_url + " | altText:Your profile picture", color: "good" })'
      }
    ]
  },
  addReaction: {
    name: 'addReaction',
    description: 'Adds emoji reaction(s) to a message. Use this to react to user messages with emojis including custom workspace emojis like "loading" and "kek-doge".',
    function: addReaction,
    parameters: {
      type: 'object',
      properties: {
        emoji: {
          oneOf: [
            {
              type: 'string',
              description: 'Emoji name to react with (without colons)'
            },
            {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of emoji names to react with (without colons)'
            }
          ],
          description: 'Emoji name(s) to react with (without colons). Can be a single string like "heart" or an array like ["heart", "kek-doge", "pepebigbrain"] for multiple reactions.'
        },
        messageTs: {
          type: 'string',
          description: 'Timestamp of the message to react to (optional, defaults to the latest user message)'
        },
        reasoning: {
          type: 'string',
          description: 'Reason for adding this reaction'
        }
      },
      required: ['emoji']
    },
    isAsync: true,
    examples: [
      {
        description: 'React to the current message with a thumbs up',
        code: '{ emoji: "thumbsup", reasoning: "Acknowledging user\'s positive feedback" }'
      },
      {
        description: 'React with multiple emojis',
        code: '{ emoji: ["heart", "kek-doge", "pepebigbrain"], reasoning: "Showing multiple reactions to user\'s message" }'
      },
      {
        description: 'React to a specific message',
        code: '{ emoji: "heart", messageTs: "1234567890.123456", reasoning: "Showing appreciation for user\'s message" }'
      }
    ]
  },
  processLLMFeedback: {
    name: 'processLLMFeedback',
    description: 'Retrieves button click feedback and user selections from thread state for context awareness. Call this at the beginning of your processing to get information about button interactions.',
    function: processLLMFeedback,
    parameters: {
      type: 'object',
      properties: {
        checkForSelection: {
          type: 'boolean',
          description: 'Whether to specifically check for button selections (default: true)'
        }
      }
    },
    isAsync: false,
    examples: [
      {
        description: 'Check for button selection feedback',
        code: '{ checkForSelection: true }'
      },
      {
        description: 'Process all available feedback',
        code: '{}'
      }
    ]
  },
  removeReaction: {
    name: 'removeReaction',
    description: 'Removes an emoji reaction from a message',
    function: removeReaction,
    parameters: {
      type: 'object',
      properties: {
        emoji: {
          oneOf: [
            {
              type: 'string',
              description: 'Emoji name to remove (without colons)'
            },
            {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Array of emoji names to remove (without colons)'
            }
          ],
          description: 'Emoji name(s) to remove (without colons). Can be a single string like "heart" or an array like ["heart", "kek-doge", "pepebigbrain"] for multiple reactions.'
        },
        messageTs: {
          type: 'string',
          description: 'Timestamp of the message to remove reaction from (optional, defaults to the latest user message)'
        },
        reasoning: {
          type: 'string',
          description: 'Reason for removing this reaction'
        }
      },
      required: ['emoji']
    },
    isAsync: true,
    examples: [
      {
        description: 'Remove a reaction from the current message',
        code: '{ emoji: "heart", reasoning: "Removing appreciation for user\'s message" }'
      },
      {
        description: 'Remove multiple reactions from a specific message',
        code: '{ emoji: ["heart", "kek-doge"], messageTs: "1234567890.123456", reasoning: "Removing multiple reactions from user\'s message" }'
      }
    ]
  }
};

// Get available tools formatted for the LLM
const getToolsForLLM = () => {
  return Object.values(toolRegistry).map(tool => ({
    type: "function",  // Add required type field for OpenAI API
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    },
    isAsync: tool.isAsync,
    examples: tool.examples // Include examples if available
  }));
};

// Get a specific tool by name
const getTool = (name) => {
  // Remove functions. prefix if present
  const cleanName = name.replace(/^functions\./, '');
  
  // Check if the tool exists in the registry
  if (toolRegistry[cleanName]) {
    return toolRegistry[cleanName].function;
  }
  
  // If not found, return null
  console.log(`⚠️ Tool not found: ${name}`);
  return null;
};

// Check if a tool is async
const isAsyncTool = (name) => {
  // Remove functions. prefix if present
  const cleanName = name.replace(/^functions\./, '');
  
  // Check if the tool exists and is async
  return toolRegistry[cleanName] ? toolRegistry[cleanName].isAsync : false;
};

// Register a new tool
const registerTool = (name, description, func, parameters, isAsync = false) => {
  toolRegistry[name] = {
    name,
    description,
    function: func,
    parameters,
    isAsync
  };
};

// Export all tools and utility functions
module.exports = {
  getToolsForLLM,
  getTool,
  isAsyncTool,
  registerTool,
  availableEmojis,
  // Individual tool exports
  postMessage,
  finishRequest,
  getThreadHistory,
  updateMessage,
  createEmojiVote,
  getVoteResults,
  getUserAvatar,
  addReaction,
  removeReaction,
  processLLMFeedback
}; 