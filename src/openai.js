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
 * @param {string} [params.tool_choice] - Whether to force a tool choice
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
            // Include tools if provided
            ...(params.tools && { tools: params.tools }),
            ...(params.tool_choice && { tool_choice: params.tool_choice }),
            // Force JSON response format when using tools
            ...(params.tools && { response_format: { type: "json_object" } })
        };
        
        // Log request details
        console.log(`Using model: ${model}`);
        console.log(`API URL: ${LLM_API_URL || 'https://api.openai.com/v1/chat/completions'}`);
        
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