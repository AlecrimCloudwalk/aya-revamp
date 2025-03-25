// Setup and handlers for Slack events
const { DEV_MODE } = require('./config.js');
const { getThreadState } = require('./threadState.js');
const { handleIncomingSlackMessage, handleButtonClick, processButtonInteraction } = require('./orchestrator');
const { logError } = require('./errors.js');

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
 * Processes a message from Slack
 * @param {Object} message - The message from Slack
 * @param {Object} context - Additional context for processing
 * @returns {Object} - Context object with additional fields
 */
function createMessageContext(message = {}, context = {}) {
  // Start with existing context or an empty object
  const ctx = context || {};
  
  // Add core message data
  ctx.timestamp = message.ts || ctx.timestamp;
  ctx.channelId = message.channel || ctx.channelId;
  ctx.userId = message.user || ctx.userId;
  ctx.text = message.text || ctx.text;
  
  // Determine if this is a threaded message
  if (message.thread_ts) {
    ctx.threadTs = message.thread_ts;
    ctx.isThreadedConversation = true;
    // For a thread reply, we need both the thread timestamp and the message timestamp
    ctx.currentMessageTs = message.ts;
  } else if (message.ts) {
    // For a non-threaded message, the thread ID is the message ID
    ctx.threadTs = message.ts;
    ctx.isThreadedConversation = false;
  }
  
  // Determine if this is a direct message
  if (message.channel_type === 'im') {
    ctx.isDirectMessage = true;
  }
  
  // Add current message data for LLM context
  ctx.currentMessage = {
    text: message.text,
    timestamp: message.ts,
    threadPosition: message.thread_ts ? null : 1  // First message in thread is position 1
  };
  
  // Add metadata about message type for better LLM context
  if (ctx.isThreadedConversation) {
    ctx.messageType = 'thread_reply';
  } else if (ctx.isDirectMessage) {
    ctx.messageType = 'direct_message';
  } else {
    ctx.messageType = 'channel_message';
  }
  
  return ctx;
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
      const messageContext = createMessageContext(event, {
        teamId: context.teamId
      });

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
      const messageContext = createMessageContext(event, {
        teamId: context.teamId,
        isMention: true
      });

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

  // Handle button clicks from messages with blocks
  app.action(/.*/, async ({ action, body, ack }) => {
    try {
      // Acknowledge receipt of the button action
      await ack();
      
      // Log the entire payload for debugging
      console.log('Button click event payload:', JSON.stringify({
        action_id: action.action_id,
        button_value: action.value,
        user_id: body.user.id,
        channel_id: body.channel.id,
        message_ts: body.message.ts,
        thread_ts: body.message.thread_ts || body.container.message_ts
      }, null, 2));
      
      // Process the button click
      await processButtonInteraction(body);
    } catch (error) {
      console.error('Error handling button click:', error);
    }
  });

  return app;
}

module.exports = {
  setupSlackEvents,
  shouldProcessInDevMode,
  createMessageContext
}; 