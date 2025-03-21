# Slack Bot (Aya)

An LLM-powered Slack bot that responds to messages and provides various tools.

## Setup

1. Make sure you have Node.js installed (v16 or higher)
2. Install dependencies:
   ```
   npm install
   ```
3. Set up environment variables:
   - Create a `.env` file in the root directory (or use the existing one)
   - Required variables are:
     - `SLACK_BOT_TOKEN`
     - `SLACK_APP_TOKEN`
     - `SLACK_SIGNING_SECRET`
     - `LLM_API_KEY`
     - `PORT` (optional, defaults to 3000)

## Running the Bot

### For Windows (PowerShell):

For development:
```powershell
npm run dev
```

For production:
```powershell
npm start
```

## Troubleshooting

If you encounter any issues:

1. Make sure all environment variables are correctly set in the `.env` file
2. Ensure the Slack bot has been added to the channel you're testing in
3. Check that the bot token has the necessary permissions in Slack

## Project Structure

- `src/main.js` - Entry point for the application
- `src/orchestrator.js` - Orchestrates communication between Slack and LLM
- `src/llmInterface.js` - Handles communication with the LLM API
- `src/slackEvents.js` - Sets up Slack event handlers
- `src/tools/` - Contains tools that the LLM can use (postMessage, getThreadHistory, etc.) 