/**
 * Main exports for the Slack bot
 */

// Core components
const { getContextBuilder } = require('./contextBuilder.js');
const { getThreadContextBuilder } = require('./threadContextBuilder.js');
const { getNextAction } = require('./llmInterface.js');
const { processThread, processButtonInteraction } = require('./orchestrator.js');
const { getToolsForLLM } = require('./tools');

// Export for use in main app
module.exports = {
  // Core components
  getContextBuilder,
  getThreadContextBuilder,
  getNextAction,
  processThread,
  processButtonInteraction,
  getToolsForLLM
}; 