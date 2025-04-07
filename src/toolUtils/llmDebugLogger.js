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
    this.enabled = process.env.DEBUG_LLM === 'true' || options.enabled || false;
    this.logToFile = process.env.LLM_LOG_TO_FILE === 'true' || options.logToFile || false;
    this.logDir = options.logDir || path.join(process.cwd(), 'logs');
    this.truncateContent = options.truncateContent !== false; // Default true
    this.truncateLength = options.truncateLength || 100;
    
    // Create log directory if logging to file is enabled
    if (this.logToFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  /**
   * Log an LLM request context (what's being sent to the LLM)
   * @param {string} threadId - Thread ID for the request
   * @param {Array} messages - Messages being sent to the LLM
   * @param {Array} tools - Tools being provided to the LLM
   */
  logRequest(threadId, messages, tools) {
    if (!this.enabled) return;
    
    const toolNames = tools.map(t => t.function?.name || t.name).join(', ');
    const timestamp = new Date().toISOString();
    
    // Generate a clear, tabular view of the messages
    console.log('\n');
    logger.info('======== LLM REQUEST ========');
    logger.info(`Thread: ${threadId}`);
    logger.info(`Time: ${timestamp}`);
    logger.info(`Tools provided: ${tools.length} (${toolNames})`);
    logger.info(`Message count: ${messages.length}`);
    
    console.log('\n┌───────┬──────────┬──────────────────────────────────────────────┐');
    console.log('│ INDEX │   ROLE    │ CONTENT                                      │');
    console.log('├───────┼──────────┼──────────────────────────────────────────────┤');
    
    messages.forEach((msg, idx) => {
      const role = (msg.role || 'unknown').padEnd(10);
      const content = this.truncateContent 
        ? this.truncateString(msg.content, this.truncateLength)
        : msg.content;
      
      console.log(`│ ${String(idx).padEnd(5)} │ ${role} │ ${content.padEnd(45)} │`);
    });
    
    console.log('└───────┴──────────┴──────────────────────────────────────────────┘\n');
    
    // Log to file if enabled
    if (this.logToFile) {
      this.writeToFile(threadId, 'request', {
        timestamp,
        threadId,
        messageCount: messages.length,
        toolCount: tools.length,
        toolNames,
        messages,
        tools: tools.map(t => ({name: t.function?.name || t.name})) // Just the names to avoid huge files
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
        logger.info(`    Arguments (${args.length} bytes)`);
        
        try {
          const parsedArgs = JSON.parse(args);
          if (parsedArgs.reasoning) {
            logger.info(`    Args: reasoning: "${parsedArgs.reasoning}", ${
              Object.entries(parsedArgs)
                .filter(([key]) => key !== 'reasoning')
                .slice(0, 3)
                .map(([k, v]) => `${k}: "${this.truncateString(String(v), 20)}"`)
                .join(', ')
            }...`);
          }
        } catch (e) {
          logger.info(`    Args: ${this.truncateString(args, 50)}`);
        }
      });
    }
    
    // Print content if present
    if (message.content) {
      logger.info(`Content: ${this.truncateString(message.content, 50)}`);
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