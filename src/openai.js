/**
 * OpenAI API interface for making requests to the LLM
 */

const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError } = require('./errors.js');
const fetch = require('node-fetch');
const logger = require('./toolUtils/logger.js');
const llmDebugLogger = require('./toolUtils/llmDebugLogger.js');


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
        logger.info(`Calling OpenAI with ${params.messages.length} messages`);
        
        // Default to the environment model if not provided
        const model = params.model || LLM_MODEL || 'gpt-3.5-turbo';
        
        // Build request body
        const requestBody = {
            model,
            messages: params.messages,
            temperature: params.temperature || 0.7,
        };
        
        // Extract threadId for logging
        const threadId = extractThreadId(params);
        
        // Handle tools and tool_choice according to OpenAI's latest API
        if (params.tools && params.tools.length > 0) {
            // Log tool schemas for debugging
            logger.info(`Providing ${params.tools.length} tools to OpenAI API`);

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
                requestBody.tool_choice = "required";
            }
            
            logger.info(`Tool choice: ${typeof requestBody.tool_choice === 'object' ? 
                JSON.stringify(requestBody.tool_choice) : requestBody.tool_choice}`);
        }
        
        // Log request details
        logger.info(`Using model: ${model}`);
        logger.info(`API URL: ${LLM_API_URL || 'https://api.openai.com/v1/chat/completions'}`);
        
        // Enhanced logging: log full messages and request body
        logger.info('=== FULL MESSAGES BEING SENT TO LLM ===');
        logger.info(JSON.stringify(params.messages, null, 2));
        logger.info('=== FULL REQUEST BODY ===');
        
        // Create a modified request body with truncated system messages and only include messages
        const loggingRequestBody = {
            messages: requestBody.messages.map(msg => {
                if (msg.role === 'system' && msg.content.length > 100) {
                    return {
                        ...msg,
                        content: msg.content.substring(0, 100) + '...'
                    };
                }
                return msg;
            })
        };
        
        logger.info(JSON.stringify(loggingRequestBody, null, 2));
        
        // Use the new llmDebugLogger for comprehensive request logging
        llmDebugLogger.logRequest(threadId, params);
        
        // Track the start time for performance monitoring
        const startTime = Date.now();
        
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
        
        // Enhanced response logging
        logger.info('=== FULL OPENAI API RESPONSE ===');
        logger.info(JSON.stringify(data, null, 2));
        
        // Use the new llmDebugLogger for comprehensive response logging
        llmDebugLogger.logResponse(threadId, data);
       
        // Check for errors
        if (!response.ok) {
            logger.error('OpenAI API error:', data);
            throw new Error(`OpenAI API error: ${data.error?.message || 'Unknown error'}`);
        }
        
        // Log total tokens used
        if (data.usage) {
            logger.info(`Tokens used: ${data.usage.total_tokens} (prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens})`);
        }
        
        return data;
    } catch (error) {
        logger.error('Error calling OpenAI:', error);
        logError('Error calling OpenAI', error);
        throw error;
    }
}

/**
 * Extract thread ID from the request parameters for logging purposes
 * @param {Object} params - Request parameters
 * @returns {string} - Thread ID or "unknown-thread"
 */
function extractThreadId(params) {
    // Try to extract from messages
    if (params.messages && params.messages.length > 0) {
        // Check if any message contains thread_ts in its metadata
        for (const msg of params.messages) {
            // Check for common thread identifiers in various formats
            if (msg.metadata?.threadTs) return msg.metadata.threadTs;
            if (msg.metadata?.thread_ts) return msg.metadata.thread_ts;
            if (msg.threadTs) return msg.threadTs;
            if (msg.thread_ts) return msg.thread_ts;
            
            // Try to extract from content if it's a string with patterns like "thread: 123456.789"
            if (typeof msg.content === 'string') {
                const threadMatch = msg.content.match(/thread(?:Ts|_ts|Id|_id|):\s*([0-9]+\.[0-9]+)/i);
                if (threadMatch && threadMatch[1]) return threadMatch[1];
            }
        }
    }
    
    // If thread ID not found, return default
    return `unknown-thread-${Date.now()}`;
}

module.exports = {
    callOpenAI
}; 