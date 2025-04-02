# PowerShell script to migrate multiple files to use the logger
# This script runs the update-to-logger.js script on multiple files and automatically replaces them

$files = @(
    "src/tools/addReaction.js",
    "src/tools/removeReaction.js",
    "src/tools/createEmojiVote.js",
    "src/tools/processLLMFeedback.js",
    "src/slackFormat.js",
    "src/slackEvents.js",
    "src/processThread.js",
    "src/orchestrator.js",
    "src/llmInterface.js",
    "src/openai.js"
)

foreach ($file in $files) {
    Write-Host "Processing $file..." -ForegroundColor Cyan
    
    # Run the migration script
    node scripts/update-to-logger.js $file
    
    # Check if the updated file exists
    $updatedFile = "$file.updated"
    if (Test-Path $updatedFile) {
        # Replace the original file
        Copy-Item $updatedFile $file -Force
        Write-Host "✅ Replaced $file with updated version" -ForegroundColor Green
        
        # Remove the .updated file
        Remove-Item $updatedFile
    } else {
        Write-Host "⚠️ No updated file was created for $file" -ForegroundColor Yellow
    }
    
    Write-Host ""
}

Write-Host "Migration completed!" -ForegroundColor Green 