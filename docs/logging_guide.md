# Tool Utilities

This directory contains utility functions used across the codebase.

## Logger

The logger utility provides a standardized way to log messages across the application with different verbosity levels. It replaces direct console.log usage and provides better control over what gets logged.

### Usage

```javascript
const logger = require('./logger');

// Different log levels
logger.error('This is an error message');
logger.warn('This is a warning message');
logger.info('This is an info message');
logger.detail('This is a detailed message with object', { key: 'value' });
logger.debug('This is a debug message');
```

### Configuration

The logger can be configured through environment variables:

- `LOG_LEVEL`: Sets the verbosity level (SILENT, ERROR, WARN, INFO, DETAIL, DEBUG)
- `LOG_TIMESTAMPS`: Enables timestamps in log output (true/false)
- `LOG_COLORS`: Enables colored output (true/false)

### Migration Script

To help migrate existing files from console.log to the new logger, you can use the provided script:

```
node scripts/update-to-logger.js path/to/file.js
```

The script will:
1. Add the logger import if missing
2. Replace console.log/warn/error calls with appropriate logger methods
3. Create a new file with .updated extension for review

After reviewing the changes, you can replace the original file with the updated version.

### Migration Status

The following key files have been migrated to use the logger system:

- ✅ `src/tools/postMessage.js`
- ✅ `src/tools/updateMessage.js`
- ✅ `src/tools/addReaction.js`
- ✅ `src/tools/removeReaction.js`
- ✅ `src/tools/createEmojiVote.js`
- ✅ `src/tools/finishRequest.js`
- ✅ `src/tools/getThreadHistory.js`
- ✅ `src/tools/processLLMFeedback.js`
- ✅ `src/toolUtils/blockBuilder.js`
- ✅ `src/toolUtils/messageFormatUtils.js`
- ✅ `src/toolUtils/loadThreadHistory.js`
- ✅ `src/toolUtils/processLLMFeedback.js`
- ✅ `src/slackFormat.js`
- ✅ `src/slackEvents.js`
- ✅ `src/processThread.js`
- ✅ `src/contextBuilder.js`
- ✅ `src/main.js`

Still pending migration:
- ⏳ `src/llmInterface.js`
- ⏳ `src/openai.js`
- ⏳ `src/orchestrator.js`

### Batch Migration

For batch processing multiple files, you can use the PowerShell scripts:

```
.\scripts\migrate-logs.ps1
.\scripts\migrate-logs-round2.ps1
```

## Other Utilities

- `loadThreadHistory.js`: Loads message history from Slack threads
- `processLLMFeedback.js`: Processes feedback from LLM interactions
- `messageFormatUtils.js`: Formats messages for display in Slack
- `blockBuilder.js`: Helps construct Slack Block Kit formatted messages 