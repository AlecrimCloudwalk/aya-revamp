// Tool Registry - Maintains metadata about all available tools

// Import all tools
const { postMessage } = require('./postMessage.js');
const { finishRequest } = require('./finishRequest.js');
const { getThreadHistory } = require('./getThreadHistory.js');
const { createButtonMessage } = require('./createButtonMessage.js');
const { updateMessage } = require('./updateMessage.js');
const { createEmojiVote, getVoteResults } = require('./createEmojiVote.js');
const getUserAvatar = require('./getUserAvatar.js');
const { addReaction, availableEmojis } = require('./addReaction.js');
const processLLMFeedback = require('../toolUtils/processLLMFeedback.js');
const { removeReaction } = require('./removeReaction.js');

// Tool registry with metadata
const toolRegistry = {
  postMessage: {
    name: 'postMessage',
    description: 'Posts a message to Slack with rich formatting options. Always use this tool for all user responses. Supports block builder syntax and easy-to-use interactive elements.',
    function: postMessage,
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Main message content with block builder formatting. Use Markdown for basic formatting (*bold*, _italic_, `code`) and block builder syntax for specialized elements (#header: text, #section: text, #userContext: <@USER_ID>, etc.).',
        },
        color: 'Color for the message sidebar (required, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)',
        buttons: 'Array of button definitions - can be simple strings or objects with text, style ("primary"/"danger"), url, or value properties',
        fields: 'Two-column layout items as array of {title, value} objects or simple strings',
        images: 'Array of image URLs as strings or {url, alt_text} objects to include in the message',
        blocks: 'For advanced usage: array of simplified block definitions for complex layouts'
      },
      required: ['text']
    },
    isAsync: false,
    examples: [
      {
        description: 'Basic message with text',
        code: '{ text: "Meeting scheduled for tomorrow at 2pm.", color: "#3AA3E3" }'
      },
      {
        description: 'Message with structured information',
        code: '{ text: "#header: Team Roster\\n\\n*John* - Developer\\n*Sarah* - Designer\\n*Miguel* - Project Manager", color: "good" }'
      },
      {
        description: 'Interactive message with buttons',
        code: '{ text: "#header: Action Required\\n\\nPlease select an option:", buttons: [{ text: "Approve", value: "approve", style: "primary" }, { text: "Reject", value: "reject", style: "danger" }], color: "#E01E5A" }'
      },
      {
        description: 'Status message with emphasis',
        code: '{ text: "#header: Project Status\\n\\n*Current Status*\\nDevelopment is in progress\\n\\n*Planning Phase*\\nCompleted successfully", color: "#2EB67D" }'
      }
    ]
  },
  finishRequest: {
    name: 'finishRequest',
    description: 'Signals the end of processing for a user request',
    function: finishRequest,
    parameters: {
      summary: 'Brief summary of the completed action'
    },
    isAsync: false
  },
  getThreadHistory: {
    name: 'getThreadHistory',
    description: 'Retrieves and formats thread history from Slack',
    function: getThreadHistory,
    parameters: {
      threadTs: 'Thread timestamp to retrieve history for',
      limit: 'Maximum number of messages to retrieve (optional)',
      includeParent: 'Whether to include the parent message (default: true)'
    },
    isAsync: false
  },
  createButtonMessage: {
    name: 'createButtonMessage',
    description: 'Creates an interactive message with buttons for user input',
    function: createButtonMessage,
    parameters: {
      text: 'Message text content with header and description',
      color: 'Color of the message sidebar (required, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)',
      buttons: 'Array of button objects with text and value properties, e.g. [{text: "Option 1", value: "opt1"}, {text: "Option 2", value: "opt2"}]',
      threadTs: 'Thread timestamp to reply in (optional)',
      callbackId: 'Unique identifier for this set of buttons'
    },
    isAsync: false
  },
  updateMessage: {
    name: 'updateMessage',
    description: 'Updates an existing message in Slack',
    function: updateMessage,
    parameters: {
      messageTs: 'Timestamp of the message to update',
      text: 'New text content for the message with [header] tags for headings',
      color: 'Color for the message sidebar (required, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)',
      fields: 'Array of field objects (optional)',
      actions: 'New array of button objects (optional)',
      removeButtons: 'Whether to remove all buttons (optional)'
    },
    isAsync: false
  },
  createEmojiVote: {
    name: 'createEmojiVote',
    description: 'Creates a message with emoji voting options',
    function: createEmojiVote,
    parameters: {
      text: 'Vote description/question with [header] for title',
      options: 'Array of emoji voting options with text and emoji properties',
      color: 'Color of the message sidebar (required, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)',
      threadTs: 'Thread timestamp to reply in (optional)'
    },
    isAsync: false
  },
  getVoteResults: {
    name: 'getVoteResults',
    description: 'Gets the current results for an emoji vote',
    function: getVoteResults,
    parameters: {
      voteId: 'ID of the vote to get results for (optional if messageTs provided)',
      messageTs: 'Timestamp of the vote message (optional if voteId provided)'
    },
    isAsync: false
  },
  getUserAvatar: {
    name: 'getUserAvatar',
    description: 'Gets a user\'s avatar URL from their Slack user ID',
    function: getUserAvatar,
    parameters: {
      userId: 'The Slack user ID to get avatar for (required)',
      size: 'Size of the avatar to return (24, 32, 48, 72, 192, 512, 1024, or "original", default: 192)'
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
      emoji: 'Emoji name(s) to react with (without colons). Can be a single string like "heart" or an array like ["heart", "kek-doge", "pepebigbrain"] for multiple reactions.',
      messageTs: 'Timestamp of the message to react to (optional, defaults to the latest user message)',
      reasoning: 'Reason for adding this reaction'
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
      emoji: 'Emoji name(s) to remove (without colons). Can be a single string like "heart" or an array like ["heart", "kek-doge", "pepebigbrain"] for multiple reactions.',
      messageTs: 'Timestamp of the message to remove reaction from (optional, defaults to the latest user message)',
      reasoning: 'Reason for removing this reaction'
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
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
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
  createButtonMessage,
  updateMessage,
  createEmojiVote,
  getVoteResults,
  getUserAvatar,
  addReaction,
  removeReaction,
  processLLMFeedback
}; 