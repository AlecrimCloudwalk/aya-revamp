# Logging Guide for Slack Bot

This guide explains how to use and interpret the logging system for the Slack bot, particularly for debugging issues in development mode.

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

## Special Logging Flags

- `SHOW_DETAILS=true`: Show full object details in logs
- `VERBOSE_LOGGING=true`: Enable verbose logging in the Bolt app

## Identifying Events

All events use consistent emoji prefixes for quick identification:

- 📩 INCOMING: Raw incoming events (messages, mentions, buttons)
- 👉 SKIPPING: Events that are being skipped (with reason)
- ✅ PROCESSING: Events that are being processed
- 🔘 BUTTON: Button processing
- 📨 MESSAGE: Message handling
- 🧠 LLM: LLM request/response
- ❌ ERROR: Error messages

## Debugging DEV_MODE Issues

In development mode (`DEV_MODE=true`), the bot applies special message filtering:

### Message Processing Rules in DEV_MODE

1. **ONLY respond to messages containing the special key `!@#`**
   - All messages without this key will be skipped
   - Log entry: "DEV MODE: Ignoring message without dev key !@#"

2. **Direct Messages (DMs) in DEV mode**
   - Even in DMs, the `!@#` key is required
   - No exceptions for 1:1 conversations in dev mode

3. **Channel Messages in DEV mode**
   - Must contain both a mention (@bot-name) AND the `!@#` key
   - Will be skipped otherwise

4. **Log Format for Skipped Messages**
   - All skipped messages logged with `👉 SKIPPING MESSAGE` prefix
   - Should include reason for skip

### Production Mode Rules

1. **Direct Messages (DMs)**
   - Respond to all messages in 1:1 DMs (no mention required)
   - In multi-person DMs, only respond when mentioned

2. **Channels and Group Messages**
   - ONLY respond when specifically mentioned (@bot-name)
   - Log skipped messages with reason "Not a direct mention or 1:1 DM"

### Common Issues in DEV_MODE

If messages are being unexpectedly ignored:

1. Check logs for `👉 SKIPPING MESSAGE` entries to see why
2. Verify that new conversations include the `!@#` prefix
3. Check if thread handling is working properly

## Button Interaction Flow

Button interactions follow this logging flow:

1. `📩 INCOMING BUTTON CLICK`: First log when button is clicked
2. `✅ PROCESSING BUTTON CLICK`: Acknowledge and begin processing
3. `🔘 BUTTON PROCESSING`: Detailed processing in orchestrator
4. `Button update succeeded/failed`: UI update status

## Thread History Debugging

For issues with thread context:

1. Look for `THREAD CONTEXT` log sections
2. Check `Retrieved X messages from thread history` entries
3. Verify the thread_ts values match between messages

## Viewing LLM Context

To see the full LLM context and responses:

1. Set `LOG_LEVEL=DEBUG`
2. Set `SHOW_DETAILS=true`
3. Look for `🧠 Getting next action from LLM` sections

## Common Error Patterns

Watch for these patterns indicating potential issues:

1. `Error in process loop`: LLM processing errors
2. `Failed to get thread history`: Thread context loading issues
3. `Button update failed`: UI update problems
4. `Already sent X messages`: Message flow control issues

## Thread Management Issues

For thread identification problems:

1. Check logs for thread_ts and channel IDs
2. Verify consistent threadId usage across logs
3. Look for the getThreadHistory tool execution

## Log File Management

Logs are written to the console and can be redirected to a file:

```bash
npm start > logs/bot.log 2>&1
```

For production, consider using a proper logging service or log rotation.
