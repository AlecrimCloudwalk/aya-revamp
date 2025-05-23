class ThreadState {
    constructor(threadId) {
        this.threadId = threadId;
        this.sentMessages = new Set();
        this.buttonStates = new Map();
        this.toolResults = new Map();
        this.metadata = new Map();
        this.messages = [];
        
        // Extract channel ID from threadId if possible
        // The threadId might be in format channelId:timestamp or just a channelId
        if (threadId && (threadId.startsWith('C') || threadId.startsWith('D'))) {
            if (threadId.includes(':')) {
                this.channelId = threadId.split(':')[0];
            } else {
                this.channelId = threadId;
            }
        }
    }

    /**
     * Get the channel ID for this thread
     * @returns {string|null} - The channel ID or null if not available
     */
    getChannel() {
        // Try to get from metadata.context first (most reliable)
        const context = this.getMetadata('context');
        if (context && context.channelId) {
            return context.channelId;
        }
        
        // Fall back to the property
        return this.channelId || null;
    }

    recordToolExecution(toolName, args, result, error = null) {
        const executionKey = `${toolName}-${JSON.stringify(args)}`;
        const executionRecord = {
            result,
            timestamp: new Date().toISOString(),
            error: error ? {
                message: error.message,
                stack: error.stack,
                name: error.name
            } : null
        };
        
        this.toolResults.set(executionKey, executionRecord);
        
        // Track messages
        if (toolName === 'postMessage' && result?.ts) {
            this.sentMessages.add(result.ts);
        }

        // Track button messages
        if (toolName === 'createButtonMessage' && result?.actionId) {
            this.buttonStates.set(result.actionId, {
                state: 'active',
                metadata: result.metadata
            });
        }
    }

    /**
     * Sets a tool result directly without using the execution key format
     * Useful for storing errors and other information without executing a tool
     * @param {string} key - The key to store the result under
     * @param {any} value - The value to store
     */
    setToolResult(key, value) {
        this.toolResults.set(key, {
            result: value,
            timestamp: new Date().toISOString(),
            error: null
        });
    }

    hasExecuted(toolName, args) {
        const executionKey = `${toolName}-${JSON.stringify(args)}`;
        return this.toolResults.has(executionKey);
    }

    getToolResult(toolName, args) {
        const executionKey = `${toolName}-${JSON.stringify(args)}`;
        const executionRecord = this.toolResults.get(executionKey);
        
        // Handle the case where we've migrated to the new format
        if (executionRecord && typeof executionRecord === 'object' && 'result' in executionRecord) {
            return executionRecord.result;
        }
        
        // For backward compatibility with old format
        return executionRecord;
    }

    // Button specific methods
    getButtonState(actionId) {
        return this.buttonStates.get(actionId);
    }

    setButtonState(actionId, state, metadata = null) {
        this.buttonStates.set(actionId, { state, metadata });
    }

    // General metadata methods
    setMetadata(key, value) {
        this.metadata.set(key, value);
        
        // If this is context metadata, also set channel property for easy access
        if (key === 'context' && value && value.channelId) {
            this.channelId = value.channelId;
        }
    }

    getMetadata(key) {
        return this.metadata.get(key);
    }

    // Get thread timestamp for replies
    getThreadTs() {
        // Check if we have context with threadTs
        const context = this.getMetadata('context');
        if (context && context.threadTs) {
            return context.threadTs;
        }
        
        // If threadId contains a timestamp part, use that
        if (this.threadId && this.threadId.includes(':')) {
            return this.threadId.split(':')[1];
        }
        
        // Otherwise return threadId directly (might be a message ts)
        return this.threadId;
    }

    // Get state for LLM context
    getStateForLLM() {
        return {
            threadId: this.threadId,
            channelId: this.getChannel(),
            threadTs: this.getThreadTs(),
            sentMessagesCount: this.sentMessages.size,
            activeButtons: Array.from(this.buttonStates.entries())
                .filter(([_, data]) => data.state === 'active')
                .map(([actionId, data]) => ({
                    actionId,
                    metadata: data.metadata
                })),
            recentToolResults: Array.from(this.toolResults.entries())
                .slice(-5)  // Only show last 5 tool executions
                .map(([key, result]) => ({
                    execution: key,
                    success: !!result
                }))
        };
    }

    /**
     * Get execution history with timestamps and errors
     * @param {number} limit - Maximum number of executions to return
     * @returns {Array} - Array of execution records
     */
    getToolExecutionHistory(limit = 10) {
        // Convert the Map entries to an array and sort by timestamp (newest first)
        const executionEntries = Array.from(this.toolResults.entries())
            .map(([key, record]) => {
                // Parse the key to get toolName and args
                const keyParts = key.split('-');
                const toolName = keyParts[0];
                let args = {};
                
                try {
                    // Try to parse the args part of the key
                    const argsJson = key.substring(toolName.length + 1);
                    args = JSON.parse(argsJson);
                } catch (e) {
                    // If parsing fails, just use the raw string
                    args = { raw: key.substring(toolName.length + 1) };
                }
                
                // Handle old format records (pre-update)
                let processedRecord = record;
                if (record && typeof record === 'object' && !('timestamp' in record)) {
                    processedRecord = {
                        result: record,
                        timestamp: new Date(0).toISOString(), // Default to epoch start
                        error: null
                    };
                }
                
                return {
                    toolName,
                    args,
                    ...processedRecord,
                    key
                };
            })
            .sort((a, b) => {
                // Sort by timestamp, newest first
                return new Date(b.timestamp) - new Date(a.timestamp);
            })
            .slice(0, limit); // Limit the number of entries
            
        return executionEntries;
    }
}

// Thread state storage
const threadStates = new Map();

function getThreadState(threadId) {
    if (!threadStates.has(threadId)) {
        threadStates.set(threadId, new ThreadState(threadId));
    }
    return threadStates.get(threadId);
}

module.exports = {
    ThreadState,
    getThreadState
}; 