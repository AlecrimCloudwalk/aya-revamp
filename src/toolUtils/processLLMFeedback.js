// Tool for processing LLM feedback for button clicks
const { getSlackClient } = require('../slackClient.js');

/**
 * Process LLM feedback in the thread state
 * This tool allows passing button click and selection information to the LLM
 * 
 * @param {Object} args - The tool arguments
 * @param {Object} threadState - The thread state
 * @returns {Promise<Object>} The result of the operation
 */
async function processLLMFeedback(args, threadState) {
  try {
    console.log(`🔄 Processing LLM feedback`);
    
    // Get any stored LLM feedback from thread state
    const feedback = threadState.llmFeedback || [];
    
    if (feedback.length === 0) {
      console.log(`No LLM feedback found in thread state`);
      return {
        processed: false,
        message: "No feedback available to process",
        feedbackCount: 0
      };
    }
    
    // Get button selection information if available
    const selectedButton = threadState.getMetadata ? 
      threadState.getMetadata('selectedButton') : 
      threadState.selectedButton;
    
    // Log all feedback for debugging
    console.log(`📋 Found ${feedback.length} feedback items in thread state:`);
    feedback.forEach((item, index) => {
      console.log(`- Feedback ${index+1}: Type=${item.type}, Message="${item.message}"`);
    });
    
    // Process button selection feedback specifically
    const buttonFeedback = feedback.filter(item => item.type === 'buttonSelected');
    if (buttonFeedback.length > 0) {
      console.log(`📲 Found ${buttonFeedback.length} button selection feedback items`);
      
      // Get the most recent button selection
      const latestButtonFeedback = buttonFeedback[buttonFeedback.length - 1];
      console.log(`Most recent button selection: "${latestButtonFeedback.message}"`);
      
      if (selectedButton) {
        console.log(`Selected button value: ${selectedButton.value}`);
      }
    }
    
    // Mark feedback as processed by clearing the array
    threadState.llmFeedback = [];
    
    // Prepare guidance based on what feedback we found
    let guidance = "";
    if (buttonFeedback.length > 0) {
      // Check if the button selection has already been visually acknowledged
      if (threadState.buttonSelectionAlreadyAcknowledged) {
        // The message has already been updated to show the selection visually
        guidance = `IMPORTANT: The user clicked the "${latestButtonFeedback.value}" button. The original message UI has ALREADY been updated to show a confirmation (✅ Opção selecionada). DO NOT post another acknowledgment message about this selection - continue the conversation directly with the next logical step related to their "${latestButtonFeedback.value}" choice.`;
      } else {
        // Standard guidance for when button hasn't been visually updated
        guidance = `IMPORTANT: The user clicked a button (${selectedButton?.value || 'unknown value'}). The original message has ALREADY been updated to show their selection. Do NOT try to update it again with updateMessage or updateButtonMessage. Instead, send a NEW message acknowledging their choice.`;
      }
    }
    
    return {
      processed: true,
      message: "Feedback processed successfully",
      feedbackCount: feedback.length,
      feedback: feedback,
      buttonSelections: buttonFeedback.length,
      selectedButton: selectedButton,
      guidance: guidance
    };
  } catch (error) {
    console.error(`Error processing LLM feedback: ${error.message}`);
    
    return {
      processed: false,
      error: error.message
    };
  }
}

module.exports = processLLMFeedback; 