# LLM Debugging Guide

This document explains how to use the built-in LLM debugging tools to understand exactly what is being sent to and received from the LLM during conversations.

## Quick Start

Run the bot with debugging enabled:

```bash
# Basic debugging
npm run debug

# Verbose debugging with more details
npm run debug:verbose

# Save all LLM interactions to log files
npm run debug:file

# Maximum debugging (verbose + file logging + raw message content)
npm run debug:all

# ASCII mode for terminals with unicode display issues (Windows PowerShell)
npm run debug:ascii
```

## Understanding the Debug Output

When debugging is enabled, you'll see structured output showing:

1. **LLM REQUEST**: What's being sent to the LLM
   - Thread ID
   - Message count
   - Tabular view of all messages with their roles
   - Available tools

2. **LLM RESPONSE**: What's received from the LLM
   - Tool calls (if any)
   - Message content (if any)
   - Token usage statistics

3. **RAW MESSAGE CONTENT**: Complete unabridged message content (when using `--show-raw`)

## Environment Variables

You can customize debugging behavior with these environment variables:

| Variable | Description | Values |
|----------|-------------|--------|
| `DEBUG_LLM` | Enable LLM-specific debugging | `true`/`false` |
| `DEBUG_CONTEXT` | Enable context debugging | `true`/`false` |
| `LOG_LEVEL` | Level of detail in logs | `QUIET`, `NORMAL`, `VERBOSE`, `DEBUG` |
| `SHOW_DETAILS` | Show detailed object structures | `true`/`false` |
| `LLM_LOG_TO_FILE` | Save interactions to log files | `true`/`false` |
| `SHOW_RAW_MESSAGES` | Show complete message content | `true`/`false` |
| `FORCE_ASCII` | Use ASCII symbols instead of Unicode/Emoji | `true`/`false` |

## Log Files

When file logging is enabled (`--log-to-file` or `LLM_LOG_TO_FILE=true`), JSON log files will be saved to the `logs/` directory with the following naming convention:

- `{threadId}_request_{timestamp}.json`: LLM request data
- `{threadId}_response_{timestamp}.json`: LLM response data

These files contain complete, untruncated information about the LLM interactions.

## Debugging Specific Issues

### Repeated Messages

If you see the LLM sending the same response multiple times, check the request logs to see if there's any confusion in the context about whether a response has already been sent. Look for:

- Duplicate messages in the context
- Missing tool execution records
- Unclear thread history

### Unexpected Tool Calls

If the LLM is calling the wrong tools or not calling expected tools:

1. Check the full request context to see what information the LLM has about the current state
2. Examine the tool descriptions in the request logs
3. Look at previous tool executions to see if the LLM might be confused about the state

### Context Length Issues

If you suspect context length problems (token limits):

1. Check the token usage reported in the response logs
2. Look at the message count in the request to see if you're approaching limits
3. Enable file logging and examine the full context sent to the LLM

## Advanced Debugging

The `llmDebugLogger` module provides programmatic access to debugging functions. You can use it in your code:

```javascript
const llmDebugLogger = require('./toolUtils/llmDebugLogger');

// Log a request
llmDebugLogger.logRequest(threadId, messages, tools);

// Log a response
llmDebugLogger.logResponse(threadId, response);
