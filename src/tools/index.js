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

// Tool registry with metadata
const toolRegistry = {
  postMessage: {
    name: 'postMessage',
    description: 'Posts a message to Slack with rich formatting options',
    function: postMessage,
    parameters: {
      channel: 'Channel ID to post the message to',
      blocks: 'Slack Block Kit formatted message content',
      text: 'Plain text fallback message',
      threadTs: 'Thread timestamp to reply in a thread (optional)',
      attachments: 'Message attachments (optional)',
      color: 'Color for the message sidebar (optional)'
    },
    isAsync: false
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
      title: 'Title of the message',
      text: 'Message text content',
      color: 'Color of the message sidebar (optional)',
      buttons: 'JSON array of button objects with text, value, and action_id properties',
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
      title: 'New title for the message',
      text: 'New text content for the message',
      color: 'Color for the message (optional)',
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
      title: 'Title of the vote',
      text: 'Vote description/question',
      options: 'Array of emoji voting options with text and emoji properties',
      color: 'Color of the message sidebar (optional)',
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
    isAsync: tool.isAsync
  }));
};

// Get a specific tool by name
const getTool = (name) => {
  if (!toolRegistry[name]) {
    throw new Error(`Tool "${name}" not found in registry`);
  }
  return toolRegistry[name].function;
};

// Check if a tool is asynchronous
const isAsyncTool = (name) => {
  if (!toolRegistry[name]) {
    throw new Error(`Tool "${name}" not found in registry`);
  }
  return toolRegistry[name].isAsync || false;
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
  getVoteResults
}; 