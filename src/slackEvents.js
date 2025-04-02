// Setup and handlers for Slack events
const { DEV_MODE } = require('./config.js');
const { handleIncomingSlackMessage, handleButtonClick } = require('./orchestrator.js');
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');

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
  
  // Filter out dev prefix '!@#' from the text
  let processedText = message.text || ctx.text || '';
  if (processedText.startsWith('!@#')) {
    // Simply remove the prefix without logging
    processedText = processedText.substring(3).trim();
  }
  
  // Set the filtered text
  ctx.text = processedText;
  
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
    text: processedText,
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
 * Sets up event handlers for Slack events
 * @param {Object} app - Slack Bolt app instance
 */
function setupSlackEvents(app) {
    if (!app) {
        throw new Error('No Slack app instance provided to setupSlackEvents');
    }

    // Handle direct messages to the bot
    app.event('message', async ({ event, context, client, say }) => {
        try {
            // Filter out bot messages and message_changed events
            if (event.bot_id || event.subtype === 'message_changed' || event.subtype === 'message_deleted') {
                return;
            }
            
            // Check if this is a direct message (im) or a message in a thread
            const isDirectMessage = event.channel_type === 'im';
            const isThreadedMessage = !!event.thread_ts;
            
            // We only care about:
            // 1. Direct messages to the bot
            // 2. Messages in threads where the bot is active
            if (!isDirectMessage && !isThreadedMessage) {
                return;
            }
            
            // Create context object with consistent properties
            const contextObj = {
                userId: event.user,
                channelId: event.channel,
                timestamp: event.ts,
                threadTs: event.thread_ts || event.ts, // If not in thread, create one
                text: event.text,
                isDirectMessage: isDirectMessage,
                isThreadedConversation: isThreadedMessage,
                isMention: false // Not mentioned, just in DM or thread
            };
            
            // Pass to handler
            await handleIncomingSlackMessage(contextObj);
        } catch (error) {
            console.error(`Error handling message event: ${error.message}`);
            // Try to send an error message
            try {
                await say({
                    text: `I'm having trouble processing your message. Please try again later.`,
                    thread_ts: event.thread_ts || event.ts
                });
            } catch (sayError) {
                console.error(`Error sending error response: ${sayError.message}`);
            }
        }
    });
    
    // Handle mentions of the bot
    app.event('app_mention', async ({ event, context, client, say }) => {
        try {
            // Create context object with consistent properties
            const contextObj = {
                userId: event.user,
                channelId: event.channel,
                timestamp: event.ts,
                threadTs: event.thread_ts || event.ts, // If not in thread, create one
                text: event.text,
                isDirectMessage: false,
                isThreadedConversation: !!event.thread_ts,
                isMention: true
            };
            
            // Pass to handler
            await handleIncomingSlackMessage(contextObj);
        } catch (error) {
            console.error(`Error handling app_mention event: ${error.message}`);
            // Try to send an error message
            try {
                await say({
                    text: `I'm having trouble processing your mention. Please try again later.`,
                    thread_ts: event.thread_ts || event.ts
                });
            } catch (sayError) {
                console.error(`Error sending error response: ${sayError.message}`);
            }
        }
    });
    
    // Handle button clicks in messages
    app.action(/.*/, async ({ action, body, ack, respond }) => {
        try {
            // Acknowledge the request right away
            await ack();
            
            console.log(`✅ Received button click event: action_id=${body.actions?.[0]?.action_id}, value=${body.actions?.[0]?.value}`);
            
            // Pass to handler
            await handleButtonClick(body);
        } catch (error) {
            console.error(`Error handling button click: ${error.message}`);
            // Try to send an error message
            try {
                await respond({
                    text: `I'm having trouble processing your selection. Please try again later.`,
                    replace_original: false
                });
            } catch (respondError) {
                console.error(`Error sending error response: ${respondError.message}`);
            }
        }
    });
    
    // Log errors
    app.error(async (error) => {
        console.error(`Slack app error: ${error.message}`);
        console.error(error);
    });
}

module.exports = {
    setupSlackEvents,
    shouldProcessInDevMode,
    createMessageContext
}; 