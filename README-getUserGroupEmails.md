# Slack User Group Email Extractor

This script allows you to extract email addresses from a Slack user group using a bot token.

## Prerequisites

1. Node.js installed on your system
2. A Slack bot token with the following scopes:
   - `usergroups:read`
   - `users:read`
   - `users:read.email`

## Setup

1. Create a `.env` file in the same directory with your Slack bot token:
   ```
   SLACK_BOT_TOKEN=xoxb-your-bot-token-here
   ```

2. Install the required dependencies:
   ```bash
   npm install @slack/web-api dotenv
   ```

## Usage

You can use the script in two ways:

### 1. Command Line

Run the script directly with a user group handle:

```bash
node getUserGroupEmails.js @designteam
```

If no user group is specified, it will default to "@designteam".

### 2. As a Module

Import and use the function in your own code:

```javascript
const getUserGroupEmails = require('./getUserGroupEmails');

// Example usage
getUserGroupEmails('@designteam')
    .then(result => {
        if (result.success) {
            console.log(result.emails);
        } else {
            console.error(result.error);
        }
    });
```

## Output

The script will return an object with the following structure:

```javascript
{
    success: true,
    userGroupName: "Design Team",
    userCount: 5,
    emails: [
        "user1@example.com",
        "user2@example.com",
        // ...
    ]
}
```

## Error Handling

If there's an error, the script will return:

```javascript
{
    success: false,
    error: "Error message here"
}
```

## Notes

- The script requires a bot token with appropriate permissions
- Email addresses will only be returned for users whose email addresses are visible to the bot
- The script handles rate limiting automatically through the Slack Web API client 