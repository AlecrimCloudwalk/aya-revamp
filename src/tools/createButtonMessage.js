// Tool for creating interactive messages with buttons
const { formatSlackMessage } = require('../slackFormat.js');
const { getSlackClient } = require('../slackClient.js');
const { logError } = require('../errors.js');

/**
 * Creates a message with interactive buttons
 * 
 * @param {Object} args - Arguments for the button message
 * @param {string} args.title - Title of the message
 * @param {string} args.text - Message content
 * @param {string} args.color - Color of the message (optional)
 * @param {Array|string} args.buttons - Array of button objects or JSON string representing buttons
 * @param {string} args.callbackId - Unique identifier for this set of buttons
 * @param {string} args.threadTs - Thread timestamp to reply in (optional)
 * @param {Object} threadState - Current thread state
 * @returns {Promise<Object>} - Result of sending the message
 */
async function createButtonMessage(args, threadState) {
  try {
    console.log('⚠️ createButtonMessage args:', JSON.stringify(args, null, 2));
    
    // Handle potential nested parameters structure 
    if (args.parameters && !args.text && !args.title && !args.buttons) {
      console.log('⚠️ Detected nested parameters structure, extracting inner parameters');
      args = args.parameters;
    }
    
    // Extract parameters with validation - use let for variables we'll modify later
    let title = args.title || 'Interactive Message';
    let text = args.text || 'Please select an option';
    let buttons = args.buttons || [];
    let color = args.color || '#3AA3E3';
    let threadTs = args.threadTs;
    
    // Validate and log parameters
    console.log(`⚠️ Buttons parameter type: ${typeof buttons}`);
    
    // Handle buttons format - can be an array, string JSON, or missing
    if (typeof buttons === 'string') {
      try {
        console.log('Parsing buttons parameter from JSON string to array');
        buttons = JSON.parse(buttons);
        console.log('Successfully parsed buttons parameter to array');
      } catch (error) {
        console.log(`Error parsing buttons parameter: ${error.message}`);
        // Create default buttons if parsing fails
        buttons = [
          { text: 'Option 1', value: 'option1' },
          { text: 'Option 2', value: 'option2' }
        ];
      }
    }
    
    // Ensure buttons is an array
    if (!Array.isArray(buttons)) {
      console.log(`⚠️ Buttons is not an array, converting to array`);
      // Try to convert to array if possible, otherwise use default
      if (buttons && typeof buttons === 'object') {
        buttons = [buttons]; // Single button object
      } else {
        // Default buttons
        buttons = [
          { text: 'Option 1', value: 'option1' },
          { text: 'Option 2', value: 'option2' }
        ];
      }
    } else {
      console.log(`⚠️ Buttons parameter is already an array with ${buttons.length} items`);
    }
    
    // Ensure we have at least one button
    if (buttons.length === 0) {
      console.log('⚠️ No buttons provided, adding default buttons');
      buttons = [
        { text: 'Option 1', value: 'option1' },
        { text: 'Option 2', value: 'option2' }
      ];
    }
    
    // Map buttons to ensure they have all required properties
    buttons = buttons.map((button, index) => {
      // Sanity check - ensure button is an object
      if (!button || typeof button !== 'object') {
        button = { text: `Option ${index + 1}`, value: `option${index + 1}` };
      }
      
      // Ensure button has text and value
      return {
        text: button.text || `Option ${index + 1}`,
        value: button.value || `option${index + 1}`
      };
    });
    
    // Get context from metadata
    const context = threadState.getMetadata('context');
    
    // Use channel from args, or fall back to context
    const channelId = args.channel || context?.channelId;
    
    // Validate channel
    if (!channelId) {
      throw new Error('Channel ID not available in thread context or args');
    }
    
    // Get Slack client
    const slackClient = getSlackClient();
    
    // Check for potential duplicates in the button registry
    if (threadState.buttonRegistry) {
      const existingButtons = Object.values(threadState.buttonRegistry);
      
      // Look for a similar button set (same title, text, and similar buttons)
      const potentialDuplicate = existingButtons.find(registry => {
        // Check if title and text are the same or very similar
        const titleMatch = registry.title === title || 
                          (title && registry.title && 
                          (title.includes(registry.title) || registry.title.includes(title)));
                          
        const textMatch = registry.text === text || 
                         (text && registry.text && 
                         (text.includes(registry.text) || registry.text.includes(text)));
        
        // If both title and text match, this is likely a duplicate
        return titleMatch && textMatch;
      });
      
      if (potentialDuplicate) {
        console.log(`⚠️ Found potentially duplicate button message: "${title}"`);
        console.log(`- Existing: "${potentialDuplicate.title}" from ${potentialDuplicate.timestamp}`);
        
        // Return the existing button info instead of creating a new one
        return {
          ok: true,
          ts: potentialDuplicate.messageTs,
          channel: potentialDuplicate.channelId,
          buttons: potentialDuplicate.buttons.map(b => ({ text: b.text, value: b.value })),
          callbackId: potentialDuplicate.callbackId || potentialDuplicate.messageTs,
          isDuplicate: true,
          message: "Used existing button message to prevent duplicate"
        };
      }
    }
    
    // Generate a random actionPrefix if not provided
    const actionPrefix = args.actionPrefix || `btn_${Date.now().toString()}_${Math.floor(Math.random() * 1000)}`;
    
    // Detailed logging for buttons parameter
    console.log('⚠️ Buttons parameter type:', typeof buttons);
    if (typeof buttons === 'string') {
      console.log('⚠️ Buttons parameter is a string, will attempt to parse');
    } else if (Array.isArray(buttons)) {
      console.log('⚠️ Buttons parameter is already an array with', buttons.length, 'items');
    } else {
      console.log('⚠️ Buttons parameter is neither a string nor an array:', buttons);
      
      // Special case - check if the entire args.text is a JSON string that might contain button definitions
      if (typeof text === 'string' && (text.includes('"buttons"') || text.includes('"tool"'))) {
        console.log('⚠️ Trying to extract buttons from text parameter');
        
        try {
          // Try to find a JSON object in text that might have buttons
          const jsonMatches = text.match(/\{[\s\S]*?\}/g);
          if (jsonMatches && jsonMatches.length > 0) {
            for (const match of jsonMatches) {
              try {
                const parsedJson = JSON.parse(match);
                
                // Check if this has buttons or is a nested tool call
                if (Array.isArray(parsedJson.buttons)) {
                  console.log('✅ Found buttons array in text parameter JSON');
                  args.buttons = parsedJson.buttons;
                  buttons = parsedJson.buttons; // Update our local variable
                  // Also update title and text if they exist
                  if (parsedJson.title && !args.title) {
                    args.title = parsedJson.title;
                    title = parsedJson.title;
                  }
                  if (parsedJson.text && args.text === match) {
                    args.text = parsedJson.text;
                    text = parsedJson.text;
                  }
                  break;
                } else if (parsedJson.parameters && Array.isArray(parsedJson.parameters.buttons)) {
                  console.log('✅ Found nested buttons array in text parameter JSON');
                  args.buttons = parsedJson.parameters.buttons;
                  buttons = parsedJson.parameters.buttons; // Update our local variable
                  // Also update title and text if they exist
                  if (parsedJson.parameters.title && !args.title) {
                    args.title = parsedJson.parameters.title;
                    title = parsedJson.parameters.title;
                  }
                  if (parsedJson.parameters.text && args.text === match) {
                    args.text = parsedJson.parameters.text;
                    text = parsedJson.parameters.text;
                  }
                  break;
                }
              } catch (e) {
                console.log(`Failed to parse potential JSON match: ${e.message}`);
              }
            }
          }
        } catch (e) {
          console.log(`Failed to extract buttons from text: ${e.message}`);
        }
      }
    }
    
    // Add callback_id to each button for tracking
    const actionsWithCallbackId = buttons.map((button, index) => {
      // Create a unique action ID that encodes the necessary tracking info
      const actionId = `${actionPrefix}_${index}`;
      
      // Store the metadata mapping in thread state for reference when button is clicked
      if (!threadState.buttonMetadataMap) {
        threadState.buttonMetadataMap = {};
      }
      
      // Store the metadata mapped to the action_id
      threadState.buttonMetadataMap[actionId] = {
        callbackId: actionPrefix,
        buttonIndex: index,
        threadTs: threadTs || context?.threadTs,
        channelId,
        userId: context?.userId
      };
      
      return {
        text: button.text || `Button ${index + 1}`,
        value: button.value || `${index}`,
        action_id: actionId
      };
    });
    
    // Format the message with buttons
    // Instead of using formatSlackMessage which puts buttons in attachments,
    // let's build the blocks directly for better handling of buttons
    let blocks = [];
    
    // Add header if title is provided
    if (title) {
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: title,
          emoji: true
        }
      });
    }
    
    // Add section with text if provided
    if (text) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: text
        }
      });
    }
    
    // Add buttons as actions block
    blocks.push({
      type: 'actions',
      elements: actionsWithCallbackId.map(button => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: button.text,
          emoji: true
        },
        value: button.value,
        action_id: button.action_id,
        style: button.style || undefined
      }))
    });
    
    // Create an attachment with the color bar
    const attachment = {
      color: color,
      blocks: blocks,
      fallback: title || text || "Button message"
    };
    
    // Prepare message options using attachments for color bar
    const messageOptions = {
      channel: channelId,
      text: " ",  // Use empty space character instead of duplicating text
      attachments: [attachment]
    };
    
    // Add thread_ts if provided or from thread context
    const threadTimestamp = threadTs || context?.threadTs;
    if (threadTimestamp) {
      messageOptions.thread_ts = threadTimestamp;
    }
    
    // Debug logging
    console.log('BUTTON MESSAGE - Message structure:');
    console.log(JSON.stringify({
      hasText: !!messageOptions.text,
      textLength: messageOptions.text?.length,
      hasAttachments: !!messageOptions.attachments && messageOptions.attachments.length > 0,
      attachmentCount: messageOptions.attachments?.length || 0,
      blockCount: messageOptions.attachments?.[0]?.blocks?.length || 0,
      buttonCount: messageOptions.attachments?.[0]?.blocks?.find(b => b.type === 'actions')?.elements?.length || 0
    }, null, 2));
    
    console.log('BUTTON MESSAGE - Full message to be sent:');
    console.log(JSON.stringify(messageOptions, null, 2));
    
    // Send the message
    const response = await slackClient.chat.postMessage(messageOptions);
    
    // Store button metadata in thread state for later retrieval
    if (!threadState.buttonRegistry) {
      threadState.buttonRegistry = {};
    }
    
    // Register this set of buttons
    threadState.buttonRegistry[actionPrefix] = {
      buttons,
      messageTs: response.ts,
      threadTs: threadTimestamp,
      channelId,
      userId: context?.userId,
      timestamp: new Date().toISOString(),
      title,  // Store title for duplicate detection
      text    // Store text for duplicate detection
    };
    
    // Also register each button's specific action ID for easier lookup
    actionsWithCallbackId.forEach((button, index) => {
      const specificActionId = button.action_id;
      threadState.buttonRegistry[specificActionId] = {
        actionPrefix,
        buttonIndex: index,
        text: button.text,
        value: button.value,
        messageTs: response.ts,
        threadTs: threadTimestamp,
        channelId,
        timestamp: new Date().toISOString()
      };
    });
    
    console.log(`Registered button set with action prefix: ${actionPrefix} and ${actionsWithCallbackId.length} individual buttons`);
    
    // Add metadata to button state for reference
    if (typeof threadState.setButtonState === 'function') {
      buttons.forEach(option => {
        const buttonId = `${actionPrefix}:${option.value}`;
        threadState.setButtonState(buttonId, 'active', {
          label: option.label || option.value,
          value: option.value,
          threadTs: threadTimestamp,
          timestamp: response.ts,
          userId: context?.userId
        });
      });
    } else {
      console.log('⚠️ Warning: threadState.setButtonState is not a function - button states will not be saved');
    }
    
    // Return information about the created message
    return {
      messageTs: response.ts,
      channelId: response.channel,
      actionId: actionPrefix,
      options: buttons.map(option => ({
        label: option.label || option.value,
        value: option.value,
        actionId: `${actionPrefix}:${option.value}`
      })),
      metadata: {
        userId: context?.userId,
        threadTs: threadTimestamp
      }
    };
  } catch (error) {
    logError('Error creating button message', error, { args });
    throw error;
  }
}

module.exports = {
  createButtonMessage
}; 