// Setup and handlers for Slack events
const { DEV_MODE } = require('./config.js');
const { handleIncomingSlackMessage, handleButtonClick } = require('./orchestrator.js');
const { logError } = require('./errors.js');
const { getSlackClient } = require('./slackClient.js');
const logger = require('./toolUtils/logger.js');


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
 * Determines if bot should respond to a message based on context
 * @param {Object} contextObj - Message context object
 * @returns {boolean} - Whether the message should be processed
 */
function shouldRespondToMessage(contextObj) {
  // In dev mode, only process messages containing the test key
  if (DEV_MODE && !shouldProcessInDevMode(contextObj.text)) {
    logger.info("DEV MODE: Ignoring message without dev key !@#");
    return false;
  }
  
  // Always respond if directly mentioned
  if (contextObj.isMention) {
    return true;
  }
  
  // In DMs, only respond if it's a one-on-one conversation (no other users)
  if (contextObj.isDirectMessage && !contextObj.hasMultipleUsers) {
    return true;
  }
  
  // Don't respond in channels or multi-user DMs without being mentioned
  return false;
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
  
  // Store original text for dev mode checking
  const originalText = message.text || ctx.text || '';
  ctx.originalText = originalText;
  
  // Filter out dev prefix '!@#' from the text
  let processedText = originalText;
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
  
  // Determine if this is a direct message with multiple users
  if (message.channel_type === 'im') {
    ctx.isDirectMessage = true;
    ctx.hasMultipleUsers = false; // One-on-one DM
  } else if (message.channel_type === 'mpim') {
    ctx.isDirectMessage = true;
    ctx.hasMultipleUsers = true; // Multi-person DM
  } else {
    ctx.isDirectMessage = false;
    ctx.hasMultipleUsers = true; // Channel
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
            const isMultiPersonDM = event.channel_type === 'mpim';
            const isThreadedMessage = !!event.thread_ts;
            
            // Create context object with consistent properties
            const contextObj = {
                userId: event.user,
                channelId: event.channel,
                timestamp: event.ts,
                threadTs: event.thread_ts || event.ts, // If not in thread, create one
                text: event.text,
                originalText: event.text,
                isDirectMessage: isDirectMessage || isMultiPersonDM,
                hasMultipleUsers: isMultiPersonDM,
                isThreadedConversation: isThreadedMessage,
                isMention: false // Not mentioned, just in DM or thread
            };
            
            // Check if we should respond to this message
            if (!shouldRespondToMessage(contextObj)) {
                console.log("Ignoring message - doesn't meet response criteria");
                return;
            }
            
            // Pass to handler
            await handleIncomingSlackMessage(contextObj);
        } catch (error) {
            logger.error(`Error handling message event: ${error.message}`);
            // Try to send an error message
            try {
                await say({
                    text: `I'm having trouble processing your message. Please try again later.`,
                    thread_ts: event.thread_ts || event.ts
                });
            } catch (sayError) {
                logger.error(`Error sending error response: ${sayError.message}`);
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
                originalText: event.text,
                isDirectMessage: false,
                hasMultipleUsers: true,
                isThreadedConversation: !!event.thread_ts,
                isMention: true
            };
            
            // Check if we should respond to this message (dev mode check)
            if (DEV_MODE && !shouldProcessInDevMode(contextObj.originalText)) {
                logger.info("DEV MODE: Ignoring mention without dev key !@#");
                return;
            }
            
            // Pass to handler
            await handleIncomingSlackMessage(contextObj);
        } catch (error) {
            logger.error(`Error handling app_mention event: ${error.message}`);
            // Try to send an error message
            try {
                await say({
                    text: `I'm having trouble processing your mention. Please try again later.`,
                    thread_ts: event.thread_ts || event.ts
                });
            } catch (sayError) {
                logger.error(`Error sending error response: ${sayError.message}`);
            }
        }
    });
    
    // Handle button clicks in messages
    app.action(/.*/, async ({ action, body, ack, respond }) => {
        try {
            // Acknowledge the request right away
            await ack();
            
            logger.info(`✅ Received button click event: action_id=${body.actions?.[0]?.action_id}, value=${body.actions?.[0]?.value}`);
            
            // Pass to handler
            await handleButtonClick(body);
        } catch (error) {
            logger.error(`Error handling button click: ${error.message}`);
            // Try to send an error message
            try {
                await respond({
                    text: `I'm having trouble processing your selection. Please try again later.`,
                    replace_original: false
                });
            } catch (respondError) {
                logger.error(`Error sending error response: ${respondError.message}`);
            }
        }
    });
    
    // Log errors
    app.error(async (error) => {
        logger.error(`Slack app error: ${error.message}`);
        console.error(error);
    });
}

module.exports = {
    setupSlackEvents,
    shouldProcessInDevMode,
    shouldRespondToMessage,
    createMessageContext
}; 