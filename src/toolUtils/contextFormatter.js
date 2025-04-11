/**
 * Context Formatter - Utility for formatting LLM context JSON for console display
 * 
 * This module provides formatting functions for the new JSON-based context format,
 * allowing better visualization in console logs for debugging purposes.
 */

// Both symbols and emojis for different message types (fallback for PowerShell compatibility)
const SYMBOLS = {
  system: '[SYS]',
  user: '[USER]',
  assistant: '[ASST]',
  time: '[TIME]',
  toolCalls: {
    getThreadHistory: '[HIST]',
    postMessage: '[MSG]',
    finishRequest: '[DONE]',
    default: '[TOOL]'
  },
  reasoningPrefix: '|-- '
};

// Emojis for platforms that support them
const EMOJIS = {
  system: '🧠',
  user: '👤',
  assistant: '🤖',
  time: '🕐',
  toolCalls: {
    getThreadHistory: '🔧',
    postMessage: '💬',
    finishRequest: '✅',
    default: '🔧'
  },
  reasoningPrefix: '└─ '
};

// Check if we should use emojis or ASCII symbols (try to detect PowerShell/Windows)
const USE_EMOJIS = process.env.FORCE_ASCII !== 'true' && 
                  !(process.platform === 'win32' && 
                    (process.env.SHELL?.toLowerCase()?.includes('powershell') || 
                     process.env.TERM_PROGRAM?.toLowerCase()?.includes('powershell')));

// Log the choice for debugging
if (process.env.DEBUG_FORMATTER === 'true') {
  console.log(`Using ${USE_EMOJIS ? 'emojis' : 'ASCII symbols'} for formatting`);
}

/**
 * Format the entire context array for console display
 * @param {Array} context - The context array in JSON format
 * @returns {string} Formatted context string for console display
 */
function formatContextForConsole(context) {
  if (!Array.isArray(context) || context.length === 0) {
    return 'Empty context';
  }

  return context.map(entry => formatContextEntry(entry)).join('\n\n');
}

/**
 * Format a single context entry for console display
 * @param {Object} entry - A single entry from the context array
 * @returns {string} Formatted entry string
 */
function formatContextEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return 'Invalid entry';
  }

  switch (entry.role) {
    case 'system':
      return formatSystemEntry(entry);
    case 'user':
      return formatUserEntry(entry);
    case 'assistant':
      return formatAssistantEntry(entry);
    default:
      return `Unknown role: ${entry.role}`;
  }
}

/**
 * Format a system message entry
 * @param {Object} entry - The system message entry
 * @returns {string} Formatted system message
 */
function formatSystemEntry(entry) {
  const prefix = USE_EMOJIS ? EMOJIS.system : SYMBOLS.system;
  
  // Check if the content is a complex object (conversation_stats or hints_and_suggestions)
  if (typeof entry.content === 'object' && entry.content !== null) {
    // Handle conversation stats object
    if (entry.content.type === 'conversation_stats') {
      const stats = entry.content.stats;
      return [
        `${prefix} System: CONVERSATION STATS`,
        `  Channel: ${stats.channel_info.channel} (DM: ${stats.channel_info.is_dm}, Thread: ${stats.channel_info.is_thread})`,
        `  Messages: ${stats.message_counts.total_messages} (${stats.message_counts.user_messages} user, ${stats.message_counts.bot_messages} bot)`,
        `  Initial message: ${stats.channel_info.is_initial_message}, Has mentions: ${stats.channel_info.has_mentions}`,
        `  Tool calls: ${stats.tool_usage.total_tool_calls} (Thread history: ${stats.tool_usage.thread_history_calls})`,
        `  Guidance: ${entry.content.guidance}`
      ].join('\n');
    }
    // Handle hints and suggestions object
    else if (entry.content.type === 'hints_and_suggestions') {
      const lines = [`${prefix} System: HINTS & SUGGESTIONS`];
      
      // Add warnings
      if (entry.content.warnings && entry.content.warnings.length > 0) {
        lines.push(`  Warnings:`);
        entry.content.warnings.forEach(warning => {
          lines.push(`    - ${warning}`);
        });
      }
      
      // Add next action suggestion
      if (entry.content.next_action) {
        lines.push(`  Next action: ${entry.content.next_action}`);
      }
      
      // Add whose turn it is
      if (entry.content.whose_turn) {
        lines.push(`  Turn: ${entry.content.whose_turn}'s turn to respond`);
      }
      
      return lines.join('\n');
    }
    // Handle other object types by converting to JSON
    else {
      return `${prefix} System: ${JSON.stringify(entry.content, null, 2)}`;
    }
  }
  
  // Handle string content (the regular case)
  return `${prefix} System: ${entry.content}`;
}

/**
 * Format a user message entry
 * @param {Object} entry - The user message entry
 * @returns {string} Formatted user message
 */
function formatUserEntry(entry) {
  const prefix = USE_EMOJIS ? EMOJIS.user : SYMBOLS.user;
  const timePrefix = USE_EMOJIS ? EMOJIS.time : SYMBOLS.time;
  const userId = entry.content.userid || 'unknown';
  const message = entry.content.text || '';
  
  return [
    `${prefix} User ${userId} [Turn ${entry.turn}]`,
    `${timePrefix} ${entry.timestamp}`,
    `> ${message}`
  ].join('\n');
}

/**
 * Format an assistant message entry (tool calls)
 * @param {Object} entry - The assistant message entry
 * @returns {string} Formatted assistant message
 */
function formatAssistantEntry(entry) {
  const prefix = USE_EMOJIS ? EMOJIS.assistant : SYMBOLS.assistant;
  const timePrefix = USE_EMOJIS ? EMOJIS.time : SYMBOLS.time;
  const reasoningPrefix = USE_EMOJIS ? EMOJIS.reasoningPrefix : SYMBOLS.reasoningPrefix;
  
  let result = [
    `${prefix} Assistant [Turn ${entry.turn}]`,
    `${timePrefix} ${entry.timestamp}`
  ];
  
  // Handle different content types properly
  if (typeof entry.content === 'string') {
    // Simple string content
    result.push(`${entry.content.substring(0, 100)}${entry.content.length > 100 ? '...' : ''}`);
  } else if (typeof entry.content === 'object' && entry.content !== null) {
    // Object content (likely a tool call)
    const toolCall = entry.content.toolCall || entry.content.tool;
    const reasoning = entry.content.reasoning;
    
    // Get appropriate emoji/symbol for this tool
    const toolSymbol = USE_EMOJIS 
      ? (EMOJIS.toolCalls[toolCall] || EMOJIS.toolCalls.default)
      : (SYMBOLS.toolCalls[toolCall] || SYMBOLS.toolCalls.default);
    
    // Format based on tool type
    if (toolCall === 'postMessage' || entry.content.text) {
      result.push(`${toolSymbol} ${toolCall || 'Message'}:`);
      result.push(`   "${entry.content.text || '[No message text]'}"`);
    } else {
      // Format other tool calls with any parameters
      const params = Object.entries(entry.content)
        .filter(([key]) => key !== 'toolCall' && key !== 'tool' && key !== 'reasoning')
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join(', ');
      
      result.push(`${toolSymbol} ${toolCall || 'Unknown tool'}${params ? ` (${params})` : ''}`);
    }
    
    // Add reasoning if present
    if (reasoning) {
      result.push(`   ${reasoningPrefix}Reason: ${reasoning}`);
    }
  } else {
    // Fallback for unexpected content type
    result.push(`[Unknown content format]`);
  }
  
  return result.join('\n');
}

/**
 * Log the context to console directly
 * @param {Array} context - The context array in JSON format
 * @param {string} label - Optional label for the log entry
 */
function logFormattedContext(context, label = 'LLM CONTEXT') {
  const formatted = formatContextForConsole(context);
  console.log(`\n${label}:\n${formatted}\n`);
}

module.exports = {
  formatContextForConsole,
  formatContextEntry,
  logFormattedContext,
  USE_EMOJIS
}; 