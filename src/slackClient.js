// Exports the Slack client as a singleton for use across the application
const { SLACK_BOT_TOKEN } = require('./config.js');

// Will be initialized in main.js and accessed by tools
let slackClient = null;

/**
 * Sets the Slack client instance
 * @param {Object} client - The Slack client from Bolt app
 */
function setSlackClient(client) {
  slackClient = client;
}

/**
 * Gets the Slack client instance
 * @returns {Object} The Slack client
 * @throws {Error} If the client hasn't been initialized
 */
function getSlackClient() {
  if (!slackClient) {
    console.warn('Slack client has not been initialized yet. This may happen during early startup or testing.');
    return null;
  }
  return slackClient;
}

module.exports = {
  setSlackClient,
  getSlackClient
}; 