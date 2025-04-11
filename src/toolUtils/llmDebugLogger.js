/**
 * llmDebugLogger.js
 * 
 * A specialized logger for LLM interactions that provides clear, structured 
 * output to simplify debugging of LLM context and responses.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class LlmDebugLogger {
  constructor(options = {}) {
    // Always enable in development, or when explicitly set
    const nodeEnv = process.env.NODE_ENV || 'development';
    this.enabled = nodeEnv !== 'production' || process.env.DEBUG_LLM === 'true' || options.enabled || true;
    this.logToFile = process.env.LLM_LOG_TO_FILE === 'true' || options.logToFile || false;
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.truncateContent = false; // Don't truncate content for debugging
    this.truncateLength = options.truncateLength || 500; // Increase truncate length if needed
    
    // Create log directory if logging to file is enabled
    if (this.logToFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // Log that we're in debug mode
    if (this.enabled) {
      logger.info('LLM Debug Logging is ENABLED');
    }
  }
  
  /**
   * Log an LLM request
   * @param {string} threadId - Thread ID for the request
   * @param {Object} requestData - The request data
   */
  logRequest(threadId, requestData) {
    if (!this.enabled) return;
    
    const timestamp = new Date().toISOString();
    const messages = requestData.messages || [];
    const tools = requestData.tools || [];
    
    console.log('\n');
    logger.info('======== LLM REQUEST ========');
    logger.info(`Thread: ${threadId}`);
    logger.info(`Time: ${timestamp}`);
    logger.info(`Messages: ${messages.length}`);
    logger.info(`Tools: ${tools.length}`);
    
    // Log message summary (not every detail)
    if (messages.length > 0) {
      messages.slice(0, 3).forEach((msg, idx) => {
        const contentPreview = typeof msg.content === 'string' && msg.content.length > 200 ?
          msg.content.substring(0, 200) + '...' :
          (typeof msg.content === 'string' ? msg.content : '[structured content]');
        
        logger.info(`[${idx}/${messages.length}] ${msg.role}: ${contentPreview}`);
        
        // For metadata just show keys, not values
        if (msg.metadata && Object.keys(msg.metadata).length > 0) {
          logger.info(`    Metadata: ${Object.keys(msg.metadata).join(', ')}`);
        }
      });
      
      if (messages.length > 3) {
        logger.info(`... and ${messages.length - 3} more messages`);
      }
    }
    
    // Just log tool names
    if (tools.length > 0) {
      logger.info(`Available tools: ${tools.map(t => t.function?.name || 'unnamed').join(', ')}`);
    }
    
    // Log to file if enabled
    if (this.logToFile) {
      this.writeToFile(threadId, 'request', {
        timestamp,
        threadId,
        request: {
          messages,
          tools
        }
      });
    }
  }
  
  /**
   * Log an LLM response
   * @param {string} threadId - Thread ID for the response
   * @param {Object} response - The LLM response object
   */
  logResponse(threadId, response) {
    if (!this.enabled) return;
    
    const timestamp = new Date().toISOString();
    const message = response.choices?.[0]?.message || {};
    const toolCalls = message.tool_calls || [];
    
    console.log('\n');
    logger.info('======== LLM RESPONSE ========');
    logger.info(`Thread: ${threadId}`);
    logger.info(`Time: ${timestamp}`);
    logger.info(`Tool calls: ${toolCalls.length}`);
    
    if (toolCalls.length > 0) {
      toolCalls.forEach((call, idx) => {
        const toolName = call.function?.name || 'unknown';
        const args = call.function?.arguments || '{}';
        logger.info(`[${idx}] Tool: ${toolName}`);
        
        try {
          const parsedArgs = JSON.parse(args);
          const reasoning = parsedArgs.reasoning ? 
            `"${this.truncateString(parsedArgs.reasoning, 50)}"` : 'none';
          
          // Log key arguments but summarized
          const argKeys = Object.keys(parsedArgs).filter(k => k !== 'reasoning');
          const argSummary = argKeys.length <= 3 ? 
            argKeys.map(k => `${k}: "${this.truncateString(String(parsedArgs[k]), 30)}"`).join(', ') :
            `${argKeys.slice(0, 3).map(k => `${k}: "..."`).join(', ')}, ... (${argKeys.length - 3} more)`;
          
          logger.info(`    Args: reasoning: ${reasoning}, ${argSummary}`);
        } catch (e) {
          // For unparseable arguments, show a truncated preview
          logger.info(`    Args (unparsed): ${this.truncateString(args, 100)}`);
        }
      });
    }
    
    // Print content if present (truncated for readability)
    if (message.content) {
      const contentPreview = message.content.length > 100 ? 
        message.content.substring(0, 100) + '...' : message.content;
      logger.info(`Content: ${contentPreview}`);
    }
    
    // Log model information and token usage
    if (response.model) {
      logger.info(`Model: ${response.model}`);
    }
    
    if (response.usage) {
      logger.info(`Tokens: ${response.usage.total_tokens} (prompt: ${response.usage.prompt_tokens}, completion: ${response.usage.completion_tokens})`);
    }
    
    // Log to file if enabled
    if (this.logToFile) {
      this.writeToFile(threadId, 'response', {
        timestamp,
        threadId,
        response: {
          model: response.model,
          toolCalls: toolCalls.map(call => ({
            name: call.function?.name,
            args: call.function?.arguments
          })),
          content: message.content,
          usage: response.usage
        }
      });
    }
  }
  
  /**
   * View the complete raw message content for debugging
   * @param {Array} messages - Messages to show
   * Truncate a string to a specified length
   * @param {string} str - String to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} - Truncated string
   */
  truncateString(str, maxLength) {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }
  
  /**
   * Write data to a log file
   * @param {string} threadId - Thread ID
   * @param {string} type - Type of log ('request' or 'response')
   * @param {Object} data - Data to log
   */
  writeToFile(threadId, type, data) {
    try {
      const fileName = `${threadId.replace(/\./g, '-')}_${type}_${Date.now()}.json`;
      const filePath = path.join(this.logDir, fileName);
      
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      logger.error(`Failed to write LLM log to file: ${error.message}`);
    }
  }
}

// Create and export a singleton instance
const llmDebugLogger = new LlmDebugLogger();

module.exports = llmDebugLogger; 