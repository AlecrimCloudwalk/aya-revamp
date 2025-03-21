// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();

const { App } = require('@slack/bolt');
const { setupSlackEvents } = require('./slackEvents.js');
const { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_APP_TOKEN } = require('./config.js');
const { logError } = require('./errors.js');
const { setSlackClient } = require('./slackClient.js');

// Initialize Slack Bolt app
const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: SLACK_APP_TOKEN,
});

// Store the Slack client in our singleton
setSlackClient(app.client);

// Set up Slack event listeners
setupSlackEvents(app);

// Start the app
(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack bot is running!');
  } catch (error) {
    logError('Failed to start Slack bot', error);
    process.exit(1);
  }
})(); 