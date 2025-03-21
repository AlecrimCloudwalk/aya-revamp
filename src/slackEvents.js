// Handles Slack events and routes them to the orchestrator
const { handleIncomingSlackMessage } = require('./orchestrator.js');
const { logError } = require('./errors.js');
const { DEV_MODE } = require('./config.js');

/**
 * Checks if a message should be processed in development mode
 * @param {string} text - Message text
 * @returns {boolean} - Whether the message should be processed
 */
function shouldProcessInDevMode(text) {
  // In development mode, only process messages containing the test key
  return text && text.includes("!@#");
}

/**
 * Sets up Slack event handlers
 * @param {Object} app - Slack Bolt app instance
 */
function setupSlackEvents(app) {
  // Handle direct messages to the bot
  app.event('message', async ({ event, context, client, say }) => {
    try {
      // Basic log with relevant info only
      console.log(`Slack message: "${event.text?.substring(0, 50)}${event.text?.length > 50 ? '...' : ''}" | User: ${event.user} | Channel: ${event.channel}`);
      
      // Skip bot messages to prevent loops
      if (event.bot_id || event.subtype === 'bot_message') {
        console.log("Skipped: Bot message");
        return;
      }
      
      // Only process DMs (channel type im)
      const isDM = event.channel_type === 'im';
      if (!isDM) {
        console.log("Skipped: Not a DM");
        return;
      }
      
      // In dev mode, only process messages with the test key
      if (DEV_MODE && !shouldProcessInDevMode(event.text)) {
        console.log("Skipped: Dev mode - Missing test key");
        return;
      }

      // Collect message metadata
      const messageContext = {
        text: event.text,
        userId: event.user,
        channelId: event.channel,
        threadTs: event.thread_ts || event.ts,
        timestamp: event.ts,
        teamId: context.teamId
      };

      // Handle the message with our orchestrator
      await handleIncomingSlackMessage(messageContext);
    } catch (error) {
      logError('Error handling Slack message event', error, { event });
    }
  });

  // Handle app mentions (when someone @mentions the bot)
  app.event('app_mention', async ({ event, context, client, say }) => {
    try {
      // Basic log with relevant info only
      console.log(`Mention: "${event.text?.substring(0, 50)}${event.text?.length > 50 ? '...' : ''}" | User: ${event.user} | Channel: ${event.channel}`);
      
      // In dev mode, only process mentions with the test key
      if (DEV_MODE && !shouldProcessInDevMode(event.text)) {
        console.log("Skipped: Dev mode - Missing test key");
        return;
      }

      // Collect message metadata
      const messageContext = {
        text: event.text,
        userId: event.user,
        channelId: event.channel,
        threadTs: event.thread_ts || event.ts,
        timestamp: event.ts,
        teamId: context.teamId,
        isMention: true
      };

      // Handle the message with our orchestrator
      await handleIncomingSlackMessage(messageContext);
    } catch (error) {
      logError('Error handling app_mention event', error, { event });
    }
  });

  // Example of handling a slash command
  app.command('/askbot', async ({ command, ack, context, client }) => {
    // Acknowledge the command request right away
    await ack();

    try {
      // Basic log with relevant info only
      console.log(`Command: /askbot "${command.text?.substring(0, 50)}${command.text?.length > 50 ? '...' : ''}" | User: ${command.user_id} | Channel: ${command.channel_id}`);
      
      // In dev mode, only process commands with the test key
      if (DEV_MODE && !shouldProcessInDevMode(command.text)) {
        console.log("Skipped: Dev mode - Missing test key");
        return;
      }

      // Collect command metadata
      const commandContext = {
        text: command.text,
        userId: command.user_id,
        channelId: command.channel_id,
        teamId: context.teamId,
        isCommand: true,
        commandName: '/askbot',
        responseUrl: command.response_url
      };

      // Handle the command with our orchestrator
      await handleIncomingSlackMessage(commandContext);
    } catch (error) {
      logError('Error handling slash command', error, { command });
    }
  });

  // Handle interactive button clicks (for action buttons in messages)
  app.action(/.*/, async ({ action, body, context, ack, client }) => {
    // Acknowledge the action request
    await ack();

    try {
      // Basic log with relevant info only
      console.log(`Action: ${action.action_id} | Value: ${action.value} | User: ${body.user.id} | Channel: ${body.channel.id}`);

      // Collect action metadata
      const actionContext = {
        actionId: action.action_id,
        actionValue: action.value,
        userId: body.user.id,
        channelId: body.channel.id,
        messageTs: body.message.ts,
        threadTs: body.message.thread_ts,
        teamId: context.teamId,
        isAction: true
      };

      // Pass the action to a specialized handler
      await handleIncomingSlackMessage(actionContext);
    } catch (error) {
      logError('Error handling interactive action', error, { action, body });
    }
  });
}

module.exports = {
  setupSlackEvents
}; 