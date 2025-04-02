/**
 * OpenAI API interface for making requests to the LLM
 */

const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError } = require('./errors.js');
const fetch = require('node-fetch');

/**
 * Calls the OpenAI API with the given parameters
 * @param {Object} params - Parameters for the OpenAI call
 * @param {Array<{role: string, content: string}>} params.messages - Messages to send to the API
 * @param {Array} [params.tools] - Tools to include in the API call
 * @param {string|Object} [params.tool_choice] - Whether to force a tool choice
 * @returns {Promise<Object>} - The OpenAI API response
 */
async function callOpenAI(params) {
    try {
        console.log(`Calling OpenAI with ${params.messages.length} messages`);
        
        // Default to the environment model if not provided
        const model = params.model || LLM_MODEL || 'gpt-3.5-turbo';
        
        // Build request body
        const requestBody = {
            model,
            messages: params.messages,
            temperature: params.temperature || 0.7,
        };
        
        // Handle tools and tool_choice according to OpenAI's latest API
        if (params.tools && params.tools.length > 0) {
            // Tools are already in the correct format from the tool registry
            requestBody.tools = params.tools;
            
            // Handle tool_choice parameter
            if (params.tool_choice) {
                // If it's an object with name, format it correctly
                if (typeof params.tool_choice === 'object' && params.tool_choice.name) {
                    requestBody.tool_choice = {
                        type: "function",
                        function: {
                            name: params.tool_choice.name
                        }
                    };
                } else {
                    // If it's a string like "auto" or "required", use as is
                    requestBody.tool_choice = params.tool_choice;
                }
            } else {
                // Default to "auto" per documentation recommendation
                requestBody.tool_choice = "auto";
            }
            
            console.log(`Tool choice: ${typeof requestBody.tool_choice === 'object' ? 
                JSON.stringify(requestBody.tool_choice) : requestBody.tool_choice}`);
        }
        
        // Log request details
        console.log(`Using model: ${model}`);
        console.log(`API URL: ${LLM_API_URL || 'https://api.openai.com/v1/chat/completions'}`);
        console.log(`Tools provided: ${params.tools ? params.tools.length : 0}`);
        
        // Make request to OpenAI API
        const response = await fetch(
            LLM_API_URL || 'https://api.openai.com/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LLM_API_KEY}`
                },
                body: JSON.stringify(requestBody)
            }
        );
        
        // Parse response
        const data = await response.json();
        
        // Check for errors
        if (!response.ok) {
            console.error('OpenAI API error:', data);
            throw new Error(`OpenAI API error: ${data.error?.message || 'Unknown error'}`);
        }
        
        // Log total tokens used
        if (data.usage) {
            console.log(`Tokens used: ${data.usage.total_tokens} (prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens})`);
        }
        
        return data;
    } catch (error) {
        console.error('Error calling OpenAI:', error);
        logError('Error calling OpenAI', error);
        throw error;
    }
}

module.exports = {
    callOpenAI
}; 