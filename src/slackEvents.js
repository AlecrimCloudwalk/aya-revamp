// Setup and handlers for Slack events
const { DEV_MODE } = require('./config.js');
const { handleIncomingSlackMessage, handleButtonClick } = require('./orchestrator.js');
const { logError, handleErrorWithLLM } = require('./errors.js');
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
  // In dev mode, STRICT requirement for dev key (!@#)
  if (DEV_MODE) {
    // Even button clicks need to come from dev key conversations in dev mode
    if (!shouldProcessInDevMode(contextObj.originalText)) {
      logger.info("DEV MODE: Ignoring message without dev key !@#");
      return false;
    }
    
    // If it has the dev key, process it
    logger.info("DEV MODE: Processing message with dev key !@#");
    return true;
  }
  
  // PRODUCTION MODE RULES:
  
  // Rule 1: Always respond if directly mentioned
  if (contextObj.isMention) {
    logger.info("Processing message: Direct mention");
    return true;
  }
  
  // Rule 2: In DMs, only respond if it's a one-on-one conversation (no other users)
  if (contextObj.isDirectMessage && !contextObj.hasMultipleUsers) {
    logger.info("Processing message: Direct 1:1 message");
    return true;
  }
  
  // Rule 3: In ALL other cases (threads, channels, group DMs), DO NOT RESPOND without mention
  logger.info("Skipping message: Not a direct mention or 1:1 DM");
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
 * Gets a human-readable reason for skipping a message
 * @param {Object} contextObj - Message context object
 * @returns {string} - Reason for skipping
 */
function getSkipReason(contextObj) {
  const isDev = process.env.DEV_MODE === 'true';
  
  if (isDev && (!contextObj.text || !contextObj.text.includes('!@#'))) {
    return "Dev mode - missing special key !@#";
  }
  
  if (!contextObj.isDirectMessage && !contextObj.isMention) {
    return "Channel message - no app mention";
  }
  
  if (contextObj.hasMultipleUsers && !contextObj.isMention) {
    return "Group DM - no app mention";
  }
  
  return "Unknown reason";
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
            // Concise logging for all incoming messages
            const textPreview = event.text ? 
                (event.text.length > 40 ? event.text.substring(0, 40) + '...' : event.text) : 
                '[No text]';
            logger.info(`📩 MSG: ch=${event.channel}, user=${event.user || 'unknown'}, text="${textPreview}"${event.bot_id ? ', bot=true' : ''}${event.subtype ? `, subtype=${event.subtype}` : ''}`);
            
            // Filter out bot messages and message_changed events
            if (event.bot_id || event.subtype === 'message_changed' || event.subtype === 'message_deleted') {
                return;
            }
            
            // Check if this is a direct message (im) or a message in a thread
            const isDirectMessage = event.channel_type === 'im';
            const isMultiPersonDM = event.channel_type === 'mpim';
            const isThreadedMessage = !!event.thread_ts;
            
            // Condense message type reporting into one line
            logger.info(`Message metadata: type=${event.channel_type || 'channel'}, DM=${isDirectMessage}, Thread=${isThreadedMessage}, ts=${event.ts}`);
            
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
                logger.info(`👉 SKIPPING: ch=${event.channel}, reason="${getSkipReason(contextObj)}"`);
                return;
            }
            
            logger.info(`✅ PROCESSING: ch=${event.channel}, thread=${event.thread_ts || event.ts}`);
            
            // Pass to handler
            await handleIncomingSlackMessage(contextObj);
        } catch (error) {
            logger.error(`Error handling message event: ${error.message}`);
            
            // Route error to LLM for proper handling
            const errorContext = {
                channelId: event.channel, 
                threadTs: event.thread_ts || event.ts,
                userId: event.user,
                text: event.text,
                isError: true,
                errorSource: 'message_event'
            };
            
            // Let the LLM decide how to respond to the error
            await handleErrorWithLLM(error, errorContext);
        }
    });
    
    // Handle mentions of the bot
    app.event('app_mention', async ({ event, context, client, say }) => {
        try {
            // Concise logging for all incoming mentions
            const textPreview = event.text ? 
                (event.text.length > 40 ? event.text.substring(0, 40) + '...' : event.text) : 
                '[No text]';
            logger.info(`📩 MENTION: ch=${event.channel}, user=${event.user || 'unknown'}, text="${textPreview}"`);
            
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
            
            // Use the same shouldRespondToMessage function for consistency
            if (!shouldRespondToMessage(contextObj)) {
                logger.info(`👉 SKIPPING: ch=${event.channel}, reason="${getSkipReason(contextObj)}"`);
                return;
            }
            
            logger.info(`✅ PROCESSING: ch=${event.channel}, thread=${event.thread_ts || event.ts}`);
            
            // Pass to handler
            await handleIncomingSlackMessage(contextObj);
        } catch (error) {
            logger.error(`Error handling app_mention event: ${error.message}`);
            
            // Route error to LLM for proper handling
            const errorContext = {
                channelId: event.channel, 
                threadTs: event.thread_ts || event.ts,
                userId: event.user,
                text: event.text,
                isError: true,
                isMention: true,
                errorSource: 'app_mention_event'
            };
            
            // Let the LLM decide how to respond to the error
            await handleErrorWithLLM(error, errorContext);
        }
    });
    
    // Handle button clicks in messages
    app.action(/.*/, async ({ action, body, ack, respond }) => {
        try {
            // Acknowledge the request right away
            await ack();
            
            // Concise button click logging
            const buttonText = body.actions?.[0]?.text?.text || body.actions?.[0]?.value || 'unnamed';
            const actionId = body.actions?.[0]?.action_id || 'unknown';
            logger.info(`📩 BUTTON: ch=${body.channel?.id}, user=${body.user?.id}, text="${buttonText}", value=${body.actions?.[0]?.value || 'none'}, ts=${body.container?.message_ts || 'none'}, thread=${body.message?.thread_ts || 'none'}`);
            
            // Check if this button is on a message created by our bot
            const BOT_USER_ID = 'U01CM7M3RLP'; // Our specific bot's ID
            
            const isBotMessage = body.message && (
                // This is the most reliable check - exact match on our bot's ID
                body.message.bot_id === BOT_USER_ID || 
                // Backup checks if for some reason the bot_id doesn't match
                (body.message.user && body.message.user === BOT_USER_ID)
            );
            
            if (!isBotMessage) {
                logger.info(`👉 SKIPPING: button on non-bot message (bot_id=${body.message?.bot_id || 'none'})`);
                return;
            }
            
            // Log processing start
            logger.info(`✅ PROCESSING: button="${buttonText}", action_id=${actionId}`);
            
            // Pass to handler
            await handleButtonClick(body);
        } catch (error) {
            logger.error(`Error handling button click: ${error.message}`);
            
            // Route error to LLM for proper handling
            const errorContext = {
                channelId: body.channel?.id, 
                threadTs: body.message?.thread_ts || body.container?.message_ts,
                userId: body.user?.id,
                isError: true,
                isButtonClick: true,
                buttonText: body.actions?.[0]?.text?.text || body.actions?.[0]?.value || 'unknown button',
                actionValue: body.actions?.[0]?.value,
                errorSource: 'button_interaction'
            };
            
            // Let the LLM decide how to respond to the error
            await handleErrorWithLLM(error, errorContext);
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