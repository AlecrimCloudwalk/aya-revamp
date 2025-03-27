// Tool Registry - Maintains metadata about all available tools

// Import all tools
const { postMessage } = require('./postMessage.js');
const { finishRequest } = require('./finishRequest.js');
const { exampleTool } = require('./exampleTool.js');
const { getThreadHistory } = require('./getThreadHistory.js');
const { createButtonMessage } = require('./createButtonMessage.js');
const { updateMessage } = require('./updateMessage.js');
const { updateButtonMessage } = require('./updateButtonMessage.js');
const { createEmojiVote, getVoteResults } = require('./createEmojiVote.js');
const getUserAvatar = require('./getUserAvatar.js');

// Tool registry with metadata
const toolRegistry = {
  postMessage: {
    name: 'postMessage',
    description: 'Posts a message to Slack with rich formatting options. Always use this tool for all user responses. Supports BBCode-style formatting tags and easy-to-use interactive elements.',
    function: postMessage,
    parameters: {
      text: 'Main message content with hybrid formatting. Use Markdown for basic formatting (*bold*, _italic_, `code`) and BBCode-style tags for specialized elements ([header]...[!header], [context]...[!context], etc.). See formatting.md for details.',
      color: 'Color for the message sidebar (required, use hex code like #36C5F0 or named colors: good=green, warning=yellow, danger=red)',
      buttons: 'Array of button definitions - can be simple strings or objects with text, style ("primary"/"danger"), url, or value properties',
      fields: 'Two-column layout items as array of {title, value} objects or simple strings',
      images: 'Array of image URLs as strings or {url, alt_text} objects to include in the message',
      blocks: 'For advanced usage: array of simplified block definitions for complex layouts'
    },
    isAsync: false,
    examples: [
      {
        description: 'Basic message with text',
        code: '{ text: "Meeting scheduled for tomorrow at 2pm.", color: "#3AA3E3" }'
      },
      {
        description: 'Message with structured information',
        code: '{ text: "[header]Team Roster[!header]\\n\\n*John* - Developer\\n*Sarah* - Designer\\n*Miguel* - Project Manager", color: "good" }'
      },
      {
        description: 'Interactive message with buttons',
        code: '{ text: "[header]Action Required[!header]\\n\\nPlease select an option:", actions: [{ text: "Approve", value: "approve", style: "primary" }, { text: "Reject", value: "reject", style: "danger" }], color: "#E01E5A" }'
      },
      {
        description: 'Status message with emphasis',
        code: '{ text: "[header]Project Status[!header]\\n\\n*Current Status*\\nDevelopment is in progress\\n\\n*Planning Phase*\\nCompleted successfully", color: "#2EB67D" }'
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
  updateButtonMessage: {
    name: 'updateButtonMessage',
    description: 'Updates a button message to highlight the selected option and disable others',
    function: updateButtonMessage,
    parameters: {
      messageTs: 'Timestamp of the button message to update',
      selectedValue: 'Value of the selected button',
      callbackId: 'Callback ID of the button set (optional)',
      additionalText: 'Text to add indicating selection (optional)'
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
        code: '// First call:\n{ userId: "U12345678", size: "original" }\n\n// Then use the returned avatar_url in postMessage:\n// postMessage({ text: "[header]Your Avatar[!header]\\n\\nHere\'s your avatar URL: <" + avatar_url + ">\\n\\n[header]Your Profile Image[!header]\\n\\n!image:" + avatar_url + ":Your profile picture", color: "good" })'
      }
    ]
  },
  exampleTool: {
    name: 'exampleTool',
    description: 'Example tool for demonstration purposes',
    function: exampleTool,
    parameters: {
      param1: 'Example parameter 1',
      param2: 'Example parameter 2 (optional)'
    },
    isAsync: true // Mark as async example
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
  
  if (!toolRegistry[cleanName]) {
    // Enhanced error message with available tools for debugging
    const availableTools = Object.keys(toolRegistry).join(', ');
    console.error(`Tool "${cleanName}" not found in registry. Available tools: ${availableTools}`);
    throw new Error(`Tool "${cleanName}" not found in registry`);
  }
  
  // Check if the function is actually defined
  if (!toolRegistry[cleanName].function) {
    console.error(`Tool "${cleanName}" exists in registry but has no function implementation`);
    throw new Error(`Tool "${cleanName}" implementation is missing`);
  }
  
  return toolRegistry[cleanName].function;
};

// Check if a tool is asynchronous
const isAsyncTool = (name) => {
  // Remove functions. prefix if present
  const cleanName = name.replace(/^functions\./, '');
  
  if (!toolRegistry[cleanName]) {
    throw new Error(`Tool "${cleanName}" not found in registry`);
  }
  return toolRegistry[cleanName].isAsync || false;
};

// Register a new tool
const registerTool = (name, description, func, parameters, isAsync = false) => {
  if (toolRegistry[name]) {
    throw new Error(`Tool "${name}" already exists in registry`);
  }
  
  toolRegistry[name] = {
    name,
    description,
    function: func,
    parameters,
    isAsync
  };
};

module.exports = {
  getToolsForLLM,
  getTool,
  isAsyncTool,
  registerTool,
  // For backward compatibility
  finishRequest,
  postMessage,
  getThreadHistory,
  exampleTool,
  createButtonMessage,
  updateMessage,
  updateButtonMessage,
  createEmojiVote,
  getVoteResults,
  getUserAvatar,
  // Add the full registry for direct inspection
  toolRegistry
}; 