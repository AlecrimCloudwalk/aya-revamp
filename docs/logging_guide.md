# Logging and Debugging Guide

This guide explains how to use and interpret the logging system for the Slack bot, as well as how to debug LLM-related issues in development mode.

## Log Levels

The bot supports multiple log levels:

- `QUIET`: Only critical errors
- `NORMAL`: Standard operational logs (default)
- `VERBOSE`: Detailed information for troubleshooting
- `DEBUG`: Developer debugging with full object dumps

Set the log level using the `LOG_LEVEL` environment variable:

```bash
# In .env or environment
LOG_LEVEL=DEBUG
```

## Quick Start for Debugging

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

## Environment Variables

You can customize logging and debugging behavior with these environment variables:

| Variable | Description | Values |
|----------|-------------|--------|
| `LOG_LEVEL` | Level of detail in logs | `QUIET`, `NORMAL`, `VERBOSE`, `DEBUG` |
| `SHOW_DETAILS` | Show full object details in logs | `true`/`false` |
| `VERBOSE_LOGGING` | Enable verbose logging in the Bolt app | `true`/`false` |
| `DEBUG_LLM` | Enable LLM-specific debugging | `true`/`false` |
| `DEBUG_CONTEXT` | Enable context debugging | `true`/`false` |
| `LLM_LOG_TO_FILE` | Save interactions to log files | `true`/`false` |
| `SHOW_RAW_MESSAGES` | Show complete message content | `true`/`false` |
| `FORCE_ASCII` | Use ASCII symbols instead of Unicode/Emoji | `true`/`false` |

## Log Identifiers

All events use consistent emoji prefixes for quick identification:

- 📩 INCOMING: Raw incoming events (messages, mentions, buttons)
- 👉 SKIPPING: Events that are being skipped (with reason)
- ✅ PROCESSING: Events that are being processed
- 🔘 BUTTON: Button processing
- 📨 MESSAGE: Message handling
- 🧠 LLM: LLM request/response
- ❌ ERROR: Error messages

## Understanding the Debug Output

When LLM debugging is enabled, you'll see structured output showing:

1. **LLM REQUEST**: What's being sent to the LLM
   - Thread ID
   - Message count
   - Tabular view of all messages with their roles
   - Available tools

2. **LLM RESPONSE**: What's received from the LLM
   - Tool calls (if any)
   - Message content (if any)
   - Token usage statistics

3. **RAW MESSAGE CONTENT**: Complete unabridged message content (when using `--show-raw` or `SHOW_RAW_MESSAGES=true`)

## Message Processing Rules

### Development Mode (`DEV_MODE=true`)

1. **ONLY respond to messages containing the special key `!@#`**
   - All messages without this key will be skipped
   - Log entry: "DEV MODE: Ignoring message without dev key !@#"

2. **Direct Messages (DMs) in DEV mode**
   - Even in DMs, the `!@#` key is required
   - No exceptions for 1:1 conversations in dev mode

3. **Channel Messages in DEV mode**
   - Must contain both a mention (@bot-name) AND the `!@#` key
   - Will be skipped otherwise

### Production Mode

1. **Direct Messages (DMs)**
   - Respond to all messages in 1:1 DMs (no mention required)
   - In multi-person DMs, only respond when mentioned

2. **Channels and Group Messages**
   - ONLY respond when specifically mentioned (@bot-name)
   - Log skipped messages with reason "Not a direct mention or 1:1 DM"

## Log File Management

When file logging is enabled (`LLM_LOG_TO_FILE=true`), log files will be saved to the `logs/` directory:

```bash
# Redirect console logs to file
npm start > logs/bot.log 2>&1

# Using built-in LLM log files
npm run debug:file
```

For LLM-specific logs, files follow this naming convention:
- `{threadId}_request_{timestamp}.json`: LLM request data
- `{threadId}_response_{timestamp}.json`: LLM response data

These files contain complete, untruncated information about the LLM interactions.

## Debugging Specific Issues

### Skipped Messages

If messages are being unexpectedly ignored:

1. Check logs for `👉 SKIPPING MESSAGE` entries to see why
2. Verify that new conversations include the `!@#` prefix in development mode
3. Check if thread handling is working properly

### Button Interaction Flow

Button interactions follow this logging flow:

1. `📩 INCOMING BUTTON CLICK`: First log when button is clicked
2. `✅ PROCESSING BUTTON CLICK`: Acknowledge and begin processing
3. `🔘 BUTTON PROCESSING`: Detailed processing in orchestrator
4. `Button update succeeded/failed`: UI update status

### LLM Context Issues

For issues with LLM context:

1. Set `LOG_LEVEL=DEBUG`
2. Set `SHOW_DETAILS=true`
3. Look for `🧠 Getting next action from LLM` sections
4. Check the full request context to see what information the LLM has
5. Examine the tool descriptions in the request logs

### Thread History Issues

For issues with thread context:

1. Look for `THREAD CONTEXT` log sections
2. Check `Retrieved X messages from thread history` entries
3. Verify the thread_ts values match between messages

### Context Length Problems

If you suspect context length problems (token limits):

1. Check the token usage reported in the response logs
2. Look at the message count in the request to see if you're approaching limits
3. Enable file logging and examine the full context sent to the LLM

### Common Error Patterns

Watch for these patterns indicating potential issues:

1. `Error in process loop`: LLM processing errors
2. `Failed to get thread history`: Thread context loading issues
3. `Button update failed`: UI update problems
4. `Already sent X messages`: Message flow control issues

## Programmatic Logging

The `llmDebugLogger` module provides programmatic access to debugging functions:

```javascript
const llmDebugLogger = require('./toolUtils/llmDebugLogger');

// Log a request
llmDebugLogger.logRequest(threadId, messages, tools);

// Log a response
llmDebugLogger.logResponse(threadId, response);
```

## Request Logging

The `llmDebugLogger` provides a `logRequest` method that logs detailed information about LLM API requests:

```javascript
// Example of logging an LLM request
const requestData = {
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello, who are you?' }
  ],
  tools: [
    { type: 'function', function: { name: 'getWeather' } },
    { type: 'function', function: { name: 'searchWeb' } }
  ]
};

llmDebugLogger.logRequest('thread_12345', requestData);
```

This will produce a log entry with:
