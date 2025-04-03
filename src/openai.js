/**
 * OpenAI API interface for making requests to the LLM
 */

const { LLM_API_KEY, LLM_API_URL, LLM_MODEL } = require('./config.js');
const { logError } = require('./errors.js');
const fetch = require('node-fetch');
const logger = require('./toolUtils/logger.js');


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
                requestBody.tool_choice = "required";
            }
            
            logger.info(`Tool choice: ${typeof requestBody.tool_choice === 'object' ? 
                JSON.stringify(requestBody.tool_choice) : requestBody.tool_choice}`);
        }
        
        // Log request details
        logger.info(`Using model: ${model}`);
        logger.info(`API URL: ${LLM_API_URL || 'https://api.openai.com/v1/chat/completions'}`);
        logger.info(`Tools provided: ${params.tools ? params.tools.length : 0}`);

        // Log detailed message information
        logger.info(`🔍 MESSAGE DETAILS:`);
        params.messages.forEach((msg, idx) => {
            // For system messages, just log that they exist without showing content in chunks
            if (msg.role === 'system') {
                logger.info(`[${idx}] ${msg.role}: ${msg.content ? 
                    (msg.name ? `[${msg.name}] ` : '') + 
                    (msg.content.length > 50 ? 
                        msg.content.substring(0, 50) + '... ' : 
                        msg.content) + 
                    `(${msg.content.length} chars)` : 
                    '[No content]'}`);
            } else {
                // For non-system messages, log as normal
                logger.info(`[${idx}] ${msg.role}: ${msg.content ? 
                    (msg.content.length > 50 ? 
                        msg.content.substring(0, 50) + '...' : 
                        msg.content) : 
                    '[No content]'}`);
            }
        });
        
        // // Log tool names if available
        // if (params.tools && params.tools.length) {
        //     logger.info(`🧰 AVAILABLE TOOLS (${params.tools.length}):`);
        //     params.tools.forEach((tool, idx) => {
        //         logger.info(`[${idx}] ${tool.function.name}: ${tool.function.description?.substring(0, 100)}${tool.function.description?.length > 100 ? '...' : ''}`);
        //     });
        // }
        
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
        
        // Enhanced console logging of response
        logger.info(`📄 LLM RESPONSE SUMMARY:`);
        if (data.choices && data.choices.length > 0) {
            const choice = data.choices[0];
            if (choice.message) {
                // Log content if present
                if (choice.message.content) {
                    logger.info(`Content: ${choice.message.content.substring(0, 100)}${choice.message.content.length > 100 ? '...' : ''}`);
                    
                    // For longer content, just log the length and first chunk
                    if (choice.message.content.length > 200) {
                        logger.info(`Full content omitted (${choice.message.content.length} chars, ${Math.ceil(choice.message.content.length / 200)} chunks)`);
                        
                        // Only show first chunk as preview if in verbose mode
                        if (process.env.VERBOSE_LOGGING === 'true') {
                            logger.info(`[Preview] ${choice.message.content.substring(0, 200)}...`);
                        }
                    }
                }
                
                // Log tool calls if present
                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    logger.info(`Tool calls: ${choice.message.tool_calls.length}`);
                    choice.message.tool_calls.forEach((tc, idx) => {
                        if (tc.function) {
                            logger.info(`[${idx}] Tool: ${tc.function.name}`);
                            logger.info(`    Arguments (${tc.function.arguments ? tc.function.arguments.length + ' bytes' : 'none'})`);
                            
                            // Try to parse and log a preview of the arguments
                            try {
                                const args = JSON.parse(tc.function.arguments);
                                // Extract and show reasoning separately as it's most important
                                const reasoning = args.reasoning ? `reasoning: "${args.reasoning}"` : "no reasoning";
                                // Show a compact version of the remaining arguments
                                const otherArgs = Object.keys(args)
                                  .filter(key => key !== 'reasoning')
                                  .map(key => `${key}: ${typeof args[key] === 'object' ? 
                                    `{${Object.keys(args[key]).length} keys}` : 
                                    JSON.stringify(args[key]).substring(0, 30) + 
                                    (JSON.stringify(args[key]).length > 30 ? '...' : '')}`);
                                
                                logger.info(`    Args: ${reasoning}, ${otherArgs.join(', ')}`);
                                
                                // Only show full arguments in verbose mode
                                if (process.env.VERBOSE_LOGGING === 'true') {
                                    logger.info(`    Full args: ${JSON.stringify(args, null, 2)}`);
                                }
                            } catch (e) {
                                // If parsing fails, just show a preview of the raw arguments
                                const preview = tc.function.arguments.substring(0, 150);
                                logger.info(`    Args (unparseable, ${tc.function.arguments.length} chars): ${preview}${tc.function.arguments.length > 150 ? '...' : ''}`);
                            }
                        }
                    });
                } else {
                    logger.info(`No tool calls found in response`);
                }
            } else {
                logger.info(`No message in response`);
            }
        } else {
            logger.info(`No choices in response`);
        }
        
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

module.exports = {
    callOpenAI
}; 