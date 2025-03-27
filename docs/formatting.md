# Message Formatting Guide

This document describes the formatting options available in our Slack bot. We use a hybrid approach that combines standard Markdown and specialized BBCode-style tags with parentheses.

## Markdown Formatting

Basic text formatting uses standard Markdown syntax:

- `*bold*` → **bold text**
- `_italic_` → *italic text*
- `` `code` `` → `inline code`
- ```````language
  code block
  ```````  → Code blocks with optional syntax highlighting
- `> text` → Blockquotes
- `* item` or `- item` → Bullet lists
- `1. item` → Numbered lists

## Hyperlinks and URLs

Slack requires a specific format for links and URLs:

- `<URL|text>` → Creates a hyperlink with custom text
  - Example: `<https://slack.com|Visit Slack>`
  - Do NOT use Markdown format `[text](URL)` as it won't render correctly

- `(image:URL:alt_text)` → Creates an inline image link
  - Example: `(image:https://example.com/image.jpg:View profile picture)`
  - This is converted to Slack's hyperlink format behind the scenes

## Image Display Options

There are three ways to display images in Slack messages:

1. **Standalone Image Block**:
   - Using Markdown image syntax: `![Alt text](https://example.com/image.jpg)`
   - Using BBCode format: `(image:https://example.com/image.jpg:Alt text)`
   - This displays a full-width image in the message

2. **Section with Image Accessory**:
   - Format: `(section:URL:alt_text)Content with image on right(!section)`
   - Example: `(section:https://example.com/logo.jpg:Company Logo)Check out our new product!(!section)`
   - This shows text content with a small image thumbnail on the right side

3. **Image Hyperlink**:
   - Format: `<URL|text>`
   - Example: `<https://example.com/image.jpg|View image>`
   - This shows just a clickable link but doesn't embed the image

## Special Formatting Tags (with Parentheses)

For specialized formatting and Slack-specific features, we use the following parentheses-style tags:

- `(header)Title(!header)` → Section header
- `(context)Small helper text(!context)` → Context block with smaller text
- `(divider)` → Horizontal divider
- `(usercontext)USER1,USER2,USER3(!usercontext)` → User context with profile pictures
- `(usercontext)USER1,USER2|did something(!usercontext)` → User context with profile pictures and descriptive text
- `(section:image_url:alt_text)Content with an image accessory(!section)` → Section with image accessory

## Message Structure

Messages can include multiple paragraphs with mixed formatting. Double line breaks create new sections.

## Examples

### Basic Message with Header and Context

```
(header)Task Status(!header)

The task has been completed successfully.

(context)Completed at 2:30 PM(!context)
```

### Using User Context

```
(header)Poll Results(!header)

Here are the users who voted yes:

(usercontext)U12345,U67890,U13579(!usercontext)

And these users voted and provided comments:

(usercontext)U12345,U67890|added detailed feedback(!usercontext)

(context)Vote ended at 3:45 PM(!context)
```

### Section with Image Accessory

```
(header)Restaurant Recommendation(!header)

(section:https://example.com/restaurant-image.jpg:Restaurant Photo)*Farmhouse Thai Cuisine*
:star::star::star::star: 1528 reviews
They do have some vegan options, like the roti and curry, plus they have a ton of salad stuff and noodles can be ordered without meat!! They have something for everyone here(!section)

(context)Location: 123 Main Street(!context)
```

### Using Dividers

```
(header)Task List(!header)

- Complete project proposal 
- Schedule team meeting

(divider)

*Completed Tasks:*
- Initial research
- Draft outline

(context)Updated 2 hours ago(!context)
```

## Notes

- Message colors can be set using the `color` parameter (blue, green, red, orange, purple, or hex code)
- Always test your messages to ensure they display as expected
- The user context feature will automatically display user profile pictures and handle truncation
- The section with image accessory creates a Slack Block Kit section with an image on the right side 